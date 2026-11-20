# Spec: matching-desde-la-carga

- **Author**: agente (Claude), por encargo del PO
- **Date**: 2026-11-10
- **Status**: Aceptada por el PO en el chat del 2026-11-11 («Acepto las ocho»), con las decisiones de §11.
- **Linked**: [ADR-090](../../docs/adr/090-matching-desde-la-carga-vehiculo-al-despachar.md) (vigente desde el 2026-11-10), [ADR-088](../../docs/adr/088-ruta-parada-servicio.md), [ADR-073](../../docs/adr/073-tipologias-flota-configuracion-glec.md), [ADR-077](../../docs/adr/077-nivel-certificacion-por-fuente-de-posicion.md), `.specs/ruta-parada-servicio/`
- **Frente**: «Ruta, parada y servicio (etapa 2)», fuera de slot en `docs/frentes-vivos.md`.

## 1. Objetivo

La oferta de una carga va a la empresa que tiene con qué llevarla, no a un
camión en particular. La empresa acepta, y declara el vehículo y el conductor
cuando despacha. Sin vehículo y conductor declarados no hay recogida.

## 2. Estado verificado

En main (`b9f40f3a`):

- `services/matching.ts` busca empresas transportistas activas con zona de
  recogida en la región de origen, y dentro de cada una elige el vehículo
  activo con `capacidad_kg` ≥ peso de la carga y menor capacidad. No mira
  carrocería ni tipo de carga.
- La oferta guarda ese vehículo en `ofertas.vehiculo_sugerido_id`. Al aceptar,
  `services/offer-actions.ts` lo copia a `asignaciones.vehiculo_id`, que es
  obligatorio.
- `vehiculos` tiene `carroceria` (enum `tipo_carroceria`, 10 valores,
  opcional), `categoria_unidad`, `capacidad_kg` y `capacidad_m3` (opcional).
- `viajes` tiene `tipo_carga` (enum de 11 valores), `carga_peso_kg` y
  `carga_volumen_m3`, las dos opcionales.

En producción, consultado el 2026-11-10 en solo lectura:

- 16 vehículos activos, todos unidades motrices y **ninguno con carrocería
  declarada**. No hay unidades de arrastre.
- 17 viajes: 16 `carga_seca` y 1 `agricola`. Todos con peso; 11 sin volumen.
- 10 asignaciones, 2 sin conductor.

## 3. Reglas

### 3.1 Requisitos de la carga

Salen del servicio: peso, volumen cuando está declarado y `tipo_carga`.

El anexo de tipos de ADR-090 no está aprobado (decisión 4 de ADR-090). Hasta
que se valide, esta spec usa el enum `tipo_carga` vigente y **no agrega
columnas de naturaleza ni de embalaje**.

### 3.2 Configuración

Una configuración es una unidad motriz activa sola, o una unidad motriz activa
con una unidad de arrastre activa de la misma empresa (0..1, como hoy). Su
capacidad útil y su carrocería efectiva se calculan como fija ADR-073; la
fórmula exacta se cita en `plan.md`.

### 3.3 Elegibilidad

Una empresa es candidata para una carga si tiene al menos una configuración
que cumple a la vez:

1. capacidad útil ≥ peso de la carga;
2. carrocería compatible con el `tipo_carga`.

El volumen no descarta (§11-5). Cuando la carga y la configuración lo declaran
y el de la configuración no alcanza, queda un aviso: la configuración sigue
siendo elegible, se ordena después de las que sí alcanzan, y el caso se
registra en la comparación del matching.

### 3.4 Tabla de compatibilidad

Es dato y función pura en `packages/matching-algorithm`, con un test por cada
par (`tipo_carga`, `tipo_carroceria`): 110 pares, cada uno compatible o no.
La tabla inicial la propone el agente en `plan.md`, con los pares dudosos
marcados, y la aprueba el PO antes del PR que la introduce (§11-2).

### 3.5 Vehículo sin carrocería declarada

Hoy es el caso de toda la flota (§2). Un vehículo sin carrocería declarada es elegible solo para `carga_seca` y `otra`. Desde este release la carrocería es obligatoria al crear o editar un vehículo (§11-1).

