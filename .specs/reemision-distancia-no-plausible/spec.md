# Spec: reemision-distancia-no-plausible

- **Author**: agente (Claude), por encargo del PO («Sí, prepárala», chat del 2026-11-18)
- **Date**: 2026-11-18
- **Status**: propuesta; la acepta el PO en el PR (toca un contrato: la lista cerrada de motivos en la base, §4)
- **Linked**: [`.specs/distancia-medida-plausible/spec.md`](../distancia-medida-plausible/spec.md) (§6 dejó esto fuera), [`.specs/reemision-certificado/spec.md`](../reemision-certificado/spec.md) (§3.3 y §3.4), [ADR-091](../../docs/adr/091-sello-estimado-por-fuente-de-distancia.md), `apps/api/src/domain/decidir-fuente-huella.ts`, `apps/api/src/services/reemitir-certificado.ts`
- **Frente**: sin slot. Nace de certificados ya emitidos con una cifra que la regla vigente no habría publicado.
- **Dominio crítico** (huella/GLEC, escritura en prod): TDD con rojo exhibido.

## 1. Objetivo

Corregir en producción los certificados emitidos con una distancia medida que no
cubría el recorrido (la regla de [`distancia-medida-plausible`](../distancia-medida-plausible/spec.md)
entró el 2026-11-16, después de esas emisiones): dejar la huella guardada como
la dejaría hoy el cierre, y reemitir cada certificado con un motivo de la lista
cerrada para que la versión nueva publique la estimación.

El mecanismo sirve para cualquier viaje o ruta en esa situación. Qué viajes se
corrigen lo decide el PO, uno por corrida.

## 2. Estado verificado

Código en `main` (`a4518d2e`) y producción consultada en solo lectura el
2026-11-18 (`scripts/db/agent-query.sh`).

### 2.1 Los certificados afectados

| Viaje | Fuente guardada | km estimados | km medidos | Medido ÷ estimado | kg estimados | kg «reales» publicados | Certificado vigente | `certificados_viaje.fuente_distancia` |
|---|---|---|---|---|---|---|---|---|
| BOO-BKAXIK | `teltonika_gps` | 500,00 | 2,51 | 0,5 % | 33,475 | 2,691 | v1, 2026-09-14 | nulo (anterior a HC-001) |
| BOO-KY7G69 | `teltonika_gps` | 471,60 | 195,95 | 41,6 % | 539,315 | 224,092 | v1, 2026-10-20 | nulo |
| BOO-4FF3XA (ruta de prueba, 71,97 %) | `movil_gps` | 11,69 (directa) | ruta: 0,03 de 37,75 | 0,08 % | 20,864 | 0,015 | v1, 2026-11-16 | `movil_gps` |
| BOO-VZYIN2 (misma ruta, 28,03 %) | `movil_gps` | 6,83 (directa) | ruta: 0,03 de 37,75 | 0,08 % | 8,127 | 0,006 | v1, 2026-11-16 | `movil_gps` |

Los dos de la ruta imprimen además «Huella total de la ruta: 0,02 kg CO₂e»
(`metricas_ruta.emisiones_kgco2e_reales = 0,021`; la estimada es 28,991).
BOO-YWKZWR (504,72 km de 464,85) sigue medido y no entra aquí; su reemisión por
el factor ya tiene motivo.

### 2.2 Lo que existe

- La regla: `esDistanciaPlausible(medidaKm, referenciaKm)` en
  `decidir-fuente-huella.ts`, `PLAUSIBILIDAD_MIN_PCT = 50`, `DECISION_VERSION = 3`,
  motivo `distancia_no_plausible`.
- Lo que escriben los cierres cuando la medición no cuenta (`reconstruida = false`
  en `recalcularNivelPostEntrega` y en `cerrarHuellaDeRuta`): `distancia_km_real`
  y las cifras reales en `null`, `fuente_dato_ruta = maps_directions`,
  `cobertura_pct = 0`, nivel e incertidumbre recalculados, y en la ruta lo mismo
  sobre `metricas_ruta`. Con eso la plantilla publica la estimación.
