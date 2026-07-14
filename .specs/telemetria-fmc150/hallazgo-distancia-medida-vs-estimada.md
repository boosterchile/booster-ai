# Hallazgo F0-0 — Distancia real descartada; la huella se calcula con estimación

**El hallazgo más grave de la auditoría.** Es más grave que el hueco CAN y que las lecturas
muertas (IO 72, acelerómetro) porque no es un dato que falta: es un dato que **existe, se computa,
y se tira** — y el certificado que se emite al cliente lo reemplaza por una estimación **sin
declararlo**.

**Fecha:** 2026-07-13 · **Naturaleza:** auditoría READ-ONLY (código + ground-truth Cloud SQL prod vía
`scripts/db/agent-query.sh`, solo SELECT). No se modificó nada.
**Regla de evidencia:** cada afirmación lleva `archivo:línea` o salida literal. Lo no comprobable en
prod se marca **NO VERIFICADO**.

Relacionado: `delta.md` (hueco CAN, mismo patrón sobre combustible), `adr-propuesto-*.md` punto 13
(backhaul GLEC §6.4). Este documento **corrige** el framing "se omite en silencio" de ese punto (§4).

---

## 1. Frase de cierre

*Booster tiene la distancia real recorrida en dos almacenes GPS —`telemetria_puntos` (Teltonika, 260k
pings reales) y `posiciones_movil_conductor` (app del conductor, cableada)— y el cálculo de huella no
lee ninguno de los dos para la distancia. La saca de Google Routes API o de una tabla regional
hardcodeada. El único punto donde el sistema toca los pings reales (cálculo de cobertura) computa la
distancia recorrida y la **descarta**, conservando solo un ratio. Existe una columna `distancia_km_real`
y el certificado la prefiere —pero nunca se escribe, así que todo certificado cae a la estimación.*

---

## 2. El patrón — tercera instancia de "capacidad presente, consumidor ausente"

| # | Capa | Capacidad presente | Consumo | Estado |
|---|---|---|---|---|
| CAN | Combustible (`delta.md`) | `.cfg` habilitado hace ~2 meses | modo `exacto_canbus` nunca invocado | habilitado, no llega, y sin consumidor |
| IO 72 | Temperatura (`delta.md` F0-1) | consumidor `vehiculos.ts:204` lo lee | device no emite | consumidor presente, dato ausente |
| **GPS** | **Distancia (este doc)** | **dato real presente (260k pings) + campo destino + cert cableado** | **cero consumo para distancia** | **dato presente y almacenado, consumidor ausente** |

Los tres comparten la falla: **el sistema cree que una capacidad funciona y en silencio no funciona.**
El GPS es el más grave porque el dato **sí está** (no depende de habilitar el `.cfg` ni instalar
hardware) y aun así la huella se calcula con estimación.

---

## 3. Evidencia — la cadena de descarte

### 3.1 · La distancia de la huella nunca lee una traza real
`obtenerDistanciaKm()` (`apps/api/src/services/calcular-metricas-viaje.ts:110-159`) resuelve la
distancia en dos fuentes, ambas **estimación**:
1. Google Routes API `computeRoutes()` (`:129-145`) — ruta sintetizada, polyline asumido.
2. Fallback `estimarDistanciaKm()` (`:158`) — tabla estática de distancias entre capitales regionales
   (`estimar-distancia.ts`), 500 km default para códigos no mapeados.

La procedencia se hardcodea a `maps_directions` (`:294`). El propio docstring lo admite:
*"la distancia hoy viene de `estimarDistanciaKm()`… En Phase 2 reemplazar por Google Maps Routes API"*
(`:39-42`). Ni `telemetria_puntos` ni `posiciones_movil_conductor` se consultan para distancia.

### 3.2 · El único lugar que toca los pings reales computa la distancia y la tira
`calcularCobertura()` (`calcular-cobertura-telemetria.ts:118-185`) **sí** consulta `telemetria_puntos`
(`:139-153`) y **sí** computa la distancia real recorrida — suma haversine de pings consecutivos:
```
kmCubiertos += haversineKm(prev.lat, prev.lng, curr.lat, curr.lng)   // :105
```
Pero ese `kmCubiertos` — la distancia medida — se usa **solo como numerador de un ratio** y se descarta:
```
const pct = (kmCubiertos / distanciaEstimadaKm) * 100                 // :109
return Math.min(Math.max(pct, 0), 100)                                // solo sobrevive el %
```
Se calcula la distancia real y se conserva únicamente "qué fracción de la estimación cubrió".