### 3.6 La oferta

Va a la empresa. `ofertas.vehiculo_sugerido_id` se mantiene y pasa a ser la
unidad motriz de la configuración elegible de menor capacidad. Es una
sugerencia para la oficina; no obliga.

### 3.7 Aceptar

Aceptar no exige vehículo. La asignación nace con su ruta `planificada` sin
vehículo ni conductor (`.specs/ruta-parada-servicio/` §3.1).

### 3.8 Declarar al despachar

La oficina declara vehículo, arrastre y conductor en la ruta. El sistema
rechaza, con el motivo, una configuración que no cumple §3.3 para alguno de
los servicios de la ruta, o que rompe la capacidad por tramo
(`.specs/ruta-parada-servicio/` §4.4).

No se puede confirmar la recogida de un servicio cuya ruta no tiene vehículo y
conductor.

### 3.9 Plazo (decisión 1 de ADR-090)

Se puede declarar hasta el inicio de la ventana de recogida. Antes, la oficina
recibe recordatorios. Si la ventana empieza y la ruta sigue sin vehículo, el
generador recibe un aviso. Los recordatorios salen 24 horas y 2 horas antes del inicio de la ventana
(§11-3).

### 3.10 Unidad de un tercero (decisión 2 de ADR-090)

La transportista puede registrar un vehículo que no es suyo, con patente y
tipología, marcado como unidad de tercero. Se declara en la ruta igual que uno
propio. La responsabilidad ante el generador es de la empresa que aceptó. Su
huella se calcula con ese vehículo y su nivel de certificación sale de la
fuente de posición disponible (ADR-077).

### 3.11 Lo que ve el generador (decisión 3 de ADR-090)

Antes de la declaración ve «vehículo por asignar». Desde la declaración ve lo
mismo que ve hoy del vehículo asignado. No ve si la unidad es de un tercero
(§11-4).

### 3.12 Huella

Antes de declarar el vehículo, la estimación usa los valores por defecto de la
clase más chica que cumple §3.3, y se recalcula al declararlo. Todo servicio
recogido tiene vehículo, así que el cálculo real no cambia.

### 3.13 Cambio de vehículo

Antes de la primera recogida de la ruta, la oficina lo cambia dentro de §3.3 y
§3.8. Después de una recogida no se cambia: sería un transbordo.

## 4. Contratos públicos que cambian

Son decisión del PO.

| Contrato | Cambio |
|---|---|
| Esquema de base | `asignaciones.vehiculo_id` pasa a opcional (`expand`); `vehiculos` agrega `es_de_tercero` (boolean, falso por defecto) |
| API de ofertas | aceptar ya no falla por falta de vehículo sugerido |
| API del transportista | declarar y cambiar vehículo, arrastre y conductor de una ruta; el rechazo trae un código de motivo |
| API de recogida | nuevo rechazo: ruta sin vehículo o sin conductor |
| API y web del generador | el vehículo de la carga puede venir vacío: «por asignar» |
| API de flota | alta y edición de vehículos aceptan `es_de_tercero` y exigen `carroceria` |

## 5. Arquitectura

- `packages/matching-algorithm`: tabla de compatibilidad, `configuracionesElegibles`
  y `empresaEsCandidata`, puras y con tests.
- `packages/route-planner` (de `.specs/ruta-parada-servicio/`): valida la
  configuración declarada contra los servicios de la ruta.
- `services/matching.ts` y `apps/matching-engine` cargan datos y llaman a los
  paquetes. No llevan la regla dentro.

## 6. Entrega por partes

Empieza cuando las partes 1 a 4 de `.specs/ruta-parada-servicio/` están en
main: el vehículo ya vive en la ruta.

| # | Qué entra | Visto del PO |
|---|---|---|
| 1 | Tabla de compatibilidad y funciones de elegibilidad en el paquete, con tests. | sí: aprueba la tabla |
| 2 | El matching usa la elegibilidad. Detrás de un flag, con comparación en sombra contra el matching vigente. | no |
| 3 | Migración `expand`: `asignaciones.vehiculo_id` opcional y `vehiculos.es_de_tercero`. | sí: esquema de base |
| 4 | Aceptar sin vehículo, declarar en la ruta, bloqueo de la recogida y estimación por defecto. | sí: API |
| 5 | Recordatorios a la oficina y aviso al generador. | sí: textos y momentos |
| 6 | Web: la oficina declara y cambia; el generador ve «por asignar»; alta de unidad de tercero. | sí: interfaz |