- La reemisión (`reemitirCertificado`, job `reemitir-certificado.ts`): un viaje por
  corrida, en seco por defecto, versión nueva con la línea «Reemplaza a la
  versión N…», la anterior queda `reemplazado`. Hoy acepta un solo motivo,
  `factor_impreso_no_corresponde`, y corrige ella misma el dato antes de generar.
- `certificados_viaje` guarda por versión `fuente_distancia`, `motivo_fallback` y
  `decision_version`; `metricas_viaje.decidido_en` es la fecha de la última
  decisión de fuente.

### 2.3 Lo que falta

1. **Nada vuelve a derivar una huella guardada con la regla.** Los cierres la
   aplican a los viajes que se cierran desde el 2026-11-16; los anteriores
   conservan las cifras «reales» inverosímiles. `backfill-distancia-real.ts`
   reconstruye por su cuenta y tampoco pasa por la regla.
2. **La lista cerrada de motivos no tiene el caso.** `MOTIVOS_REEMISION` y la
   restricción `ck_certificados_viaje_motivo` solo admiten el factor.
3. **La reemisión no sabe reemitir «lo guardado».** Su única corrección es
   del factor, en memoria y en la base; y su §3.3 dice que las emisiones
   impresas no cambian.

## 3. Reglas

### 3.1 Dos pasos, dos jobs, la misma unidad que el cierre

La unidad de medición es la que midió el cierre: **la ruta** cuando el viaje la
compartió con otros servicios (`rutaCompartidaDelViaje`), **el viaje** cuando
fue solo. La distancia medida y la referencia son las de esa unidad
(`metricas_ruta.distancia_km_real` y `distancia_km_estimada`, o las de
`metricas_viaje`).

**Paso 1 — corregir la huella guardada** (`corregir-distancia-no-plausible`,
servicio y job). Para un código de seguimiento:

1. Comprueba: viaje `entregado` con métricas; si la ruta es compartida, que esté
   `cerrada` y tenga `metricas_ruta`; que la unidad tenga distancia medida
   (`sin_distancia_medida` si no); que **no** sea plausible según
   `esDistanciaPlausible` (`distancia_plausible` si lo es: no hay nada que
   corregir); que cada viaje de la unidad tenga emisiones estimadas
   (`sin_estimacion` si no: no habría cifra que publicar).
2. Escribe, en una transacción y con guarda sobre los valores leídos, **lo mismo
   que escribe hoy el cierre** cuando la medición no cuenta:

   | Fila | Columnas |
   |---|---|
   | `metricas_ruta` (solo con ruta compartida) | `distancia_km_real`, `emisiones_kgco2e_reales`, `combustible_consumido_l_real`, `emisiones_kgco2e_ttw`, `emisiones_kgco2e_wtt`, `intensidad_gco2e_por_tkm` → `null`; `fuente_dato_ruta = maps_directions`; `cobertura_pct = 0`; `nivel_certificacion` y `factor_incertidumbre` recalculados; `calculado_en = now()` |
   | `metricas_viaje` de cada viaje recogido de la unidad | las mismas seis cifras → `null`; `fuente_dato_ruta`, `cobertura_pct`, nivel e incertidumbre igual; `fuente_distancia = routes_estimada`; `motivo_fallback = distancia_no_plausible`; `decision_version = 3`; `decidido_en = now()` |
   | `eventos_viaje` de cada viaje | `carbono_calculado`, origen `sistema`, con la unidad, la distancia medida y la referencia, el mínimo, la fuente anterior, la cifra real anterior, la estimada que pasa a publicarse, si tenía certificado y quién lo pidió |

   El nivel y la incertidumbre salen de las mismas funciones que usa el cierre
   (`derivarNivelCertificacion`, `calcularFactorIncertidumbre`) con
   `maps_directions` y cobertura 0. No se recalcula nada con Routes ni con
   factores: la estimación ya está guardada.
3. Si una guarda no encuentra la fila como se leyó, la transacción se deshace
   y el job lo informa (`CorreccionConcurrenteError`).
