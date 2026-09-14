# ADR-077 — Nivel de certificación GLEC por fuente de posición: CAN vs GPS del vehículo vs GPS del móvil

**Estado**: Vigente
**Fecha**: 2026-08-17
**Decider**: Felipe Vicencio (Product Owner)
**Technical contributor**: Claude (Claude Code) actuando como arquitecto de software
**Related**:
- [ADR-021 GLEC v3.0 compliance](./021-glec-v3-compliance.md) — marco de cálculo
- [ADR-028 Modelo dual de fuente de datos](./028-dual-source-data-model-teltonika-vs-maps.md) — tres dimensiones ortogonales, matriz de derivación, templates de certificado. **Este ADR la extiende; no la reabre.**
- [ADR-073 Tipologías de flota y clase GLEC](./073-tipologias-flota-configuracion-glec.md) — de dónde sale el factor cuando el consumo es modelado
- `.specs/medicion-huella-segmento/{spec,plan}.md` — F1/F2, Tasks 10–13
- `docs/frentes-vivos.md` Slot 1 — «Decisión pendiente que hay que tomar antes de T10»

---

## Contexto

F2 del plan `medicion-huella-segmento` mide la huella de un viaje sobre el segmento real `pickedUpAt → deliveredAt`, con la posición ruteada por tipo de vehículo (Task 10): con Teltonika → `telemetria_puntos`; sin Teltonika → `posiciones_movil_conductor` (Geolocation API del móvil del conductor, endpoint `POST /assignments/:id/driver-position`). Sin merge de streams: un viaje se mide desde UNA fuente.

Eso abre una pregunta que el modelo vigente no responde. ADR-028 §1 define `fuente_dato_ruta` con tres valores —`teltonika_gps`, `maps_directions`, `manual_declared`— y §2 deriva `nivel_certificacion` desde `metodo_precision × fuente_dato_ruta × coverage_pct` (`derivarNivelCertificacion`, `packages/carbon-calculator/src/certificacion/derivar-nivel.ts`). **La posición del móvil no es ninguna de las tres fuentes.** Y las dos fuentes medidas no son el mismo producto:

- **CAN bus (FMC150 con adaptador CAN):** combustible realmente quemado (IO 83 consumo acumulado; IO 84 nivel en litros) + ruta GPS del dispositivo fijo al vehículo. Es dato primario de energía en el sentido de ADR-028 §2 (GLEC §4.4 nivel 1). Es la única vía a `primario_verificable`.
- **GPS del móvil del conductor:** distancia recorrida medida (dato primario de *actividad*), pero el consumo se **modela** con factores GLEC por tipología (ADR-073). No hay medición de energía. Además el sensor no está fijo al vehículo: es un teléfono que el conductor lleva consigo, con `accuracy_m` de móvil y sin identidad de vehículo garantizada por hardware.
- **GPS del Teltonika sin CAN** (FMC150 sin adaptador, o CAN sin lecturas): distancia medida por dispositivo fijo al vehículo, consumo modelado. Ya cabe en la matriz de ADR-028 (`modelado` + `teltonika_gps` → `secundario_modeled`).

Además, el plan (Task 12) dice «cobertura ≥ umbral → `kmCubiertos` alimenta `calcularEmisionesViaje` → poblar `*Actual` (**nivel primario**)». Leído literalmente contradice la matriz de ADR-028, donde `primario_verificable` exige `exacto_canbus`. Sin una decisión escrita, Task 10 y las siguientes producirían un número cuya validez comercial no está definida (`docs/frentes-vivos.md`, Slot 1). Este ADR es esa decisión.

Estado real de la telemetría al escribir esto (memoria operativa, jul–ago 2026): la huella medida por CAN no estuvo alimentada durante meses (0 elementos CAN en `io_data`); hoy un solo vehículo real (PLFL57) trae CAN. En la práctica, casi todos los viajes que se midan en F2 serán `secundario_modeled`. La decisión tiene que ser honesta con eso, no aspiracional.

## Decisión

### 1. `movil_gps` es una fuente de ruta de primera clase, distinta de `teltonika_gps`

Se agrega el valor **`movil_gps`** al enum `fuente_dato_ruta` (`routeDataSourceEnum`, migración expand-only `ALTER TYPE ... ADD VALUE`, sin `DROP`) y al tipo `RouteDataSource` de `@booster-ai/carbon-calculator`. Semántica: polyline real recorrido, medido por la Geolocation API del móvil del conductor y persistido en `posiciones_movil_conductor` mientras el assignment está `asignado|recogido`.