### 3.3 · `recalcularNivelPostEntrega` no toca la distancia ni las emisiones
Al confirmar entrega (`calcular-metricas-viaje.ts:411-544`), con Teltonika presente, se recalcula la
cobertura y se **promueve** `routeDataSource` a `teltonika_gps` (`:522`). Pero el UPDATE toca **solo 4
campos de certificación** — `routeDataSource`, `coveragePct`, `certificationLevel`, `uncertaintyFactor`
(`:535-544`). Explícito en el docstring: *"no toca emisiones, factor, etc. — esos se mantienen del
cálculo estimado"* (`:394-397`). La etiqueta sube a `teltonika_gps` pero la **distancia y las emisiones
siguen siendo la estimación pre-entrega**. La procedencia dice "GPS"; el número no lo es.

### 3.4 · Existe el campo destino, el cert lo prefiere, y nunca se escribe
- Columna: `distanceKmActual = numeric('distancia_km_real', …)` (`apps/api/src/db/schema.ts:1407`).
- El certificado la prefiere: `distance_km: r.distanceKmActual ?? r.distanceKmEstimated`
  (`apps/api/src/routes/certificates.ts:128`).
- **Writes a `distanceKmActual`: cero** (grep exhaustivo en `apps/api/src`, excluyendo tests/schema).
  → siempre NULL → **el `??` cae SIEMPRE a `distanceKmEstimated`**. El campo "distancia real" del
  certificado emitido al cliente es, sin excepción, la estimación.

### 3.5 · La app del conductor: mismo hueco, hoy latente (0 filas)
`posiciones_movil_conductor` (`schema.ts:1042-1074`, migración `0025_posiciones_movil.sql`) se puebla
por diseño a **~1 punto/10s** por conductor que active el reporte GPS (frontend
`use-driver-position-reporter.ts:62,82-86` → `POST /assignments/:id/driver-position`
`assignments.ts:411-456`).
- **Ground-truth prod (2026-07-13):** `SELECT count(*) FROM posiciones_movil_conductor` → **0 filas**
  (0 vehículos, 0 conductores). Nadie ha activado el reporte (opt-in **manual** por card,
  `conductor.tsx:384,395`; captura **foreground-only**, ver §7; flota real ≈ 1 device por `delta.md`).
- **Ningún servicio de carbono la consulta** (grep en `calcular-metricas-viaje.ts`,
  `calcular-cobertura-telemetria.ts`, `actualizar-factor-matching.ts`, `packages/carbon-calculator/`
  → 0 hits). Sus únicos lectores son el tracking de flota del carrier (`vehiculos.ts`).
- **No hay valor de enum para representarla:** `route_data_source` = `{teltonika_gps, maps_directions,
  manual_declared}` (`trip-metrics.ts:28-32`, `schema.ts:356-360`). Aunque un conductor reportara la
  traza completa, hoy se etiquetaría `maps_directions` (secundario, polyline asumido).

Es el mismo hueco arquitectónico que Teltonika, **latente** hasta que un conductor use el reporte o se
cablee B (§7).

---

## 4. Corrección al diagnóstico previo del backhaul — qué corta exactamente el gate

El `adr-propuesto-*.md` punto 13 dijo que la atribución del retorno vacío *"se omite en silencio"*.
Es impreciso. Verificado en `packages/carbon-calculator/src/modos/exacto-canbus.ts`:

**El gate `exacto-canbus.ts:70`** — `if (backhaul && cargaTon > 0 && distanciaKm > 0 &&
vehiculo.consumoBasePor100km != null)`:
- **NO corta el cálculo del leg cargado.** Las emisiones del shipment (`emisionesWtw/Ttw/Wtt`,
  intensidad, distancia) se computan y retornan **antes** del gate (`:48-50, :56-68`) e independientes
  de él.