4. En seco por defecto: imprime la unidad, los viajes, las cifras y si cada
   uno tiene certificado. Volver a correrlo sobre una unidad corregida responde
   `sin_distancia_medida` y no escribe.

**Paso 2 — reemitir** (`reemitir-certificado.ts` con
`MOTIVO=distancia_medida_no_plausible`, sin `FACTOR_*`). Un viaje por corrida,
como hasta hoy; una ruta de dos cargas son dos corridas. `prepararReemision`
comprueba, además de lo de siempre:

1. que la huella guardada fue corregida por esta regla:
   `motivo_fallback = distancia_no_plausible`, `fuente_dato_ruta = maps_directions`
   y `emisiones_kgco2e_reales` nula (`correccion_no_corresponde` si no);
2. que el certificado vigente es anterior a esa corrección:
   `certificados_viaje.emitido_en < metricas_viaje.decidido_en`
   (`correccion_no_corresponde` si no: ya se emitió con la huella corregida);
3. que hay emisiones estimadas que publicar (`datos_insuficientes` si no).

No toca `metricas_viaje` antes de generar: el PDF sale de lo guardado, igual que
una emisión. En la transacción, la guarda comprueba que esas tres columnas y la
huella del certificado vigente siguen como se leyeron; luego registra la versión
con el motivo y deja el evento `certificado_reemitido` con la fuente de
distancia anterior y la cifra que pasa a publicarse.

### 3.2 Enmienda a `.specs/reemision-certificado/` §3.3

«No recalcula emisiones» se mantiene: este motivo publica la estimación que ya
estaba guardada. «Las emisiones impresas no cambian» deja de valer para este
motivo: la cifra pasa de la «real» inverosímil a la estimada, y el certificado
pasa a la presentación Estimado (sello, badge y aviso), que es la que la regla
habría producido al cierre. Es la decisión 1 de §8.

### 3.3 Motivo y texto

`distancia_medida_no_plausible` → «la distancia medida no era plausible para el
recorrido». La línea «Reemplaza a la versión N, emitida el DD-MM-AAAA. Motivo:
…» sigue cabiendo en una línea (test existente que recorre la lista).

### 3.4 Lo que nunca hace

- No borra ni pisa PDF, firmas ni versiones anteriores.
- No reconstruye distancias ni recalcula con Routes o factores.
- No toca un viaje cuya distancia medida es plausible, ni uno cuya huella no
  fue corregida por esta regla.
- No reemite en lote ni corrige en lote: una unidad por corrida en el paso 1,
  un viaje por corrida en el paso 2.
- No avisa al generador (sigue como en la reemisión del factor).

## 4. Contratos públicos que cambian

Son decisión del PO.

| Contrato | Cambio |
|---|---|
| Esquema de base | `ck_certificados_viaje_motivo` admite `distancia_medida_no_plausible`. Migración `0087`, expand: reescribe la restricción; no toca filas. Reverso manual en `drizzle/down/`. |
| Certificado | Una versión reemitida por este motivo imprime la línea de reemplazo con ese texto y las cifras estimadas con la presentación Estimado. |
| Evento del viaje | Se reutiliza `carbono_calculado` para la corrección del paso 1, con payload propio. Sin valor nuevo en el enum. |
| Verificación pública | Sin cambio. |

## 5. Entrega

Un PR, con estas partes y su evidencia:

| # | Qué entra | Visto del PO |
|---|---|---|
| 1 | Motivo y texto en `certificate-generator`. | sí: certificado |
| 2 | Migración 0087 (restricción) y el `check` del schema. | sí: esquema |
| 3 | Servicio y job `corregir-distancia-no-plausible`, en seco por defecto. | sí: escribe en prod |
| 4 | `reemitirCertificado` y su job aceptan el motivo nuevo sin `FACTOR_*`. | no |
| 5 | README de jobs, handoff. | no |
| 6 | El PO corre el paso 1 por unidad y el paso 2 por viaje, en seco y luego real. | la ejecuta el PO |

## 6. Fuera de alcance

- Investigar por qué BOO-KY7G69 midió 195,95 km de 471,60.
- Avisar al generador del reemplazo (decisión 1 de la spec anterior, sin
  implementar también para el factor).
