# Spec: ruta-parada-servicio

- **Author**: agente (Claude), por encargo del PO
- **Date**: 2026-11-10
- **Status**: Aceptada por el PO en el chat del 2026-11-10 («Acepto las cuatro»), con las decisiones de §11. Frente fuera de slot en `docs/frentes-vivos.md`.
- **Linked**: [ADR-088](../../docs/adr/088-ruta-parada-servicio.md) (vigente desde el 2026-11-10), [ADR-089](../../docs/adr/089-reparto-huella-cargas-consolidadas.md), [ADR-090](../../docs/adr/090-matching-desde-la-carga-vehiculo-al-despachar.md), [ADR-061](../../docs/adr/061-trip-lifecycle-tabla-transiciones-pura.md), [ADR-073](../../docs/adr/073-tipologias-flota-configuracion-glec.md), `.specs/editar-anular-cargas/`, `.specs/seguimiento-publico-minimizacion/`

## 1. Objetivo

Un camión puede llevar en un mismo recorrido las cargas de varios generadores.
El transportista arma ese recorrido, el conductor lo ve como una lista ordenada
de paradas, y cada generador sigue viendo solo su carga.

Esta spec cubre ADR-088. Es la base de ADR-089 (reparto de huella) y ADR-090
(vehículo al despachar), que tienen spec propia y se construyen después (§9).

## 2. Estado verificado en main (`b9f40f3a`)

- `asignaciones.viaje_id` es `UNIQUE` y `asignaciones.vehiculo_id` es
  `NOT NULL`. `conductor_id` y `unidad_arrastre_id` viven en la asignación.
- `metricas_viaje.viaje_id` es llave primaria: distancia, huella y certificado
  son por viaje.
- No hay tabla de ruta ni de paradas.
- 26 archivos de `apps/api/src` (sin contar tests) leen vehículo, conductor o
  arrastre desde `asignaciones`. Los de más uso: `routes/assignments.ts`,
  `services/eco-routing-tiempo-real.ts`, `routes/vehiculos.ts`,
  `services/solicitud-cambio-carga.ts`, `services/cargar-gps-scorecard.ts`,
  `routes/trip-requests-v2.ts`.
- `vehiculos` tiene `capacidad_kg` (obligatoria) y `capacidad_m3` (opcional).
  `viajes` tiene `carga_peso_kg` y `carga_volumen_m3`, las dos opcionales.
- La última migración es `0077_solicitudes_cambio_viaje`.

## 3. Modelo

### 3.1 Tablas nuevas

**`rutas`**

| Columna | Tipo | Regla |
|---|---|---|
| `id` | uuid | llave primaria |
| `empresa_id` | uuid | transportista dueña de la ruta; obligatoria |
| `vehiculo_id` | uuid | unidad motriz; opcional mientras está `planificada` |
| `unidad_arrastre_id` | uuid | opcional (0..1, como hoy) |
| `conductor_id` | uuid | usuario conductor; opcional mientras está `planificada` |
| `estado` | enum `estado_ruta` | `planificada`, `en_curso`, `cerrada`, `cancelada` |
| `polilinea_planificada` | text | opcional |
| `iniciada_en`, `cerrada_en`, `cancelada_en` | timestamptz | opcionales |
| `creado_en`, `actualizado_en` | timestamptz | obligatorias |

**`paradas_ruta`**

| Columna | Tipo | Regla |
|---|---|---|
| `id` | uuid | llave primaria |
| `ruta_id` | uuid | obligatoria |
| `orden` | integer | posición en la ruta; única por ruta |
| `tipo` | enum `tipo_parada` | `recogida`, `entrega` |
| `viaje_id` | uuid | el servicio que se recoge o entrega ahí; obligatoria |
| `resuelta_en` | timestamptz | cuándo se confirmó la recogida o la entrega |

Un servicio tiene exactamente una parada de cada tipo por ruta (única por
`ruta_id`, `viaje_id`, `tipo`). La dirección, las coordenadas, la ventana y el
contacto de la parada se leen del servicio: no se copian.

**`eventos_ruta`**: quién cambió qué y cuándo (servicio agregado o quitado,
paradas reordenadas, vehículo o conductor declarados, cambio de estado).

### 3.2 Cambio en una tabla existente

`asignaciones.ruta_id`, uuid, opcional en la migración `expand`.

### 3.3 Qué no cambia

`viajes` conserva su nombre y sus columnas (decisión 2 de ADR-088). El enlace de
seguimiento sigue siendo por servicio. La máquina de estados del viaje
(ADR-061) no cambia sus transiciones.

## 4. Reglas

### 4.1 Una sola representación