- **Corta el bloque `resultado.backhaul` entero:** el cálculo GLEC §6.4 (`calcularEmptyBackhaul`), su
  atribución de emisiones **y** el storytelling `ahorroVsSinMatching` (`:71-86`). Si `consumoBasePor100km`
  es NULL → `resultado.backhaul` queda `undefined` → el retorno aporta **cero** al shipment y no hay flag.

Hay entonces **dos regímenes**, ninguno es un backhaul medido:
1. **`consumo_base` NULL (77% de la flota, `adr-propuesto` punto 13):** el bloque §6.4 se salta **entero
   y en silencio**. Ese régimen sí es "omisión silenciosa" — el diagnóstico previo era correcto **para
   este caso**.
2. **`consumo_base` presente (23%):** el §6.4 **sí calcula**, pero sobre **supuestos**, no medición:
   `distanciaRetornoKm = distancia del leg cargado` (asume ida=vuelta,
   `calcular-metricas-viaje.ts:588-589`) y `factorMatching` = heurística geográfica sobre el siguiente
   trip (centroides regionales + haversine×1.3, `actualizar-factor-matching.ts:81-117`), **no** GPS real.

Matiz mayor: hoy en prod el modo es `modelado`/`por_defecto`, no `exacto_canbus` — este último **nunca
se invoca** (`delta.md`; `calcular-metricas-viaje.ts:24-30`). El gate del §4 es el comportamiento
**cuando el CAN llegue**; el backhaul en el modo vivo se gatea análogamente en `modos/modelado.ts`.

---

## 5. Propuesta A — cablear traza → distancia del leg cargado (deuda técnica; se arregla)

El dato existe; falta el cable. Prioridad de procedencia en el **eje de distancia**:
`teltonika_gps` · `movil_gps` (trazas **medidas**) **>** `maps_directions` (sintetizada) **>**
`manual_declared`. Aplica a Teltonika (`telemetria_puntos`, hoy) y a la app (`posiciones_movil_conductor`,
cuando se pueble), con la **misma** técnica haversine + gap de continuidad ya existente
(`calcularCoberturaPura`, `:88-111`).

### 5.1 · Distancia HÍBRIDA, nunca `kmCubiertos` crudo (resuelve el envenenamiento del fix)
`kmCubiertos` (`calcular-cobertura-telemetria.ts:105`) suma **solo** tramos con gap < 60s. Escribir
`distancia_km_real = kmCubiertos` a cobertura < 100% cambia una estimación por una **subestimación
sistemática** — el sesgo vuelve a ser **direccional a la baja**, exactamente el error del backhaul (§4)
que estamos corrigiendo. Diseño correcto:

```
distancia_km_real = kmObservado      (Σ haversine de tramos con gap < 60s)
                  + kmEstimadoHuecos  (tramos con gap ≥ 60s)
```
- **Huecos con ambos extremos conocidos:** estimar **por-hueco** = `haversine(inicio, fin del gap) ×
  factor de sinuosidad` (reutilizar el ×1.3 ya usado en `actualizar-factor-matching.ts:81-117`).
  **NO** rellenar con `(1−coverage)×distanciaRutaTotal`: eso **colapsa a la estimación pura** (algebraicamente
  `kmObservado + (1−cov)×ruta = ruta` cuando `cov = kmObservado/ruta`) y **anula el fix**.
- **Huecos de cola/cabeza sin bracket** (device apagado hasta la entrega): caer al estimate de ruta
  para ese tramo, declarado como estimado.
- **El certificado declara la mezcla:** *"medido X%, estimado (100−X)%"* con `X = coverage_pct`. Nunca
  "distancia medida" a secas cuando hay huecos. Reutiliza la maquinaria de §7.

### 5.2 · Autorización del PO + secuenciación (distancia primero, emisiones después)
- **[PO — AUTORIZADO 2026-07-13]** escribir `distancia_km_real` y que el certificado la prefiera
  (`certificates.ts:128` ya hace `distanceKmActual ?? distanceKmEstimated`). Resuelve el bloqueador (b):
  hoy el cert publica una estimación bajo un campo llamado "distancia real"; corregirlo es la decisión
  correcta.