No se mapea el móvil a `teltonika_gps` (mentiría sobre el sensor) ni a `maps_directions` (ocultaría que la distancia fue medida). El certificado y la auditoría deben poder decir de dónde salió la distancia.

La fuente la decide el vehículo del assignment, en este orden y sin mezclar (Task 10, `services/posicion-segmento.ts`): `teltonika_imei` propio → `telemetria_puntos` por `vehiculo_id`; solo `teltonika_imei_espejo` → `telemetria_puntos` por `imei`; sin dispositivo → `posiciones_movil_conductor` por `vehiculo_id`. Las dos primeras son `teltonika_gps`; la tercera es `movil_gps`.

### 2. Nivel de certificación por fuente: la matriz de ADR-028 se extiende con estas filas

| `metodo_precision` | `fuente_dato_ruta` | `coverage_pct` | → `nivel_certificacion` | Distancia que alimenta el cálculo |
|---|---|---|---|---|
| `exacto_canbus` | `teltonika_gps` | ≥ 95 % | `primario_verificable` | medida (GPS del vehículo) |
| `exacto_canbus` | `teltonika_gps` | < 95 % | `secundario_modeled` | medida si ≥ 80 %, estimada si < 80 % |
| `modelado` / `por_defecto` | `teltonika_gps` | ≥ 80 % | `secundario_modeled` | **medida** (GPS del vehículo) |
| `modelado` / `por_defecto` | `teltonika_gps` | < 80 % | `secundario_modeled` | **estimada** (Routes) — `fuente_dato_ruta` pasa a `maps_directions` |
| `modelado` / `por_defecto` | **`movil_gps`** | ≥ 80 % | `secundario_modeled` | **medida** (GPS del móvil) |
| `modelado` / `por_defecto` | **`movil_gps`** | < 80 % | `secundario_modeled` | **estimada** (Routes) — `fuente_dato_ruta` pasa a `maps_directions` |
| `exacto_canbus` | `movil_gps` | (cualquiera) | `secundario_modeled` | combinación imposible por construcción (el CAN solo llega por Teltonika); si aparece, es un bug y NO da primario |
| (resto) | (resto) | | sin cambio respecto de ADR-028 §2 | |

Reglas que fija esta tabla:

- **`primario_verificable` exige las tres condiciones de ADR-028 y solo se alcanza con CAN + Teltonika ≥ 95 %.** La posición del móvil **nunca** produce `primario_verificable`, sin importar la cobertura. No hay medición de energía y no hay sensor fijo al vehículo.
- **El umbral binario ~80 % del plan (`THRESHOLD_SECUNDARIO_MODELED_PCT`) decide qué distancia alimenta el cálculo, no el nivel.** ≥ 80 % → la distancia real medida (`kmCubiertos`, Task 11) alimenta `calcularEmisionesViaje` y se puebla `distanceKmActual`; < 80 % → se usa la distancia estimada por ruta y la fuente persistida pasa a `maps_directions` (degradación explícita del corte #2 del spec, con métrica). En ambos casos el nivel es `secundario_modeled`.
- **La frase «nivel primario» del plan (Task 12) se lee como «distancia primaria (medida)», nunca como `primario_verificable`.** El plan no se edita (es artefacto fijado); esta línea es la interpretación vinculante.
- **`metodo_precision` para `movil_gps` es `modelado`** cuando la tipología del vehículo resuelve un factor GLEC (ADR-073) y `por_defecto` cuando no. Nunca `exacto_canbus`.

`derivarNivelCertificacion` incorpora `movil_gps` con exactamente estas filas; sigue siendo pura y el cliente sigue sin poder setear el nivel (ADR-028 §2, prevención de greenwashing).

### 3. Incertidumbre: `movil_gps` usa la misma regla que `teltonika_gps` modelado

Base 0.15 + `(1 − coverage_pct/100) × 0.20` si la cobertura cayó bajo 95 % (ADR-028 §3). **No se introduce una penalización específica por “GPS de teléfono”:** no hay base calibrada para un número, y un número inventado en un documento auditable es peor que ninguno. `posiciones_movil_conductor.accuracy_m` ya se persiste por posición; un modificador derivado de datos queda fuera de alcance de este ADR y entra, si entra, con evidencia propia.

### 4. Rotulado al cliente: una «línea de método» obligatoria, derivada, con vocabulario cerrado

El header y el template siguen los de ADR-028 §4 (`primario_verificable` → «Certificado de Huella de Carbono — Datos Verificables»; todo lo demás → «Reporte Estimativo de Huella de Carbono»). Lo que cambia: el reporte/certificado y la UI muestran **siempre** una línea de método derivada de `metodo_precision × fuente_dato_ruta × coverage_pct` — no de texto libre ni de un flag del cliente:

| Caso | Línea de método (español, con tildes) |
|---|---|
| `primario_verificable` | «Combustible medido por CAN bus del vehículo · Ruta GPS del vehículo (cobertura N %)» |
| `secundario_modeled` + `teltonika_gps` | «Distancia medida por GPS del vehículo (cobertura N %) · Consumo modelado según GLEC v3.0» |
| `secundario_modeled` + `movil_gps` | «Distancia medida por GPS del móvil del conductor (cobertura N %) · Consumo modelado según GLEC v3.0» |
| `secundario_modeled` + `maps_directions` | «Distancia estimada por ruta (Google Routes) · Consumo modelado según GLEC v3.0» |
| `secundario_default` / `manual_declared` | texto vigente de ADR-028 §4 (sin cambio) |

Vocabulario cerrado para el nivel secundario: la palabra **«medida»** aplica solo a la *distancia*; las *emisiones* son siempre **«modeladas»** o **«estimadas»**. Están prohibidas en secundario las palabras «verificable», «certificado» y «medición de emisiones». La UI de la app usa la misma línea (chip/tooltip en el detalle del viaje); no existe un segundo vocabulario.

### 5. Dónde aterriza (referencia para las tareas del plan)

| Cambio | Dueño |
|---|---|
| Enrutamiento de la fuente por vehículo, sin merge (`teltonika_gps` vs `movil_gps`) | Task 10 (`services/posicion-segmento.ts`) |
| Migración `ALTER TYPE fuente_dato_ruta ADD VALUE 'movil_gps'` + tipo `RouteDataSource` + filas nuevas en `derivarNivelCertificacion` (con sus tests) | Task 11/12 (la primera que persista la fuente) |
| Persistir `fuente_dato_ruta` = fuente real (`teltonika_gps` / `movil_gps`) o `maps_directions` al degradar por cobertura | Task 12 |
| Línea de método en `certificate-generator` (ambos templates) y en la UI | Task 12/13; si el template exige trabajo propio, entra como tarea explícita del mismo frente, no en silencio |

## Consecuencias

**Positivas.** El número que producen T10–T13 tiene validez comercial definida antes de existir. La distancia medida por móvil deja de ser invisible (no se disfraza de Teltonika ni de Routes) y la auditoría puede reconstruir de dónde salió cada km. Se cierra la ambigüedad «nivel primario» de Task 12 sin reabrir ADR-028. El vocabulario de cara al cliente es uno solo, cerrado y derivado.

**Negativas.** Un viaje medido por móvil no alcanza `primario_verificable` nunca: la vía a certificado verificable sigue siendo Teltonika con CAN (es también la vía comercial de ADR-026/028, no un accidente). Cuesta una migración de enum, un tipo, filas en la matriz con tests, y trabajo en la línea de método del certificado. Un cliente que solo opera con móvil verá siempre «Reporte Estimativo».

**Riesgos y mitigaciones.**
- *El móvil no está en el vehículo* (conductor deja el teléfono, cambia de camión): la distancia medida sería de otro recorrido. Mitigaciones vigentes: el endpoint de posición solo acepta al conductor asignado y con assignment `asignado|recogido`; el umbral de cobertura ≥ 80 % contra la distancia estimada de la ruta descarta recorridos incoherentes; la línea de método declara la fuente. No se promete más precisión de la que hay.
- *Tentación de leer «distancia medida» como «huella medida»*: el vocabulario cerrado del §4 existe para eso; el test del certificado debe fallar si aparece «verificable» en un secundario.
- *La combinación `exacto_canbus` + `movil_gps`*: imposible por construcción; la matriz la trata como `secundario_modeled` para que un bug de wire jamás fabrique un primario.

## Verificación (al implementar T11–T13)

```bash
# 1. El enum de BD conoce la fuente móvil (tras la migración)
grep -n "'movil_gps'" apps/api/src/db/schema.ts                       # esperado: 1 hit en routeDataSourceEnum

# 2. La matriz nunca da primario con móvil (test en carbon-calculator)
grep -n "movil_gps" packages/carbon-calculator/src/certificacion/*.test.ts | grep -c primario_verificable
#   → los casos con movil_gps deben ASERTAR secundario_modeled; ninguno debe esperar primario

# 3. El certificado secundario no usa vocabulario de primario
#    (test de certificate-generator: con route_data_source=movil_gps el HTML contiene
#     "GPS del móvil del conductor" y NO contiene "verificable")
```

Mientras esos artefactos no existan, este ADR rige como criterio de aceptación de las tareas que los crean.
