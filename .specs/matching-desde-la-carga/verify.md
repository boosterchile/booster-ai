# Verificación: matching-desde-la-carga

## Parte 2 — elegibilidad detrás de un modo, con sombra (2026-11-11)

`MATCHING_ELEGIBILIDAD_MODO` decide qué regla elige a las candidatas:

| Modo | Quién decide las ofertas | Qué más hace |
|---|---|---|
| `vigente` (por defecto) | el matching de hoy: un vehículo activo con capacidad para el peso | nada; la elegibilidad por carga no corre |
| `sombra` | el matching de hoy | calcula la elegibilidad por carga al lado y registra la diferencia |
| `activa` | la elegibilidad por carga (carrocería, volumen, configuraciones con arrastre) | registra la misma comparación |

En sombra, si el cálculo nuevo falla, el matching sigue con la regla de hoy y
el error queda en el log. En `activa` un fallo hace fallar el matching: no
decide con la regla anterior en silencio.

La comparación queda en:

- el log `matching: elegibilidad por carga`, con el viaje, el tipo de carga,
  cuántas candidatas dio cada regla, y las empresas que solo aparecen en una o
  que cambian de vehículo sugerido;
- la métrica `matching_elegibilidad_comparaciones_total`, con `modo` y
  `resultado` (`coincide` o `difiere`).

### Cómo se activa

Desde el 2026-11-11 la variable está en Terraform
(`var.matching_elegibilidad_modo`, `infrastructure/variables.tf`) con `sombra`
por defecto: el PO pidió activar la sombra ese día. Rige en producción cuando
se aplica Terraform. Pasar a `activa` es una activación en producción y la
decide el PO; volver a `vigente` es cambiar la variable y re-aplicar.

### Criterio 2 de la spec, con la flota y las cargas del 2026-11-10

Probado en `packages/matching-algorithm/test/elegibilidad-candidatas.test.ts`
con la flota activa (16 vehículos de 4 empresas, sin carrocería declarada) y
los 17 viajes, leídos de producción en solo lectura y sin identificadores.

| Carga | Resultado |
|---|---|
| Los 16 viajes `carga_seca` | mismas empresas que el matching de hoy |
| `carga_seca` de 22.000 kg y 100 m³ | misma empresa, **con aviso de volumen** |
| `agricola` de 10.000 kg | hoy se ofrece a dos empresas; con la regla nueva, a ninguna (spec §9) |

### El volumen: de descartar a avisar