- **Paso 1 (este fix):** persistir la distancia **híbrida** (§5.1) en `distancia_km_real`. Cambia el
  número de **distancia** del cert. Mecánica en §8.1.
- **Paso 2 (PR separado):** recomputar **emisiones** desde la distancia real (hoy clavadas a la
  estimación, `:394-397`). **No se mezcla con el paso 1.**
- **Caveat de consistencia transitoria:** entre paso 1 y paso 2 el cert muestra distancia real pero
  emisiones aún modeladas desde la estimación → **declararlo** en el cert (la etiqueta medido/estimado
  aplica a distancia; emisiones siguen modeladas hasta el paso 2). No dejarlo implícito.
- **Sigue pendiente (no autorizado aquí):** el valor de enum `movil_gps` y dónde cae en
  `derivarNivelCertificacion()` (¿`primario_verificable`, o nivel propio con incertidumbre entre
  Teltonika y Maps?) → extensión de **ADR-028** + su spec. Y el fix es **dominio crítico** (carbono/GLEC)
  → **TDD con rojo exhibido** antes de implementar (CLAUDE.md).

Esta parte **se arregla**: es deuda técnica con dato disponible + decisión ya tomada, no un problema de producto.

---

## 6. Propuesta B — observar el retorno en vacío (decisión de PRODUCTO; no resolver)

Para que la app **observe** el recorrido de retorno (GLEC empty running real) de vehículos sin Teltonika
hacen falta tres cosas, ninguna presente hoy:
- **(a)** un estado de "retorno" en el modelo de viaje/asignación (hoy no existe: `estado_asignacion` =
  `asignado/recogido/entregado/cancelado`);
- **(b)** relajar el gate 409 que rechaza posiciones tras `entregado` (`assignments.ts:437-440`);
- **(c)** captura continua que sobreviva al background — `watchPosition` del browser es foreground-only
  (§7) → probablemente **app nativa / foreground-service**.

**Es decisión de producto — no la resuelvo.** Mientras B no exista, la deuda debe declararse explícita:
el retorno se estima con el **factor de empty running de GLEC §6.4** (con su incertidumbre), **no** con
`distanciaRetornoKm = ida` + heurística geográfica presentados como si fueran medición. Y cuando
`consumo_base` es NULL, el certificado marca **"backhaul no atribuido"** explícito en vez de saltarlo
callado (§4, régimen 1; enlaza `adr-propuesto` punto 13).

---

## 7. Regla de honestidad — una traza con huecos no es un trayecto medido

Si el conductor apagó el reporte a mitad de camino (o el device perdió señal), el certificado debe
**declararlo**, no rellenar el hueco con estimación en silencio. Es el mismo error que este hallazgo y
`delta.md` corrigen.

La maquinaria **ya existe** y hay que **reutilizarla**, no reinventarla: `coverage_pct` con downgrade
automático de nivel bajo umbral (95% primario / 80% secundario modeled, `trip-metrics.ts:104-106`) +
`uncertainty_factor` publicado como ± en el cert. Hoy esa maquinaria corre solo sobre `telemetria_puntos`.
Aplicarla también a `movil_gps`: traza con gaps → `coverage_pct` lo refleja → downgrade + ± más ancho +
leyenda explícita **"medido X%, estimado (100−X)%"**. Invariante: **procedencia medida ⇒ número medido, o
declarar la mezcla.** Nunca una etiqueta `*_gps` sobre un número estimado (que es exactamente lo que hace
hoy `recalcularNivelPostEntrega`, §3.3).

---

## 8. Accionabilidad — tamaño del fix y superficie de reemisión

### 8.1 · El fix de distancia (Teltonika) es pequeño — lo que falta es la decisión, no la ingeniería
El daño (todo cert cae a la estimación) es **desproporcionado** al cambio necesario:
- La columna destino existe (`distancia_km_real`, `schema.ts:1407`); el cert ya la prefiere
  (`certificates.ts:128`); `calcularCoberturaPura` **ya computa** `kmCubiertos`
  (`calcular-cobertura-telemetria.ts:96-107`). **Solo falta persistirlo.**