Las partes 4, 5 y 6 se despliegan juntas.

## 7. Fuera de alcance

- Los ejes nuevos de tipo de carga (naturaleza y embalaje) y el retiro del
  enum `tipo_carga`. Esperan la validación del anexo de ADR-090.
- Requisitos de temperatura controlada, carga peligrosa y sobredimensión como
  campos propios. Hoy se expresan solo con `tipo_carga`.
- Más de una unidad de arrastre.
- Transbordo.
- Verificar documentos o permisos de la unidad de un tercero.

## 8. Criterios de éxito

1. Un test por cada uno de los 110 pares de la tabla, y tests de
   `empresaEsCandidata` con configuraciones de motriz sola y con arrastre.
2. Test de regresión del matching: con la flota y las cargas de producción al
   2026-11-10, las empresas candidatas de cada carga son las mismas que con el
   matching vigente para las cargas `carga_seca`, y ninguna para la carga
   `agricola` (§3.5). Una de las cargas `carga_seca` lleva aviso de
   volumen (§11-5).
3. Test de integración contra PostgreSQL: aceptar una oferta sin vehículo
   sugerido deja la asignación y su ruta sin vehículo.
4. Tests de ruta de la API: declarar una configuración no elegible se rechaza
   con su motivo; confirmar la recogida sin vehículo o sin conductor se
   rechaza; cambiar el vehículo después de una recogida se rechaza.
5. Test de la estimación: sin vehículo usa la clase más chica elegible; al
   declararlo se recalcula.
6. Tests de los recordatorios y del aviso al generador según §3.9.
7. Tests, lint, typecheck y build en verde; cobertura ≥ 80 % en el código
   nuevo.

Matching y migraciones son dominio crítico: primero el test, con el rojo en la
evidencia del PR.

## 9. Riesgo principal

Con la regla de §3.5, la carga `agricola` de producción no tendría candidatas
hasta que alguna transportista declare carrocería. La parte 2 sale detrás de
un flag y con comparación en sombra para ver ese efecto antes de activarla.

## 10. Dependencias

- `.specs/ruta-parada-servicio/` partes 1 a 4.
- La validación del anexo de ADR-090, solo para lo que §7 deja fuera.

## 11. Decisiones del PO (2026-11-11)

El PO aceptó las cuatro recomendaciones. La quinta la tomó el mismo día, con
el resultado de la parte 2 a la vista.

| # | Pregunta | Decisión |
|---|---|---|
| 1 | Un vehículo sin carrocería declarada, ¿para qué cargas es elegible? Hoy son los 16 vehículos activos. | Elegible solo para `carga_seca` y `otra`, que son 16 de los 17 viajes de producción, y pedir la carrocería como obligatoria en el alta y la edición de vehículos desde este release. Así nada se detiene y la flota se completa sola. |
| 2 | ¿Quién propone la tabla de compatibilidad de 110 pares? | El agente la propone en `plan.md`, marcando los pares dudosos, y el PO la aprueba antes del PR. |
| 3 | ¿Cuándo se recuerda a la oficina que falta declarar el vehículo? | 24 horas y 2 horas antes del inicio de la ventana de recogida, por los canales que ya usan los recordatorios de cambios de carga. |
| 4 | ¿El generador ve que el camión es de un tercero? | No. Ve la patente y el tipo, como con cualquier vehículo; responde la empresa que aceptó. |
| 5 | El volumen declarado, ¿descarta candidatas? (2026-11-11, tras la parte 2) | No: «solo avisar». Con la flota de producción, la regla original dejaba sin candidatas a una carga seca de 22.000 kg y 100 m³ porque el único camión que alcanza el peso declara 50 m³, y los volúmenes declarados no son confiables (un camión de 10.000 kg con 500 m³). El volumen se compara y se registra como aviso; se vuelve a evaluar cuando el dato de la flota esté corregido. |