- Un reverso: igual que hoy, `revertirVersion` vuelve la versión pero no
  repone la huella guardada.
- `backfill-distancia-real.ts`.
- La pantalla del conductor y la web.
- «Fecha del viaje» y «Salida · Llegada» vacíos y la unidad del factor en la
  plantilla.

## 7. Criterios de éxito (verificables por test)

1. `MOTIVOS_REEMISION` incluye el motivo con su texto, y un certificado
   reemitido por él imprime la línea de reemplazo, el badge Estimado y las
   cifras estimadas (generador).
2. `prepararCorreccion`: viaje solo con 2,51 km de 500 → plan `viaje`; ruta de
   prueba con 0,03 km de 37,75 → plan `ruta` con sus dos viajes; 504,72 de
   464,85 → `distancia_plausible`; sin distancia medida → `sin_distancia_medida`;
   sin estimación → `sin_estimacion`; ruta abierta → `ruta_no_cerrada`.
3. `corregirDistanciaNoPlausible` contra Postgres: la ruta de prueba queda con
   `metricas_ruta` y los dos `metricas_viaje` como en §3.1, un evento por viaje,
   y `armarDatosEmision` de cada carga publica su estimación y el total estimado
   de la ruta con presentación Estimado. Correrlo de nuevo no escribe. Si la
   fila cambió, no escribe nada.
4. `reemitirCertificado` con el motivo: rechaza una huella sin corregir y un
   certificado posterior a la corrección; con la huella corregida crea la
   versión siguiente con el motivo, sin tocar `metricas_viaje` salvo el espejo,
   y deja el evento. En seco informa el motivo y la cifra que publicaría.
5. Jobs: el de corrección en seco imprime el plan y no escribe, y para escribir
   exige `CONFIRMAR_DESTINO`; el de reemisión acepta el motivo nuevo sin
   `FACTOR_*` y sigue exigiéndolos para el factor.
6. Tests, lint, typecheck y build en verde; cobertura ≥ 80 % en el código nuevo.

## 8. Decisiones del PO

| # | Pregunta | Recomendación |
|---|---|---|
| 1 | ¿Un certificado reemitido puede cambiar la cifra publicada (§3.2)? | Sí, solo con este motivo: la cifra nueva es la estimación guardada y el certificado dice por qué reemplaza a la anterior. Dejar circulando 0,02 kg firmados es peor. |
| 2 | ¿Qué unidades se corrigen? | Las tres: BOO-BKAXIK, BOO-KY7G69 y la ruta de prueba (BOO-4FF3XA + BOO-VZYIN2). KY7G69 cae a la estimación por la regla que el PO ya fijó; investigar su medición va aparte. |
| 3 | ¿Se avisa al generador? | No en este PR; igual que la reemisión del factor. |

## 9. Riesgos

- **Entre el paso 1 y el paso 2** el certificado vigente publica una cifra que
  la huella guardada ya no respalda. El job del paso 1 lo imprime por viaje, y
  ese estado es exactamente el que el paso 2 exige para reemitir.
- **Lo mismo que la reemisión del factor**: firmar y subir no son
  transaccionales con la base (objeto huérfano, nunca versión sin PDF); desde
  el Mac, KMS puede fallar al pedir el token.
- **Lectores de `metricas_ruta`**: la página Flota y los informes que lean la
  huella real de la ruta la verán nula tras el paso 1, igual que para una ruta
  cerrada hoy sin medición.

## 10. Plan TDD

1. Rojo: `packages/certificate-generator/test/reemision-plantilla.test.ts`
   (criterio 1), `apps/api/test/unit/corregir-distancia-no-plausible.test.ts`
   (criterio 2), `apps/api/test/unit/reemitir-certificado.test.ts` (criterio 4)
   y `apps/api/test/integration/reemision-distancia-no-plausible.integration.test.ts`
   (criterios 3 a 5), contra el código actual. La salida va en la Evidencia del PR.
2. Verde: partes 1 a 4 de §5.
3. `pnpm run ci` y la suite de integración local (`pnpm run ci` no la corre).

## 11. Evidencia

En el PR.