- **Mecánica exacta:** `kmCubiertos` hoy es variable local y se descarta en el `return` (`:109`).
  Exponerlo (retorno de `calcularCoberturaPura`/`calcularCobertura` de `number` → incluir
  `kmCubiertos`) **+ una línea** en el UPDATE de `recalcularNivelPostEntrega` (`:535-544`:
  `distanceKmActual: kmCubiertos.toString()`) **+** ajustar los tests de cobertura al nuevo shape.
  ~una decena de líneas en 2 archivos — **no un proyecto**.
- **Por qué no es literalmente una línea — dos acoplamientos reales, no tamaño:**
  1. `kmCubiertos` suma **solo** segmentos con gap < 60s (`:104`) → a cobertura < 100% es distancia
     **cubierta**, no total: escribirla cruda **subestima** (sesgo direccional a la baja). Persistir la
     **distancia híbrida de §5.1** (observado + estimado-por-hueco), no `kmCubiertos` crudo, con la
     declaración de mezcla del cert.
  2. Escribir `distancia_km_real` **cambia el número del certificado** (por el `??`) → cae bajo el
     gate de contrato **PO/ADR-028** (§5). Recomputar además las **emisiones** desde la distancia real
     es un paso mayor y separado (hoy quedan clavadas a la estimación, `:394-397`).
- **Conclusión:** el fix de la *distancia del cert* es "arreglable hoy"; lo que lo bloquea **no es
  esfuerzo** sino la firma del PO sobre cambiar números emitidos + resolver el acoplamiento de
  cobertura. Cambia la conversación de "proyecto Phase 2" a "decisión + un PR chico".

### 8.2 · Superficie de certificados ya emitidos — hoy 0, reemisión factible
Ground-truth prod (2026-07-13, `SELECT … FROM metricas_viaje`):
- **0 certificados emitidos** (`certificado_emitido_en NOT NULL` = 0). **0 filas** con
  `fuente_dato_ruta = 'teltonika_gps'`. La única fila (1) es artefacto de test: `modelado`,
  `distancia_km_estimada = 500.00` (el default de códigos no mapeados), sin cert,
  `calculado_en 2026-05-03` — anterior incluso a los datos del device real (5-may).
- **Por lo tanto:** hoy **no existe** la cohorte de certs `teltonika_gps` con distancia estimada
  adentro. El riesgo de "procedencia que el número no tiene" es **latente**, no actual.
- **Lo accionable:** aterrizar el fix (§8.1) **antes** de que el pipeline de certificados corra a
  volumen, para que **nunca** se acuñe esa cohorte mal-etiquetada. Y si se emiten certs contra viajes
  históricos, la reemisión con distancia real **es factible**: `telemetria_puntos` retiene **260k pings
  del device operativo desde el 5-may** (2+ meses continuos, ver `delta.md`) → la distancia real es
  re-derivable post-hoc (haversine sobre la ventana pickup→entrega), sin recolectar nada nuevo.
- **Ventana de re-derivabilidad — NO VERIFICADO su cierre:** vale mientras `telemetria_puntos` retenga
  los pings; ligado al followup `.specs/_followups/telemetria-particion-y-retencion.md`. Si se
  purga/particiona sin archivar, la ventana se cierra.

---

## 9. Por qué es el más grave

- **Toca el producto vendible**: el certificado ESG es el entregable al cliente; hoy publica una
  distancia estimada bajo un campo llamado "distancia real" y, cuando hay Teltonika, bajo una etiqueta de
  procedencia `teltonika_gps` que no corresponde al número.
- **El dato ya está** (260k pings reales, 2+ meses): no depende de habilitar `.cfg` ni de instalar
  hardware, a diferencia del hueco CAN. Es puro cableado ausente.
- **Riesgo de auditabilidad**: GLEC/GHG exigen que la huella sea re-derivable de sus inputs. Un cert que
  dice `teltonika_gps` pero calcula sobre `maps_directions` no es re-derivable — falla la premisa de
  ADR-028.

**Acción inmediata (sin gate):** documentar (este doc). **Acción A (gate PO/ADR-028):** cablear la traza
a la distancia + `movil_gps`. **Acción B (gate producto):** observar el retorno. **Regla (§7):** honestidad
de cobertura en todo cert.