La primera versión de la parte 2 (#918) aplicaba la regla original de la spec
§3.3: volumen útil ≥ volumen de la carga cuando los dos están declarados. Con
esa regla el viaje de 22.000 kg y 100 m³ quedaba sin candidatas, porque el
único vehículo que alcanza el peso declara 50 m³.

Los volúmenes declarados en la flota no son confiables (un camión de 10.000 kg
con 500 m³; uno de 28.000 kg con 50 m³). El PO decidió el 2026-11-11 que el
volumen **solo avise** (spec §11-5):

- no descarta ninguna configuración;
- entre las que sirven, se sugiere primero una sin aviso;
- la comparación del matching lista en `volumenInsuficiente` las empresas cuya
  configuración sugerida declara menos volumen que la carga. No cuenta como
  diferencia entre las dos reglas.

Se vuelve a evaluar cuando el dato de la flota esté corregido.

### Algo que la sombra dejó a la vista

El matching de hoy trata a una unidad de arrastre como si fuera un vehículo:
con un tracto y un semirremolque, sugiere el semirremolque en la oferta. En
producción no ocurre porque no hay unidades de arrastre registradas. La regla
nueva sugiere siempre la unidad motriz.

### Lo que no cubre

- No se corrió en sombra contra tráfico real: la variable no está activada.
- La comparación mira candidatas por flota. El puntaje y el orden entre
  candidatas no cambian en esta parte.

## Parte 3 — migración `expand` 0079 (2026-11-11)

`apps/api/drizzle/0079_asignacion_vehiculo_opcional.sql`:

- `asignaciones.vehiculo_id` deja de ser obligatorio (conserva su llave
  foránea);
- `vehiculos.es_de_tercero`, booleano, obligatorio, falso por defecto.

No toca filas existentes. Ningún código escribe todavía una asignación sin
vehículo ni una unidad de tercero.

### Seguridad del despliegue

- **Rollback de código:** seguro. Una revisión anterior nunca ve un
  `vehiculo_id` nulo, porque nadie lo escribe, y no conoce la columna nueva.
- **Reverso del esquema:** manual, en `down/`. Solo es seguro mientras no haya
  asignaciones sin vehículo ni unidades de tercero; el archivo trae las dos
  consultas para comprobarlo.
- **Bloqueo:** `DROP NOT NULL` y `ADD COLUMN` con valor por defecto constante
  toman un bloqueo breve y no reescriben la tabla.

### Lo que la parte 4 tiene que resolver antes de escribir un vehículo nulo

La expresión `vehiculoDeAsignacion` está tipada como texto no nulo, y los
lectores cuentan con eso. Con el esquema de hoy es cierto. Cuando aceptar deje
de exigir vehículo:

| Uso | Dónde | Qué pasa con una asignación sin vehículo |
|---|---|---|
| `INNER JOIN` al vehículo | 8 consultas en 6 servicios: seguimiento público, traza de la carga, eco-ruta en tiempo real, tablero de conducción (2), relleno de distancia (2), observatorio | la fila desaparece del resultado |
| `LEFT JOIN` al vehículo | 9 consultas en 6 archivos: rutas de asignaciones (3), `me`, zonas de stakeholders, detalle de la carga, eco-ruta, correo de seguimiento (2) | patente y tipo llegan vacíos; el contrato de la respuesta tiene que decir «por asignar» |
| Columna leída como texto | 18 lecturas en 14 archivos, entre ellas métricas del viaje, certificado y puntaje de conducción | reciben nulo donde el tipo dice texto |
| Filtro por vehículo | 4 consultas | no cambia: una asignación sin vehículo no calza con ninguno |

Los servicios de medición (métricas, certificado, puntaje, traza) solo corren
desde la recogida, y la spec §3.8 impide recoger sin vehículo: ahí el nulo no
llega. Los que sí lo verán son los que muestran la asignación antes de
despachar. La parte 4 cambia el tipo de la expresión a «texto o nulo» y
recorre esos lectores con el compilador.

### Numeración

El PR #904, abierto, también usa el número 0079. El que entre segundo
renumera su migración a 0080.

## Parte 4 — Aceptar sin vehículo (2026-11-13)

- `acceptOffer` escribe `vehiculo_id` null (no `''`); la ruta hija nace sin
  vehículo. Integration: `aceptar-sin-vehiculo.integration.test.ts`.
- `confirmarRecogidaViaje` rechaza con `ruta_sin_vehiculo` /
  `ruta_sin_conductor`.
- Estimación sin vehículo: `claseMasChicaElegible` (matching-algorithm), con
  el volumen de la carga; al declarar, `estimarHuellaDeRuta` recalcula.
- Flota API: `body_type` obligatorio create; `es_de_tercero` en create/PATCH.
- Tracking público: LEFT JOIN al vehículo; sin patente responde
  `por_asignar` («Vehículo por asignar»).
- Lectores pre-despacho (trips/assignments/`me`): LEFT JOIN / null seguro.

## Parte 5 — Recordatorios vehículo pendiente (2026-11-13)

Job `POST /admin/jobs/vehiculo-pendiente-recordatorio` (mismo estilo que
solicitudes de cambio):

| Etapa | Condición | Destinatario | Marca de idempotencia |
|---|---|---|---|
| 24 h | `now ∈ [inicio−24h, inicio−2h)` y sin vehículo | oficina transportista | `asignaciones.recordatorio_vehiculo_24h_en` |
| 2 h | `now ∈ [inicio−2h, inicio)` y sin vehículo | oficina transportista | `asignaciones.recordatorio_vehiculo_2h_en` |
| Vencido | `now ≥ inicio` y sin vehículo | generador | `asignaciones.aviso_generador_sin_vehiculo_en` |

Canales: `notifyCambioCarga` (Web Push). Migración expand `0083`. Scheduler
en `infrastructure/vehiculo-pendiente.tf` (sin IAM; apply lo hace el PO).

Evidencia: unit `recordar-vehiculo-pendiente`, `admin-jobs-vehiculo-pendiente`,
`notify-cambio-carga` (eventos nuevos); integration
`recordar-vehiculo-pendiente.integration.test.ts`. Si el push falla o
`enviados===0`, se libera la marca y la etapa se reintenta.

## Parte 6 — Web (2026-11-13)

- Generador (`cargas`, `carga-track`, tracking público): sin patente →
  «Vehículo por asignar». No ve `es_de_tercero`.
- Oficina (`rutas`): opción «Elegir camión» cuando falta declarar; errores
  422 de elegibilidad visibles.
- Flota (`vehiculos`): carrocería obligatoria create/edit; checkbox unidad
  de tercero.

Evidencia: tests de `cargas`, `rutas`, `vehiculos`, `carga-track`,
`public-tracking`.

**Prod usable de declarar en rutas** sigue dependiendo de
`RUTAS_API_ACTIVADA` (PO). El cron de recordatorios requiere
`terraform apply` del archivo `vehiculo-pendiente.tf` (sin IAM nuevo).