Todo servicio asignado pertenece a una ruta. Aceptar una oferta crea, en la
misma transacción, una ruta `planificada` con dos paradas. No hay un camino de
código para la carga sola y otro para la consolidada.

### 4.2 Quién arma la ruta (decisión 1 de ADR-088)

El transportista agrupa servicios que ya aceptó. Agrupar es mover la asignación
de un servicio desde su ruta de dos paradas a otra ruta de la misma empresa; la
ruta que queda sin servicios pasa a `cancelada`. Booster no sugiere
agrupaciones en esta spec.

### 4.3 Estados de la ruta

| Desde | Hacia | Cuándo |
|---|---|---|
| `planificada` | `en_curso` | se confirma la primera recogida |
| `planificada` | `cancelada` | queda sin servicios, o el transportista la anula sin recogidas |
| `en_curso` | `cerrada` | todas las paradas están resueltas o su servicio fue cancelado |

Las transiciones viven como tabla pura en un paquete (§6), igual que ADR-061.
El estado de cada servicio avanza con sus paradas: recogida confirmada en su
parada de recogida, entrega confirmada en su parada de entrega.

### 4.4 Invariantes

Se validan al crear la ruta y en cada cambio. Una operación que rompe alguno
se rechaza con el motivo.

1. La parada de entrega de un servicio va después de su parada de recogida.
2. En ningún tramo la masa a bordo supera la capacidad útil de la
   configuración. Lo mismo con el volumen cuando el vehículo y todos los
   servicios a bordo lo declaran.
3. Un servicio está en una sola ruta no cancelada.
4. Una ruta `en_curso` tiene vehículo y conductor.
5. Todos los servicios de una ruta tienen asignación con la empresa de la ruta.

Un servicio sin peso declarado no entra en una ruta con otros servicios
(decisión 2 de ADR-089). Viaja solo, como hoy.

Mientras la ruta no tiene vehículo declarado, el invariante 2 no se evalúa; se
evalúa al declararlo y, si no cumple, el vehículo se rechaza.

### 4.5 Cambios con la ruta en curso (decisión 4 de ADR-088)

- **Agregar** un servicio: solo si su parada de recogida queda después de la
  última parada resuelta.
- **Quitar** un servicio: solo si no se ha recogido. Vuelve a una ruta propia
  de dos paradas, `planificada`.
- **Reordenar**: solo paradas no resueltas.

Con la ruta `planificada` las tres operaciones son libres dentro de los
invariantes. Cada operación deja un evento. Los cambios a los datos de un
servicio siguen `.specs/editar-anular-cargas/`.

### 4.6 Lo que ve el generador (decisión 3 de ADR-088)

El detalle de su carga dice «viaja con otras cargas» cuando su ruta tiene más
de un servicio. No ve cuántas, de quién, ni sus direcciones.

### 4.7 Seguimiento público

El enlace de un servicio muestra la posición del vehículo solo entre la
recogida y la entrega de ese servicio. No muestra otras paradas, direcciones
ni clientes. La hora estimada de llegada suma las paradas intermedias que
quedan antes de su entrega. Se mantienen las reglas de
`.specs/seguimiento-publico-minimizacion/`.

### 4.8 Hoja de ruta

Vista para el conductor y para la oficina: paradas en orden, qué se recoge y
qué se entrega en cada una, contacto, ventana y notas. Se arma desde `rutas` y
`paradas_ruta`. El documento descargable queda fuera de esta spec (§8).

## 5. Contratos públicos que cambian

Son decisión del PO. Se listan para su aceptación junto con esta spec.

| Contrato | Cambio |
|---|---|
| Esquema de base | tablas `rutas`, `paradas_ruta`, `eventos_ruta`; columna `asignaciones.ruta_id`; enums `estado_ruta` y `tipo_parada` |
| API del transportista | rutas nuevas bajo `/rutas`: listar, ver, mover un servicio a otra ruta, quitarlo, reordenar paradas, declarar vehículo y conductor |
| API del conductor | la asignación entrega además la ruta y sus paradas |
| API del generador | el detalle de la carga agrega `viaja_consolidada: boolean` |
| Respuestas existentes | las que entregan vehículo y conductor de una asignación conservan su forma; el dato sale de la ruta |

Los nombres exactos de rutas y campos se fijan en `plan.md` y se presentan al
PO antes del PR que los introduce.

## 6. Arquitectura

- Paquete nuevo `packages/route-planner`, puro: transiciones de estado de la
  ruta, cálculo de masa y volumen a bordo por tramo, y validación de los
  invariantes de §4.4. Sin acceso a base ni a red.
- Los servicios de `apps/api` cargan la ruta, llaman al paquete y persisten.
  No llevan lógica de invariantes dentro.
- Cada endpoint nuevo valida su entrada con Zod, abre un span y registra una
  métrica de negocio.

## 7. Entrega por partes

Cada parte es un PR que deja main desplegable.

| # | Qué entra | Visto del PO |
|---|---|---|
| 1 | `packages/route-planner` con sus tests. Sin base ni API. | no |
| 2 | Migración `expand`: tablas, enums y `asignaciones.ruta_id`. Aceptar una oferta crea la ruta de dos paradas. | sí: esquema de base |
| 3 | Relleno: una ruta de dos paradas por cada asignación existente. Toca datos. | sí, con corrida en seco registrada |
| 4 | Los lectores de vehículo, conductor y arrastre pasan a leer de la ruta. Se escribe en los dos lados. | no |
| 5 | API del transportista para agrupar, quitar, reordenar y declarar vehículo y conductor. | sí: API |
| 6 | Web del transportista: armar la ruta. Web del conductor: hoja de ruta. | sí: interfaz |
| 7 | Seguimiento público y hora estimada con paradas intermedias; «viaja con otras cargas» para el generador. | sí: API e interfaz |
| 8 | Migración `contract`: se retiran `vehiculo_id`, `conductor_id` y `unidad_arrastre_id` de `asignaciones`. Irreversible. | sí, con lista de verificación y corrida en seco |

Las partes 5, 6 y 7 se despliegan juntas: la API de agrupar sin la hoja de ruta
deja al conductor sin ver las paradas.

## 8. Fuera de alcance

- Reparto de huella y certificado de cargas consolidadas (ADR-089, spec
  propia). Las partes 5 a 7 no se despliegan sin ella (§9 y §11-1).
- Aceptar sin vehículo y declararlo al despachar (ADR-090, spec propia). En
  esta spec la asignación sigue naciendo con vehículo y la ruta lo hereda.
- Transbordo, optimización automática del orden de paradas, rutas con más de
  una empresa transportista y más de una unidad de arrastre.
- Documento descargable de la hoja de ruta.
- Que Booster sugiera agrupaciones.

## 9. Orden de la etapa 2

1. Esta spec, partes 1 a 4: la ruta existe para toda asignación y es la fuente
   del vehículo y del conductor. Nada cambia para los usuarios.
2. Spec de ADR-090 (vehículo al despachar): depende de que el vehículo viva en
   la ruta.
3. Esta spec, partes 5 a 7, junto con la spec de ADR-089 (reparto de huella).
   Salen en el mismo release: no hay consolidación sin certificado (§11-1).
4. Esta spec, parte 8.

## 10. Criterios de éxito

1. Tests de propiedad de `packages/route-planner` sobre rutas generadas: toda
   secuencia de operaciones aceptadas deja una ruta que cumple §4.4; toda
   operación que rompe un invariante se rechaza con su motivo.
2. Test de integración contra PostgreSQL: aceptar una oferta deja una ruta
   `planificada` con dos paradas y la asignación con `ruta_id`.
3. El relleno, en seco y contra una copia de producción: tantas rutas como
   asignaciones, cero asignaciones sin ruta, y vehículo, conductor y arrastre
   iguales a los de la asignación en todas.
4. Con los lectores cambiados (parte 4), las respuestas de la API que entregan
   vehículo y conductor son idénticas a las de antes para las mismas
   asignaciones. Va con test de regresión.
5. Tests de ruta de la API: agrupar, quitar y reordenar respetan §4.5 con la
   ruta `planificada` y `en_curso`; una empresa no opera rutas de otra.
6. Test del seguimiento público: el enlace de un servicio no entrega posición
   antes de su recogida ni después de su entrega, y nunca datos de otro
   servicio de la ruta.
7. Un servicio que viaja solo se comporta igual que hoy de punta a punta:
   recogida, entrega, cierre y certificado.
8. Tests, lint, typecheck y build en verde en cada PR; cobertura ≥ 80 % en el
   código nuevo.

`route-planner`, la migración, el relleno y el seguimiento son dominio
crítico: primero el test, con el rojo en la evidencia del PR.

## 11. Decisiones del PO (2026-11-10)

| # | Pregunta | Decisión |
|---|---|---|
| 1 | ¿Se acepta salir con consolidación sin certificado mientras no esté ADR-089? | No. La consolidación y el reparto de huella salen juntos. |
| 2 | ¿Una ruta puede juntar servicios de más de un generador desde el primer día? | Sí. |
| 3 | ¿El conductor puede reordenar paradas? | No. Solo la oficina; el conductor ve el orden y confirma cada parada. |
| 4 | ¿Qué lugar toma este frente en `docs/frentes-vivos.md`? | Fuera de slot, por pedido del PO. Los tres slots de la fase A no cambian. |
