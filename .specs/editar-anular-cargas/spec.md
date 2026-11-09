# Spec — Editar y anular cargas

- **Author:** Felipe Vicencio (PO) + agente
- **Date:** 2026-11-09
- **Status:** Aceptada por el PO (2026-11-09); el modelo de datos tiene su visto
- **Linked:** `packages/trip-state-machine/src/transiciones.ts` · `apps/api/src/routes/{trip-requests-v2,assignments,admin-jobs}.ts` · `apps/api/src/services/{matching,offer-actions,confirmar-recogida-viaje,confirmar-entrega-viaje,liquidar-trip,cotizacion-comercial,notify-tracking-link}.ts` · [ADR-061](../../docs/adr/061-trip-lifecycle-tabla-transiciones-pura.md) · [ADR-076](../../docs/adr/076-gobernanza-operador-unico.md) · [ADR-079](../../docs/adr/079-modelo-comercial-v3.md) · `.specs/fix-viajes-cancel-accept-race/`

---

## 1. Objetivo

El Generador de Carga puede editar y anular sus cargas (tabla `viajes`). Nada se borra físicamente. Cada cambio queda registrado con autor y fecha. Cuando el cambio afecta a un transportista ya comprometido, el transportista lo acepta o se le avisa.

Después del match, el precio y la modalidad también se pueden cambiar, siempre con aceptación del transportista (§12-P3). Es dominio crítico de pricing: TDD con el rojo exhibido.

**Fuera del objetivo:** cambiar el modelo comercial ([ADR-079](../../docs/adr/079-modelo-comercial-v3.md)), reactivar cargas expiradas y cancelar o cambiar un servicio con la carga ya recogida.

## 2. Decisiones de base del PO (2026-11-09)

Estas decisiones no se reinterpretan. El detalle de cada punto abierto está en §12.

1. **Antes del match** (sin oferta aceptada ni asignación), el generador edita todo.
2. **Después del match**, edita libremente el contacto del destinatario, las notas y la referencia. Todo lo demás (origen, destino, tipo de carga, peso, volumen, descripción, ventana de recogida, precio y modalidad) requiere que el transportista acepte el cambio.
3. **«Eliminar» significa anular con rastro.**
   - Antes del match, la carga se anula: desaparece de las listas, pero queda en la BD con fecha y autor.
   - Después del match es «cancelar», y se avisa al transportista.
   - Nunca hay borrado físico.

**Definición operativa de «match»:** existe una fila en `asignaciones`. Equivale a `estado ∈ {asignado, en_proceso, entregado}`, o a `cancelado` con asignación.

## 3. Estado verificado en main

Verificado con `git fetch` contra `origin/main` el 2026-11-09 (HEAD `65d6cdc5`).

**Máquina de estados** (`packages/trip-state-machine/src/transiciones.ts`)
- `TRANSICIONES` (l.21-29): `borrador→[esperando_match, cancelado]`, `esperando_match→[emparejando, cancelado]`, `emparejando→[ofertas_enviadas, expirado, cancelado]`, `ofertas_enviadas→[asignado, cancelado, expirado]`, `asignado→[en_proceso, entregado]`, `en_proceso→[entregado]`.
- No existe `anulado`.
- `esCancelablePorShipper = puedeTransicionar(e, 'cancelado')` (l.63). Su único consumidor en código es `trip-requests-v2.ts:982`.
- `transiciones.test.ts:96-97` exige que `entregado`, `cancelado` y `expirado` sean terminales sin salidas.

**Cancelación actual** (`apps/api/src/routes/trip-requests-v2.ts`)
- `PATCH /:id/cancelar` (~l.941) corre en una tx con `FOR UPDATE`: pone el estado en `cancelado`, pasa las ofertas `pendiente→expirada` y registra el evento `cancelado`. No notifica a nadie.
- `viajes` no tiene columnas de cancelación.
- `asignaciones` tiene `cancelado_por_actor` (enum `actor_cancelacion`: transportista, generador_carga, admin_plataforma), `razon_cancelacion` y `cancelado_en` (schema.ts:1495-1500). Nadie las escribe.
- `estado_asignacion` ya incluye `cancelado`.
- Como `asignado` no admite `cancelado` hoy, toda carga cancelada existente es anterior al match.

**Listado y detalle**
- `GET /` (l.493) ya hace `LEFT JOIN asignaciones` (l.531) y no filtra cancelados.
- `serializeTripDetail` (l.1064) no devuelve el destinatario.
- El bloque de asignación del detalle (l.600-620) expone empresa, patente, nombre del conductor y `agreed_price_clp`, pero ningún teléfono. El teléfono del usuario vive en `usuarios.telefono` y `usuarios.whatsapp_e164` (schema.ts:687, 689).

**Datos de creación** (`packages/shared-schemas/src/trip-request-create.ts`)
- `origin`, `destination`, `cargo{cargo_type, weight_kg, volume_m3?, description?}`, `pickup_window`, `proposed_price_clp` (l.157, `int ≥ 0` o null), `modalidad_carga` (l.162, default `spot`) y `consignee{name?, phone_e164?}`.
- La columna del teléfono es `destinatario_whatsapp_e164` (schema.ts:1393).
- No hay notas ni referencias.

**Precio, comisión y liquidación** (dominio crítico)
- Al publicar, con `PRICING_V3_ACTIVATED`, el POST congela `comision_pct_aplicada = tasaParaPublicacion(config vigente, modalidad)` y `configuracion_comercial_id` (`trip-requests-v2.ts:323-335`, escritos en l.378-383). `programada` exige `modalidadPermitida` (l.311-319, `cotizacion-comercial.ts:31`).
- `runMatching` copia el precio a la oferta: `ofertas.precio_propuesto_clp = viajes.precio_propuesto_clp ?? 0` (`matching.ts:309-316`).
- `acceptOffer` fija `asignaciones.precio_acordado_clp = oferta.precio_propuesto_clp` (`offer-actions.ts:202`, columna NOT NULL en schema.ts:1492) y lo deja en el evento `oferta_aceptada` (l.259).
- El desglose del detalle del generador se arma con `viajes.precio_propuesto_clp`, `comision_pct_aplicada` y el IVA de la configuración congelada (`trip-requests-v2.ts:564-584`). No usa `precio_acordado_clp`.
- `liquidarTrip` corre al confirmar la entrega (`trip-requests-v2.ts:847` y `confirmar-entrega-viaje.ts:360`). En v3 usa `asignaciones.precio_acordado_clp`, `viajes.comision_pct_aplicada` y el IVA de `viajes.configuracion_comercial_id` (`liquidar-trip.ts:283-308`). Es idempotente por `UNIQUE(liquidaciones.asignacion_id)`.
- En v2 la comisión sale del tier de membresía del transportista, no de la modalidad (`liquidar-trip.ts:166-210`).
- No hay pagos antes de la entrega: `eventos-pago.ts` parte de `liquidaciones` (l.128-138), y `registrarEventoPago` solo lo llaman los flujos de mandato y admin.

**Ofertas y matching**
- `ofertas` tiene `UNIQUE(viaje_id, empresa_id)`, llamado `uq_ofertas_viaje_empresa` (schema.ts:1461, migración 0004).
- `runMatching` hace todo en una sola tx (`matching.ts:122`): CAS a `emparejando` (l.146), un INSERT plano de ofertas (l.321) y un CAS de salida (l.350/433). Por eso `emparejando` nunca queda commiteado.
- El filtro de capacidad del matching es `vehiculos.capacidad_kg ≥ peso` (`matching.ts:240`).
- `estado_oferta` vale: pendiente, aceptada, rechazada, expirada, reemplazada.

**Carrera latente en `acceptOffer`** (`apps/api/src/services/offer-actions.ts`)
- La función lee y valida la oferta **sin lock** (l.137-150), **antes** del `FOR UPDATE` del viaje (l.156-161).
- El `UPDATE … 'aceptada'` (l.176-185) filtra solo por `id`, sin CAS sobre `estado='pendiente'`.
- Hoy no se explota, porque ninguna transición devuelve un viaje a `ofertas_enviadas`.
- `calcularMetricasEstimadas` corre al aceptar la oferta (l.289). Es recalculable: hace upsert sobre `metricas_viaje` (`calcular-metricas-viaje.ts:375-381`).

**Salidas de `asignado`**
- `PATCH /assignments/:id/confirmar-recogida` (`assignments.ts:508-600`) es una sola ruta para el conductor y la oficina; llama a `confirmarRecogidaViaje`.
- `confirmar-recogida-viaje.ts` lee viaje y asignación **sin** `FOR UPDATE` (l.72-86) y luego hace CAS sobre `viajes.estado='asignado'` (l.168) y `asignaciones.estado='asignado'` (l.181). Los códigos de error son `assignment_not_found | forbidden | invalid_status | invalid_picked_up_at` (l.44).
- `confirmar-entrega-viaje.ts` toma `FOR UPDATE` y acepta `asignado|en_proceso→entregado` (l.233): la entrega puede saltarse la recogida.

**Vehículo de la asignación**
- `POST /assignments/:id/asignar-conductor` acepta `vehiculo_id` opcional (`assignments.ts:1276-1281`) y solo cambia el vehículo en `asignado` (`asignar-conductor-a-assignment.ts:188`).
- Ese service no compara la capacidad con el peso del viaje (l.205-233).

**Datos derivados**
- `eco_route_polyline_encoded` vive en `asignaciones` (schema.ts:1527).
- `get-assignment-eco-route.ts:106` usa el valor cacheado solo si no es nulo.

**Migraciones**
- La última en main es `0071_membresias_puede_aceptar_ofertas` (journal idx 71, `when` 1780876800080).
- `0072_instrucciones_retiro` la ocupa otra feature (PR #885, sin mergear). Esta spec numera desde **0073**; el número se re-verifica contra `origin/main` al abrir cada PR.
- Cada migración lleva su `down/NNNN_*.down.sql` (plantilla `down/_TEMPLATE.down.sql`).
- El migrator aplica todo el lote pendiente en **una** transacción (nota de 0055). Un valor agregado con `ADD VALUE` no puede usarse en ese mismo lote.
- `check-migration-safety.mjs` exige el marcador `-- contract-phase: <ref>` para el DDL destructivo.

**Notificaciones**
- `web-push.ts` (`sendPushToUser`), `notify-incident-shipper.ts` (patrón fire-and-forget) y `notify-offer.ts` (WhatsApp `CONTENT_SID_OFFER_NEW`).
- `notify-tracking-link.ts` (`notifyTrackingLinkAtAssignment`) envía el token público al generador y, si es otro número, al destinatario (l.113-120). Su comentario dice que es idempotente por `tracking_link_enviado_en` (l.19-22), **pero esa columna no existe** en schema.ts ni en las migraciones. Hoy no hay idempotencia: la única llamada es la de `offer-actions.ts:322`, post-commit del accept.
- No hay template de WhatsApp para cancelación ni para cambios.

**Jobs programados**
- `apps/api/src/routes/admin-jobs.ts` monta `POST /admin/jobs/*` con OIDC del SA `INTERNAL_CRON_CALLER_SA` (l.8-12).
- Cada job tiene su `google_cloud_scheduler_job` en un `.tf` propio sin IAM que reutiliza `google_service_account.internal_cron_invoker`. Ejemplo: `infrastructure/document-service.tf:15-45` (cada 15 min, `America/Santiago`).

**Capacidades y web**
- `puedeCancelarCarga = puedePublicarCarga`. En la API: `denegarPublicarCarga`. Existe `puedeAceptarOferta` (`puede_aceptar_ofertas`).
- Web: `apps/web/src/routes/cargas.tsx` duplica `CANCELLABLE_STATUSES`. Además existen `carga-track.tsx`, `ofertas.tsx`, `servicios.tsx`, `asignacion-detalle.tsx` y `conductor.tsx`.
- `asignaciones.conductor_id` es un `usuarios.id`.

## 4. Estados y transiciones

**No se agrega ningún estado de viaje.** La anulación se deriva así: `anulada ≡ estado='cancelado'` y sin fila en `asignaciones`. El enum DDL no cambia y el test de paridad sigue verde.

**Transiciones nuevas** (TDD con el rojo exhibido en `transiciones.test.ts`):

1. `asignado → cancelado`: la cancelación después del match.
   - `en_proceso → cancelado` **no** se agrega (§12-P2).
2. `ofertas_enviadas → esperando_match`: para volver a ofertar después de una edición material antes del match.
   - Es la única transición hacia atrás. No toca ningún terminal.
   - `expirado → esperando_match` **no** se agrega: el invariante de `transiciones.test.ts:96-97` y el bug #436 lo prohíben.

**Guards nuevos.** Se derivan de la tabla, sin listas paralelas:

| Guard | Definición |
|---|---|
| `ESTADOS_PRE_MATCH` / `esPreMatch(e)` | `borrador, esperando_match, emparejando, ofertas_enviadas` |
| `esAnulablePorGenerador(e)` | `esPreMatch(e) && puedeTransicionar(e,'cancelado')` |
| `esCancelablePostMatch(e)` | `!esPreMatch(e) && puedeTransicionar(e,'cancelado')` (solo `asignado`) |
| `esEditablePreMatch(e)` | `e ∈ {borrador, esperando_match, ofertas_enviadas}` |
| `aceptaDatosLibres(e)` | `!esTerminal(e)` |
| `aceptaSolicitudCambio(e)` | `e === 'asignado'` |

**Sobre `emparejando`.** Nunca se ve commiteado. Las escrituras de esta feature toman `FOR UPDATE` sobre el viaje, esperan a que el matching haga commit y luego evalúan el estado resultante. Si aun así leen `emparejando`, responden `409 trip_busy` como guarda defensiva.

**Orden obligatorio (riesgo de comportamiento).** Agregar `asignado→cancelado` sin tocar la ruta haría que el `PATCH /cancelar` actual cancele viajes asignados sin escribir la asignación ni avisar. Por eso el **mismo PR** que agrega la transición:
- reemplaza en `trip-requests-v2.ts:982` el uso de `esCancelablePorShipper` por `esAnulablePorGenerador`;
- elimina `esCancelablePorShipper` del paquete;
- incluye un test que exige `409` para `asignado`.

**Ciclo de vida de la solicitud de cambio.** No es un estado del viaje. El viaje sigue en `asignado` mientras se negocia. Se agrega una tabla pura `TRANSICIONES_SOLICITUD` en el mismo paquete:
- `pendiente → [aceptada, rechazada, retirada, invalidada]`;
- las demás son terminales.
- No hay vencimiento: la solicitud no expira sola (§12-P7).

**La solicitud pendiente bloquea la salida de `asignado` hacia adelante.** Mientras exista, el transportista está obligado a responder:
- `confirmar-recogida` responde `409 cambio_pendiente`, sea el conductor o la oficina.
- `confirmar-entrega` desde `asignado` también responde `409 cambio_pendiente`. Es consecuencia directa de P7: la entrega puede saltarse la recogida (`confirmar-entrega-viaje.ts:233`), y sin este bloqueo la solicitud quedaría huérfana.
- La única salida de `asignado` con una solicitud pendiente es la cancelación, que la invalida en la misma tx.

**Invariante:** una solicitud `pendiente` implica viaje y asignación en `asignado`. Ya no existe la invalidación por recogida ni por entrega.

## 5. Modelo de datos y migraciones

Las migraciones se escriben a mano. Cada una lleva su `down/NNNN_*.down.sql`, su entrada en `meta/_journal.json` (idx, `version '7'`, `when` = anterior + 10, tag) y su reflejo en `schema.ts`. El test de conteo debe seguir verde.

**Numeración:** 0072 ya está tomada por `0072_instrucciones_retiro` (PR #885). Esta spec usa 0073–0075 como referencia. El número real se re-verifica contra `origin/main` al abrir cada PR y se corre si otra feature mergeó antes.

**Restricción de lote:** ninguna migración de este frente usa un valor agregado con `ADD VALUE` en el mismo lote. Un tipo creado con `CREATE TYPE` sí se puede usar en su propia migración.

### M1 — `0073_viajes_notas_referencia_eventos_edicion.sql` (expand)

- `ALTER TABLE viajes ADD COLUMN notas text NULL, ADD COLUMN referencia varchar(100) NULL;`
  - Más `CHECK (char_length(notas) <= 1000)`.
  - En schema.ts: `notes: text('notas')` y `reference: varchar('referencia', {length:100})`.
- `ALTER TYPE tipo_evento_viaje ADD VALUE IF NOT EXISTS` para `'carga_editada'`, `'cambio_solicitado'` y `'cambio_respondido'`. Mismo patrón que 0016, 0028 y 0055.
- El down elimina las columnas y documenta que los valores de enum no se revierten.

### M2 — `0074_ofertas_unica_pendiente.sql` (CONTRACT aprobado por el PO, PR propio)

Sin este cambio, volver a ofertar al mismo transportista viola `uq_ofertas_viaje_empresa` en `matching.ts:321` y aborta la tx del matching.

```sql
-- contract-phase: .specs/editar-anular-cargas
CREATE UNIQUE INDEX uq_ofertas_viaje_empresa_pendiente
  ON ofertas (viaje_id, empresa_id) WHERE estado = 'pendiente';
ALTER TABLE ofertas DROP CONSTRAINT uq_ofertas_viaje_empresa;
```

- No toca datos. El código anterior nunca viola ninguna de las dos restricciones, así que el rollback de la revisión es seguro.
- La unicidad de la oferta aceptada ya la garantizan `asignaciones.viaje_id UNIQUE` y `asignaciones.oferta_id UNIQUE`.
- En schema.ts: `uniqueIndex('uq_ofertas_viaje_empresa_pendiente').on(...).where(sql\`estado = 'pendiente'\`)`.
- Requiere lista de verificación escrita y corrida en seco con su salida registrada en el PR (ADR-076):
  `SELECT viaje_id, empresa_id, count(*) FROM ofertas WHERE estado='pendiente' GROUP BY 1,2 HAVING count(*)>1` → 0 filas.

### M3 — `0075_solicitudes_cambio_viaje.sql` (expand)

- `CREATE TYPE estado_solicitud_cambio AS ENUM ('pendiente','aceptada','rechazada','retirada','invalidada');`
- `CREATE TABLE solicitudes_cambio_viaje`:
  - `id uuid PK DEFAULT gen_random_uuid()`
  - `viaje_id uuid NOT NULL REFERENCES viajes(id)`, `asignacion_id uuid NOT NULL REFERENCES asignaciones(id)`
  - `solicitado_por_id uuid NOT NULL REFERENCES usuarios(id)`
  - `estado estado_solicitud_cambio NOT NULL DEFAULT 'pendiente'`
  - `cambios jsonb NOT NULL`: solo los campos propuestos.
  - `valores_anteriores jsonb NOT NULL`: copia de esos mismos campos al solicitar.
  - `respondido_por_id uuid NULL REFERENCES usuarios(id)`, `respondido_en timestamptz NULL`, `razon_respuesta text NULL`
  - `motivo_invalidacion varchar(40) NULL`: `viaje_cancelado | datos_cambiaron | viaje_no_asignado` (los dos últimos son defensivos, §6-9)
  - `ultimo_recordatorio_en timestamptz NULL`, `recordatorios_enviados integer NOT NULL DEFAULT 0` (§8)
  - `creado_en timestamptz NOT NULL DEFAULT now()`, `cerrado_en timestamptz NULL`
- Índices y restricciones:
  - `UNIQUE INDEX uq_solicitud_cambio_pendiente ON solicitudes_cambio_viaje (viaje_id) WHERE estado='pendiente'`
  - `idx_solicitudes_cambio_asignacion (asignacion_id, estado)`
  - `idx_solicitudes_cambio_pendientes (creado_en) WHERE estado='pendiente'`, para el job de recordatorios
  - `CHECK ((estado='pendiente') = (cerrado_en IS NULL))`
  - `CHECK (estado NOT IN ('aceptada','rechazada') OR (respondido_por_id IS NOT NULL AND respondido_en IS NOT NULL))`
- RLS y lint-rls: las consultas nuevas siguen el patrón de sus tablas hermanas, con allowlist a ≤10 líneas del `.from()`. El job de recordatorios es cross-empresa y lleva su comentario `rls-allowlist`.
- En schema.ts: `tripChangeRequests`, con nombres en inglés camelCase (por ejemplo, `changes: jsonb('cambios')`).

### Lo que no cambia de schema

- **Anulación:** `estado='cancelado'`. La fecha y el autor salen del evento `cancelado` (`registrado_en`, `registrado_por_id`), con `payload.tipo='anulacion'`.
- **Cancelación después del match:** `estado='cancelado'` en viaje y asignación. Se escriben las columnas existentes de `asignaciones`: `cancelado_por_actor='generador_carga'`, `razon_cancelacion` y `cancelado_en`. No se duplican en `viajes`.
- **Ofertas invalidadas:** pasan a `'expirada'`, igual que en `/cancelar` hoy. El motivo va en el payload del evento.
- **Precio y comisión:** se reutilizan `viajes.precio_propuesto_clp`, `viajes.modalidad_carga`, `viajes.comision_pct_aplicada`, `viajes.configuracion_comercial_id` y `asignaciones.precio_acordado_clp`. No se agrega columna.
- **Reenvío del link de tracking:** no se agrega la columna `tracking_link_enviado_en` (§8).

### Dominio canónico

Implementado en PR2 (2026-11-09):

- La regla pura de qué campo se edita en qué estado vive en `packages/trip-state-machine/src/edicion.ts`, junto a la tabla de transiciones de la que deriva. Eso incluye las listas de campos, `clasificarEdicion` y `TRANSICIONES_SOLICITUD`, y evita una dependencia nueva entre paquetes.
- Los Zod schemas de la propuesta y de los eventos van en `packages/shared-schemas/src/domain/cambio-carga.ts`, en el PR que los consume primero (PR3 o PR7).

Contenido:

- `CAMPOS_LIBRES = ['consignee', 'notes', 'reference']`.
- `CAMPOS_CON_ACEPTACION = ['origin', 'destination', 'cargo_type', 'weight_kg', 'volume_m3', 'description', 'pickup_window', 'proposed_price_clp', 'modalidad_carga']`. Comuna, región y lat/lng van dentro de origen o destino.
- `CAMPOS_COMERCIALES = ['proposed_price_clp', 'modalidad_carga']`, subconjunto de los anteriores que dispara el recálculo de §7.
- Antes del match, todos los campos de `CAMPOS_CON_ACEPTACION` son **materiales**: cambiarlos invalida las ofertas, porque la oferta copia el precio y el transportista evaluó otra carga.
- `clasificarEdicion(estado, antes, despues) → { libres[], materiales[], comerciales[], permitido: 'directo' | 'rematch' | 'requiere_aceptacion' | 'prohibido' }`. Es una función pura y la **única** fuente de qué campo se edita en qué estado. La usan la API y la web.
- `cambioPropuestoSchema`: parcial y `.strict()` sobre `CAMPOS_CON_ACEPTACION`, con al menos un campo. Reutiliza los subschemas de `trip-request-create.ts`, salvo `proposed_price_clp`, que después del match es `int > 0` y no nulo (la columna `precio_acordado_clp` es NOT NULL). El origen y el destino incluyen lat/lng geocodificados al proponer.
- Payloads Zod de los eventos:
  - `carga_editada {modo: 'pre_match'|'libre'|'cambio_aceptado', campos, antes?, despues?, invalidated_offers?, comercial?}`. Para `consignee` y `notes` solo se guarda el nombre del campo, sin valores (PII en una tabla append-only). `antes` y `despues` llevan los campos con aceptación y `reference`. `comercial {precio_acordado_antes, precio_acordado_despues, comision_pct_antes, comision_pct_despues}` solo si cambió un campo comercial.
  - `cambio_solicitado {solicitud_id, campos}`.
  - `cambio_respondido {solicitud_id, resultado: 'aceptado'|'rechazado'|'retirado'|'invalidado', motivo_invalidacion?}`.
- El jsonb se valida con Zod al escribir y al leer. Nada de `as unknown as`.

## 6. API

Todos los bodies se validan con `zValidator` + `issuesPublicos`. Cada endpoint nuevo lleva span OTel, logger estructurado con `trip_id` / `assignment_id` / `trip_event_id` y una métrica de negocio:
- `carga_editada_total{modo}`
- `solicitud_cambio_total{resultado, comercial}`
- `carga_cancelada_total{tipo}`
- `recogida_bloqueada_cambio_total{via}`
- `solicitud_cambio_recordatorio_total{resultado}`

Lo común del generador:
- 401;
- 403 `no_active_empresa` / `not_a_shipper` / `empresa_not_active` / `capability_denied`;
- 404 `trip_not_found`, filtrado por `generador_carga_empresa_id`.

**Capacidades.** Se agregan en el dominio, con su `denegar*` en `apps/api/src/auth/capacidades.ts`:
- `puedeEditarCarga = puedePublicarCarga` y `denegarEditarCarga`.
- `puedeResponderCambioCarga = puedeAceptarOferta` y `denegarResponderCambioCarga`. `requireCarrierAuth` no mira el rol, así que el chequeo de capacidad es obligatorio.

### Generador — `apps/api/src/routes/trip-requests-v2.ts`

La lógica va en services (`services/editar-carga.ts`, `services/cancelar-carga.ts`, `services/solicitud-cambio-carga.ts`). Las rutas quedan delgadas.

**1. `PUT /:id`: edición total antes del match**
- Body `tripRequestEditInputSchema` = `tripRequestCreateInputSchema` (con su `superRefine`) + `notes?` (≤1000) + `reference?` (≤100). Esos dos también entran como opcionales al schema de creación.
- Tx:
  1. `FOR UPDATE` del viaje y guard `esEditablePreMatch`.
  2. Aplica valores con `valoresViajeDesdeInput`, un helper extraído del POST (refactor interno).
  3. Recalcula `recogida_fecha_raw`. Si cambió el origen sin lat/lng, pone `origin_latitude/longitude` en NULL.
  4. Re-valida `modalidadPermitida` (422 `contrato_programado_no_habilitado`). Si cambió la modalidad y el viaje tiene tasa congelada, recalcula `comision_pct_aplicada` con la regla de §7.
  5. Si hay campos materiales y el estado es `ofertas_enviadas`: ofertas `pendiente→expirada`, CAS `ofertas_enviadas→esperando_match`.
  6. Evento `carga_editada {modo:'pre_match'}`.
- Post-commit, igual que el POST: `geocodificarOrigen` si cambió el origen, y `runMatching` si el viaje quedó en `esperando_match`.
- 200 `{trip_request, matching}`.
- Errores:
  - 409 `trip_not_editable {current_status}` si es post-match o terminal (la web ofrece «Solicitar cambio»);
  - 409 `trip_busy`;
  - 422 de validación.

**2. `PATCH /:id/datos-libres`**
- Body `{consignee?: {name?, phone_e164?} | null, notes?: string | null, reference?: string | null}`, al menos una clave.
- Guard `aceptaDatosLibres`. Evento `carga_editada {modo:'libre', campos}`.
- Dentro de la tx se compara `destinatario_whatsapp_e164` antes y después.
- Post-commit:
  - push al transportista y al conductor si hay asignación (§8);
  - si cambió el teléfono del destinatario a un valor no nulo y el viaje está en `asignado` o `en_proceso`: reenvío del link de tracking al número nuevo, con el mismo token (§8, §12-P8).
- Errores: 409 `trip_not_editable` (terminal); 422 `sin_cambios`.

**3. `POST /:id/solicitudes-cambio`**
- Body `{cambios: cambioPropuestoSchema}`.
- Si cambia el origen o el destino, se geocodifica **antes** de la tx, para no hacer llamadas externas bajo lock.
- Si `cambios.modalidad_carga = 'programada'`, valida `modalidadPermitida` con la empresa generadora (422 `contrato_programado_no_habilitado`).
- Tx: `FOR UPDATE` del viaje; guard `aceptaSolicitudCambio` y asignación en `asignado`. Luego INSERT con `valores_anteriores` y evento `cambio_solicitado`.
- El índice parcial devuelve 409 si ya hay una solicitud pendiente.
- Post-commit: push al transportista y al conductor (§8).
- 201 `{solicitud, desglose_propuesto?}`. `desglose_propuesto` solo existe si hay un campo comercial y el viaje tiene tasa congelada; lo ve solo el generador (ADR-079 §5).
- Errores:
  - 409 `cambio_pendiente_existente`;
  - 409 `trip_not_matched` (antes del match se usa PUT);
  - 409 `trip_not_editable` (`en_proceso` o terminal, §12-P2);
  - 422 `sin_cambios`.
- Un peso por sobre la capacidad del vehículo asignado **sí** se acepta al solicitar (§12-P9).

**4. `POST /:id/solicitudes-cambio/:sid/retirar`**
- CAS `estado='pendiente'→'retirada'` y evento `cambio_respondido {retirado}`.
- Desbloquea la recogida. Push al transportista y al conductor.
- 409 `solicitud_no_vigente`.

**5. `GET /:id/solicitudes-cambio`**: historial de solicitudes del viaje.

**6. `PATCH /:id/cancelar`** (existente, se amplía; el contrato es compatible)
- Body `{reason?}` de 1 a 500 caracteres.
- **Antes del match** (`esAnulablePorGenerador`): el comportamiento actual, más `payload.tipo='anulacion'`. El motivo es opcional (§12-P6).
- **Después del match** (`esCancelablePostMatch`):
  - `reason` es obligatorio (422 `reason_required`, §12-P6).
  - Tx: `FOR UPDATE` del viaje. CAS en `viajes.estado='asignado'` y en `asignaciones.estado='asignado'`. Escribe las columnas de cancelación de `asignaciones`. La solicitud pendiente pasa a `invalidada (viaje_cancelado)`, con su evento `cambio_respondido`. Evento `cancelado {tipo:'cancelacion', actor:'generador_carga', previous_status, assignment_id, reason}`.
  - Post-commit: push (§8).
- Respuesta: `{trip_request: {id, status, tipo: 'anulacion'|'cancelacion'}}`.
- 409 `trip_not_cancellable {current_status}` en `en_proceso` o en un terminal.

**7. `GET /`** excluye las anuladas con `NOT (viajes.estado='cancelado' AND asignaciones.id IS NULL)`. Usa el `LEFT JOIN` que ya existe (l.531). Aplica también a las canceladas históricas (§12-P10).

**8. `GET /:id`** sigue respondiendo para las anuladas, en solo lectura. `serializeTripDetail` agrega:
- `consignee {name, phone_e164}`, `notes` y `reference`;
- `cambio_pendiente {id, cambios, valores_anteriores, creado_en, desglose_propuesto?} | null`;
- `anulacion {en, por_nombre, razon} | null`, leída del evento;
- `cancelacion {en, razon} | null`, leída de la asignación;
- en el bloque de asignación, `conductor_telefono_e164` solo con el viaje en `asignado` o `en_proceso` (§12-P11). Sale de `usuarios.telefono` y, si es nulo, de `usuarios.whatsapp_e164`. En cualquier otro estado la clave no se envía;
- `acciones_permitidas {editar, editar_datos_libres, solicitar_cambio, retirar_cambio, anular, cancelar}`, calculadas en el servidor con los guards y las capacidades.

### Transportista — `apps/api/src/routes/assignments.ts`

Requieren `denegarResponderCambioCarga` y que la asignación sea de la empresa activa.

**9. `POST /assignments/:id/solicitudes-cambio/:sid/aceptar`**
- Tx: `FOR UPDATE` del viaje, luego de la asignación y luego de la solicitud. Exige solicitud `pendiente`.
- Validaciones defensivas, que en v1 no deberían ocurrir porque la recogida y la entrega están bloqueadas:
  - viaje o asignación fuera de `asignado` → CAS a `invalidada (viaje_no_asignado)` y 409 `solicitud_invalidada`;
  - campos actuales distintos de `valores_anteriores` → CAS a `invalidada (datos_cambiaron)` y 409 `solicitud_invalidada`.
- Si `cambios.weight_kg` > `vehiculos.capacidad_kg` del `asignaciones.vehiculo_id` vigente → 422 `excede_capacidad_vehiculo {capacidad_kg, peso_kg}`. La solicitud sigue `pendiente`: el transportista asigna antes un vehículo con capacidad suficiente (`POST /assignments/:id/asignar-conductor` con `vehiculo_id`) o rechaza (§12-P9).
- Aplica `cambios` sobre `viajes`. Si cambió el origen o el destino, pone `asignaciones.eco_route_polyline_encoded = NULL`.
- Si hay campos comerciales, aplica el recálculo de §7 en la misma tx.
- CAS a `aceptada`. Eventos `cambio_respondido {aceptado}` y `carga_editada {modo:'cambio_aceptado', comercial?}`.
- Post-commit:
  - `calcularMetricasEstimadas` si cambió origen, destino, tipo de carga o peso. Las métricas se calcularon al aceptar la oferta (offer-actions.ts:289) y quedarían viejas. No dependen del precio;
  - push al generador y al conductor.
- Errores: 409 `solicitud_no_vigente`; 409 `solicitud_invalidada`; 422 `excede_capacidad_vehiculo`.

**10. `POST /assignments/:id/solicitudes-cambio/:sid/rechazar`**
- Body `{reason?: 1–500}`.
- CAS a `rechazada`, evento y push al generador y al conductor. El viaje queda intacto y la recogida se desbloquea.

**11. `GET /assignments/:id` y el listado de servicios** agregan `notes`, `reference`, `consignee`, `cambio_pendiente` y `cancelacion {por_actor, razon, en}`.
- Para la oficina del transportista, `cambio_pendiente` trae el diff completo, incluido el precio del transportista y la modalidad. Nunca la comisión ni el desglose del generador (ADR-079 §5).
- Para el conductor, `cambio_pendiente` es solo `{existe: true, creado_en}`: sin `cambios` ni `valores_anteriores` (§12-P7).

**12. `PATCH /assignments/:id/confirmar-recogida`** (existente)
- `confirmarRecogidaViaje` toma `FOR UPDATE` del viaje **antes** de leer la solicitud. Hoy lee sin lock (l.72-86). Sin el lock, una solicitud creada en paralelo puede commitear entre la lectura y el CAS, y la recogida pasaría.
- Con una solicitud `pendiente`, devuelve el código nuevo `cambio_pendiente`, y la ruta responde `409 {error:'cambio_pendiente', code:'cambio_pendiente', solicitud_id}` para el conductor y para la oficina.
- La idempotencia de `recogido` (l.108-115) se evalúa antes y no cambia.

**13. `PATCH /assignments/:id/confirmar-entrega`** y `PATCH /trip-requests-v2/:id/confirmar-recepcion`
- `confirmarEntregaViaje` responde `cambio_pendiente` (409) si el viaje está en `asignado` con una solicitud pendiente. Ya toma `FOR UPDATE`.

### Job interno — `apps/api/src/routes/admin-jobs.ts`

**14. `POST /admin/jobs/solicitudes-cambio-recordatorio`**
- Mismo auth OIDC que el resto de `/admin/jobs/*`.
- Service `services/recordar-solicitudes-cambio.ts`: selecciona las `pendiente` con `coalesce(ultimo_recordatorio_en, creado_en) < now() - intervalo`, con `FOR UPDATE SKIP LOCKED`, y en la misma tx actualiza `ultimo_recordatorio_en = now()` y `recordatorios_enviados + 1`. Post-commit, push (§8).
- Intervalo por env `CAMBIO_RECORDATORIO_INTERVALO_MIN`, validado con Zod en `config.ts`, default 60.
- Sin VAPID configurado responde 200 `{skipped: true}`, igual que los otros jobs con la feature apagada.
- Responde `{ok, recordados, fallidos}`.
- Infra: `infrastructure/cambio-carga.tf`, con un `google_cloud_scheduler_job` cada 15 min en `America/Santiago` que reutiliza `internal_cron_invoker`, sin declarar IAM (patrón `document-service.tf`). El `terraform apply` en producción lo hace el PO.

### Cambios en services existentes

**`offer-actions.ts` (`acceptOffer`)**
- Después del `FOR UPDATE` del viaje, vuelve a leer la oferta con `FOR UPDATE`.
- El UPDATE pasa a `WHERE id=? AND estado='pendiente'`. Con 0 filas lanza `OfferNotPendingError`.
- El TTL se re-valida después del lock.
- Corrige la carrera de §3, que la transición `ofertas_enviadas→esperando_match` volvería explotable.

**`confirmar-recogida-viaje.ts` y `confirmar-entrega-viaje.ts`**: bloqueo por solicitud pendiente (puntos 12 y 13). Ya no invalidan solicitudes.

**`notify-tracking-link.ts`**: se agrega `soloDestinatario?: boolean` para el reenvío de P8, y se corrige el comentario de idempotencia (l.19-22), que describe una columna inexistente.

## 7. Ofertas, re-matching y precio

**Antes del match, según el estado**
- **`borrador` / `esperando_match`:** solo se actualiza `viajes`. Si el viaje queda en `esperando_match`, `runMatching` corre post-commit. Esto también destraba los viajes cuyo matching falló al crearse.
- **`ofertas_enviadas` con solo campos libres:** las ofertas siguen vivas. `offers.ts` hace JOIN en vivo con `viajes`, así que el transportista ve el dato nuevo.
- **`ofertas_enviadas` con algún campo material**, en una tx con `FOR UPDATE`:
  1. UPDATE de los campos.
  2. Ofertas `pendiente→expirada`.
  3. CAS `ofertas_enviadas→esperando_match`.
  4. Evento con `invalidated_offers`.
  5. Commit.

  Post-commit, `runMatching` crea ofertas nuevas con los datos, el precio y el TTL nuevos (60 min), y las notifica con `notify-offer` (template ya aprobado). Se vuelve a ofertar también a quien rechazó en la ronda anterior: `runMatching` no filtra el historial (§12-P1b). Las ofertas `rechazada` y `expirada` quedan como historial. Volver a ofertar al mismo transportista depende de M2.
- **Sin candidatos:** el viaje termina en `expirado` (terminal), como al crearlo. La UI lo advierte antes de guardar.

**Carrera con `acceptOffer`.** Queda cerrada solo con el cambio de §6: lock del viaje, relectura de la oferta y CAS `estado='pendiente'`. Un accept que leyó la oferta antes de la edición falla con 409 aunque el re-matching ya haya devuelto el viaje a `ofertas_enviadas`. Una respuesta por WhatsApp a una oferta vieja cae en el mismo rechazo. Esto se prueba con un test de integración de transacciones intercaladas (PG17 efímero).

**Anulación.** Ofertas `pendiente→expirada`, como hoy.

**Expiración de ofertas.** No se agrega job: el TTL se sigue revisando al aceptar.

**Después del match no se vuelve a hacer matching.** Todo cambio que no sea libre se negocia con el transportista asignado. Si lo rechaza, el generador conserva el servicio original o lo cancela y publica una carga nueva.

**La cancelación después del match no republica.** La oferta queda `aceptada` como historial. La asignación pasa a `cancelado` y libera el vehículo: `vehiculos.ts`, `me.ts` y `matching-v2-lookups` filtran por `asignado/recogido/en_proceso`.

### Precio y modalidad (dominio crítico, ADR-079)

**Regla única de comisión.** Helper puro nuevo en `apps/api/src/services/cotizacion-comercial.ts`: `tasaCongeladaParaModalidad(configCongelada, modalidad) = tasaParaPublicacion(configCongelada, modalidad)`.
- `configCongelada` es la fila de `configuracion_comercial` apuntada por `viajes.configuracion_comercial_id`, parseada con `configuracionComercialSchema`. No es la configuración vigente.
- Así se respeta «la tasa se congela al publicar» (`trip-requests-v2.ts:321-322`): un cambio de modalidad cambia de tasa dentro de la misma versión congelada, y una configuración publicada después no se cuela.
- La misma regla aplica al `PUT` antes del match y a la aceptación después del match.

**Al aceptar un cambio con `proposed_price_clp`**, en la misma tx de §6-9:
- `viajes.precio_propuesto_clp = nuevo`. El desglose del detalle lo lee de ahí (`trip-requests-v2.ts:564-584`).
- `asignaciones.precio_acordado_clp = nuevo`. `liquidarTrip` lo lee de ahí (`liquidar-trip.ts:305`).
- Las dos columnas quedan iguales al terminar la tx (test explícito).

**Al aceptar un cambio con `modalidad_carga`**, en la misma tx:
- `viajes.modalidad_carga = nueva`.
- Si el viaje tiene `comision_pct_aplicada` y `configuracion_comercial_id`: `comision_pct_aplicada = tasaCongeladaParaModalidad(...)`, con `toFixed(2)` como en el POST (l.381).
- Si el viaje se publicó sin tasa congelada (v2 o v3 apagado), solo cambia la modalidad. No se congela una tasa a posteriori.
- `modalidadPermitida` se re-valida al aceptar (422 `contrato_programado_no_habilitado`), por si el contrato programado se desactivó entre la solicitud y la respuesta.

**Lo que NO se toca**
- `viajes.configuracion_comercial_id`.
- `ofertas.precio_propuesto_clp` de la oferta `aceptada`: es lo que el transportista aceptó originalmente.
- El payload del evento `oferta_aceptada` (`agreed_price_clp`, offer-actions.ts:259): append-only. El precio nuevo queda en `carga_editada.comercial`.
- `metricas_viaje`: la huella no depende del precio ni de la modalidad.
- `liquidaciones`: no existe fila mientras el viaje está en `asignado`, porque `liquidarTrip` corre al entregar. La tx de aceptación verifica que no haya liquidación para la asignación y, si la hubiera, aborta con 409 `solicitud_invalidada (viaje_no_asignado)`.

**Liquidación.** Sin cambios de código: al entregar, `liquidarTrip` toma el `precio_acordado_clp` y la `comision_pct_aplicada` ya actualizados. Un test de integración lo exige: aceptar cambio de precio y modalidad → entregar → la fila de `liquidaciones` refleja el precio y la tasa nuevos, y el IVA de la versión congelada.

**Visibilidad.**
- El transportista ve en el diff el precio del transportista y la modalidad. No ve la comisión ni el total del generador.
- El generador ve `desglose_propuesto` (precio, comisión e IVA con la tasa congelada para la modalidad propuesta) al solicitar y en `cambio_pendiente`.

**TDD con rojo exhibido** (salida del rojo en la Evidencia del PR):
1. `tasaCongeladaParaModalidad`: spot↔programada con la config congelada; ignora la vigente.
2. Aceptar con precio: `precio_propuesto_clp` y `precio_acordado_clp` iguales al nuevo; `configuracion_comercial_id` y la oferta aceptada intactas.
3. Aceptar con modalidad: tasa recalculada; viaje sin tasa congelada no gana tasa.
4. Aceptar con liquidación existente: 409 y nada escrito.
5. Integración: aceptar → entregar → liquidación con precio y tasa nuevos.

## 8. Notificaciones

Patrón: push web fire-and-forget con `sendPushToUser` después del commit, como en `notify-incident-shipper.ts`. Un fallo va a `logger.warn` estructurado con su métrica. Nunca bloquea la tx ni hace rollback, y no hay `catch` vacío.

Service nuevo: `apps/api/src/services/notify-cambio-carga.ts`, con un mapa tipado evento → (destinatarios, texto).

**Destinatarios**
- **Transportista:** las membresías activas de la empresa asignada con `puedeAceptarOferta`.
- **Conductor:** `asignaciones.conductor_id` (es un `usuarios.id`), si hay.
- **Generador:** `viajes.creado_por_id`.
- Los textos llevan el código del viaje y el tipo de cambio, sin datos personales del destinatario. Al conductor nunca le llegan los datos propuestos.
- Tag de deduplicación: `viaje:<id>:<evento>`.

| Evento | A quién | Texto |
|---|---|---|
| Cancelación post-match | Transportista + conductor | «El generador canceló el servicio {codigo}. Motivo: {motivo}. No te presentes a la recogida.» |
| Solicitud de cambio creada | Transportista | «El generador propone un cambio en {codigo}. Respóndelo antes de la recogida.» |
| Solicitud de cambio creada | Conductor | «Hay un cambio pendiente en {codigo}. Espera la respuesta de tu transportista antes de recoger.» |
| Recordatorio (job) | Transportista | «Tienes un cambio sin responder en {codigo}. No se puede confirmar la recogida hasta que respondas.» |
| Cambio aceptado | Generador + conductor | «Cambiaron los datos del servicio {codigo}.» |
| Cambio rechazado | Generador + conductor | Generador: «El transportista rechazó el cambio en {codigo}.» Conductor: «El servicio {codigo} sigue sin cambios; ya puedes recoger.» |
| Solicitud retirada | Transportista + conductor | «El generador retiró el cambio propuesto en {codigo}.» |
| Datos libres editados post-match | Transportista + conductor | «Se actualizaron los datos de contacto o notas de {codigo}.» |
| Edición material pre-match | — (las ofertas nuevas van por `notify-offer`) | — |
| Anulación | — (decisión 3: desaparece) | — |

**Recordatorios.** Los envía el job de §6-14 mientras la solicitud siga `pendiente`, cada `CAMBIO_RECORDATORIO_INTERVALO_MIN`. Tag `viaje:<id>:cambio_recordatorio`, para que el navegador reemplace el anterior en vez de apilarlos. Paran solos cuando la solicitud se cierra.

**Principio operativo.** El conductor nunca ve un dato que su transportista no aceptó. Mientras una solicitud está pendiente, el viaje conserva los datos originales y el conductor solo sabe que existe un cambio pendiente.

**WhatsApp.** La v1 sale con push más el estado visible en la app (§12-P5). En paralelo se piden a Meta templates Utility, sin PIN, de cancelación y de cambio propuesto. Se conectan en un PR posterior cuando estén aprobados.

**Teléfono del destinatario cambiado post-match** (§12-P8)
- Post-commit de `PATCH /datos-libres`, se llama a `notifyTrackingLinkAtAssignment(…, {soloDestinatario: true})` con el número nuevo y el mismo `tracking_token_publico`. No se reenvía al generador.
- Solo con el viaje en `asignado` o `en_proceso` y token vigente.
- La idempotencia actual es nominal: la columna `tracking_link_enviado_en` que cita el comentario no existe (§3). El disparador es el propio cambio de número detectado en la tx, así que un número nuevo produce un envío. Repetir el PATCH con el mismo número no reenvía.
- Si Twilio o el Content SID faltan, se omite con el mismo skip que hoy.

## 9. Web

La visibilidad de los botones sale de `acciones_permitidas` del API y de los flags de capacidades. Se elimina `CANCELLABLE_STATUSES` de `cargas.tsx`. Los formularios reutilizan los componentes de creación. Los textos van en español con tildes.

**Generador — `apps/web/src/routes/cargas.tsx`**
- **Antes del match:**
  - «Editar carga» lleva a la ruta nueva `/app/cargas/:id/editar`, que reutiliza `TripForm` precargado (con Notas y Referencia) y hace PUT.
  - Si el viaje está en `ofertas_enviadas` y el cambio es material, un diálogo previo avisa: «Hay N transportistas evaluando esta carga. Si cambias estos datos, sus ofertas se anulan y buscaremos transportista de nuevo. Si no hay candidatos, la carga quedará sin transportista.»
  - «Anular carga» reemplaza a «Cancelar carga». Motivo opcional. La confirmación dice: «La carga dejará de aparecer en tus listas. Queda registrado quién la anuló y cuándo.»
- **Después del match (`asignado`):**
  - Tarjeta «Contacto y notas», editable en línea con `PATCH /datos-libres`. Si cambia el teléfono del destinatario: «Le enviaremos el link de seguimiento al número nuevo.»
  - «Solicitar cambio»: formulario con origen, destino, tipo de carga, peso, volumen, descripción, ventana, precio y modalidad, más el diff antes/después. Si cambia precio o modalidad, muestra el desglose propuesto del servidor. Aviso: «El transportista no podrá confirmar la recogida hasta responder.»
  - Con una solicitud pendiente aparece el banner «Cambio pendiente de aprobación del transportista», con el diff y el botón «Retirar solicitud». Una vez resuelta, se ve el resultado y el motivo.
  - «Cancelar servicio»: motivo obligatorio y el texto «Avisaremos al transportista y al conductor por la app. Si la recogida es pronto, llama al conductor: {teléfono}». Sin teléfono disponible, el texto queda sin él.
  - Tarjeta de asignación con el teléfono del conductor, solo en `asignado` y `en_proceso`.
- **En `en_proceso`:** sin «Solicitar cambio» ni «Cancelar servicio». Texto: «La carga ya fue recogida. Para cambios, llama al conductor o reporta un incidente.»
- **Un 409 `trip_not_editable`** muestra «La carga cambió mientras editabas (ya tiene transportista)» y recarga.
- **Detalle de una carga anulada:** solo lectura, con «Anulada el {fecha} por {nombre}».
- **Timeline:** etiquetas para `carga_editada`, `cambio_solicitado` y `cambio_respondido`, y un fallback verificado para tipos desconocidos.
- **Listado:** las anuladas desaparecen, incluidas las canceladas históricas (el filtro está en el API). Las canceladas después del match siguen en Historial como «Cancelada».
- **`TripForm`** suma Notas y Referencia, ambas opcionales.
- **`carga-track.tsx`:** sigue en solo lectura y muestra «Cancelado» con motivo y fecha. No muestra notas ni referencia.

**Transportista**
- `asignacion-detalle.tsx`:
  - Tarjeta destacada «El generador propone un cambio», arriba de todo, con el diff campo a campo (incluido el precio del transportista y la modalidad) y los botones «Aceptar cambio» y «Rechazar» (motivo opcional), visibles solo con `puedeResponderCambioCarga`. Texto: «No podrás confirmar la recogida hasta responder.»
  - Si el peso nuevo supera la capacidad del vehículo asignado: aviso «Este peso supera la capacidad de {patente} ({capacidad} kg). Asigna un vehículo con capacidad suficiente o rechaza el cambio», con acceso al selector de vehículo existente. Un 422 `excede_capacidad_vehiculo` muestra el mismo aviso.
  - El botón de confirmar recogida queda deshabilitado con el motivo, y un 409 `cambio_pendiente` lo explica.
  - Muestra notas, referencia y contacto.
  - Si el servicio está cancelado: banner «Cancelado por el generador el {fecha}: {motivo}» y las acciones operativas ocultas.
- `servicios.tsx`: badge destacado «Cambio pendiente» (orden primero) y badge «Cancelado por el generador».
- `ofertas.tsx`: sin cambios. Las ofertas invalidadas desaparecen y las nuevas llegan solas.

**Conductor — `conductor.tsx`**
- Muestra notas, referencia y contacto vigentes.
- Con una solicitud pendiente: banner «Hay un cambio pendiente. Espera la respuesta de tu transportista antes de recoger», sin los datos propuestos, y el botón de recogida deshabilitado.
- La recogida por geofence que recibe 409 `cambio_pendiente` no reintenta en bucle: muestra el banner y espera la próxima carga del servicio.
- Una asignación cancelada sale de las activas (los filtros `asignado/recogido` ya lo hacen) y le llega el push.

**Capacidades.** `apps/web/src/lib/capacidades.ts` espeja `puedeEditarCarga` y `puedeResponderCambioCarga` en `flagsDe(me)`.

**Pruebas.** Vitest + vitest-axe junto a cada componente, y un E2E Playwright solo para el flujo crítico: solicitar cambio → la recogida queda bloqueada → el transportista acepta → el generador y el conductor ven los datos nuevos y la recogida se desbloquea.

## 10. Criterios de éxito

- **SC1:** un generador gestor con el viaje en `borrador`, `esperando_match` u `ofertas_enviadas` hace `PUT /trip-requests-v2/:id` con todos los campos de creación más notas y referencia, y recibe 200. Con asignación recibe 409 `trip_not_editable`.
- **SC2:** una edición material en `ofertas_enviadas` deja, en una sola tx, todas las ofertas `pendiente` en `expirada` y el viaje en `esperando_match`. Post-commit, `runMatching` crea ofertas nuevas con el precio nuevo, incluso al mismo transportista y a quien rechazó antes, sin violar la unicidad (requiere M2).
- **SC3:** una edición de solo campos libres en `ofertas_enviadas` no modifica ninguna oferta.
- **SC4 (carrera):** con un test de integración de transacciones intercaladas, un `acceptOffer` que leyó la oferta antes de una edición material o de una anulación responde 409 y no crea asignación, aunque el viaje ya haya vuelto a `ofertas_enviadas`. Un test unitario exige que el UPDATE lleve `estado='pendiente'`.
- **SC5:** `PATCH /:id/datos-libres` responde 200 en todo estado no terminal y registra `carga_editada {modo:'libre'}` con autor y la lista de campos, sin valores de `consignee` ni `notes`. En `entregado`, `cancelado` y `expirado` responde 409.
- **SC6:** `POST /:id/solicitudes-cambio` en `asignado` crea la fila `pendiente` y el evento `cambio_solicitado`, con cualquier campo de `CAMPOS_CON_ACEPTACION`, incluidos precio y modalidad. Una segunda solicitud responde 409 `cambio_pendiente_existente`, garantizado por el índice parcial en BD. Antes del match responde 409 `trip_not_matched`; en `en_proceso`, 409 `trip_not_editable`. Mientras la solicitud está pendiente, `viajes` y `asignaciones` no cambian.
- **SC7:** un usuario con `puedeAceptarOferta` acepta y los campos de `viajes` cambian en la misma tx, con los eventos `cambio_respondido(aceptado)` y `carga_editada`. Si cambió el origen o el destino, `asignaciones.eco_route_polyline_encoded` queda en NULL, y `calcularMetricasEstimadas` se invoca (verificado con un mock); con solo precio o modalidad no se invoca.
- **SC8:** un despachador sin `puede_aceptar_ofertas`, un visualizador o un conductor que intenta responder un cambio recibe 403 `capability_denied`. Un transportista que intenta editar o cancelar recibe 403.
- **SC9:** rechazar o retirar deja `viajes` intacto, cierra la solicitud y desbloquea la recogida. Cancelar la deja `invalidada (viaje_cancelado)`. La solicitud no vence sola: sin respuesta, sigue `pendiente`.
- **SC10:** anular antes del match deja `viajes.estado='cancelado'` y el evento `cancelado {tipo:'anulacion'}` con `registrado_por_id` y `registrado_en`, con o sin motivo. Ninguna tabla recibe un DELETE (grep sin `DELETE FROM viajes`). El viaje no aparece en `GET /`, y `GET /:id` responde 200 con `anulacion`. Una cancelada histórica sin asignación tampoco aparece en `GET /`.
- **SC11:** cancelar después del match con motivo deja viaje y asignación en `cancelado`, con `cancelado_por_actor='generador_carga'`, `razon_cancelacion` y `cancelado_en` escritos. Se envía push a los gestores del transportista y al conductor (mock de `sendPushToUser` con los destinatarios verificados). Sin motivo responde 422; en `en_proceso`, 409.
- **SC12:** después de la cancelación, el vehículo deja de contar como ocupado en `vehiculos.ts` y `me.ts`.
- **SC13:** el PR de la máquina de estados no cambia el comportamiento visible: `PATCH /cancelar` sobre un viaje `asignado` sigue respondiendo 409 hasta el PR de cancelación (test explícito).
- **SC14 (trip-state-machine):** los tests nuevos muestran el rojo. El test de paridad sigue verde. `expirado`, `cancelado` y `entregado` siguen sin salidas.
- **SC15:** las migraciones de esta spec (0073–0075 o los números que correspondan al abrir cada PR) tienen su `down/`, su entrada en `_journal.json` y el test de conteo verde. `check-migration-safety` pasa: M1 y M3 sin DDL destructivo, M2 con `contract-phase`. Ninguna usa en el lote un valor agregado con `ADD VALUE`. El PR de M2 trae la lista de verificación y la salida de la corrida en seco.
- **SC16:** `serializeTripDetail` devuelve `acciones_permitidas`, y la web ya no contiene `CANCELLABLE_STATUSES`.
- **SC17:** sin `any`, sin `console.*`, sin `catch` vacío. Zod en todos los bodies, en la config nueva y en la lectura de los jsonb. Coverage ≥80 % en código nuevo. Tests, lint, typecheck y build corridos al momento, con su salida en cada PR.
- **SC18 (recogida bloqueada):** con una solicitud `pendiente`, `PATCH /assignments/:id/confirmar-recogida` responde 409 `cambio_pendiente` para el conductor y para la oficina, y no escribe nada. `confirmar-entrega` desde `asignado` responde lo mismo. Un test de integración intercalado (crear solicitud ‖ confirmar recogida) nunca termina con viaje `en_proceso` y solicitud `pendiente`.
- **SC19 (precio y comisión):** los cinco tests de §7 muestran el rojo antes de implementar. Tras aceptar un cambio de precio, `viajes.precio_propuesto_clp = asignaciones.precio_acordado_clp = nuevo`; tras uno de modalidad, `comision_pct_aplicada` es la tasa de la configuración congelada para la modalidad nueva; `configuracion_comercial_id` y la oferta aceptada no cambian. La liquidación posterior usa los valores nuevos.
- **SC20 (capacidad):** aceptar un peso mayor que `capacidad_kg` del vehículo asignado responde 422 `excede_capacidad_vehiculo` y deja la solicitud `pendiente`. Después de reasignar un vehículo con capacidad suficiente, la misma aceptación responde 200.
- **SC21 (recordatorios):** el job envía push a los gestores del transportista solo para solicitudes `pendiente` con el intervalo vencido, actualiza `ultimo_recordatorio_en` y `recordatorios_enviados`, y no envía nada para solicitudes cerradas. Dos corridas solapadas no duplican el envío (`SKIP LOCKED`).
- **SC22 (vistas del conductor):** `GET /assignments/:id` para el conductor trae `cambio_pendiente {existe, creado_en}` sin `cambios` ni `valores_anteriores` (test de serialización).
- **SC23 (tracking):** cambiar el teléfono del destinatario en `asignado` o `en_proceso` reenvía el link con el mismo token solo al número nuevo (mock de Twilio). Repetir el PATCH con el mismo número no reenvía.
- **SC24 (teléfono del conductor):** `GET /trip-requests-v2/:id` trae `conductor_telefono_e164` en `asignado` y `en_proceso`, y no lo trae en `entregado` ni `cancelado`.

## 11. División en PRs

Ramas `feat/<slug>`, `fix/<slug>` o `chore/<slug>`. Máximo 3 PRs propios abiertos. El número de migración se re-verifica contra `origin/main` al abrir cada PR. Cada PR lleva su `## Evidencia` y se mergea con squash cuando los checks están en verde. Antes de empezar se confirma que el frente está en la fase activa de `docs/frentes-vivos.md`; si no lo está, se declara y se detiene.

| PR | Título | Contenido | Depende de |
|---|---|---|---|
| PR0 | `docs(cargas): spec de edición y anulación de cargas` | Este archivo, aceptado | — |
| PR1 | `fix(ofertas): CAS de oferta pendiente tras el lock en accept` | `acceptOffer`: relectura con `FOR UPDATE`, `WHERE estado='pendiente'` y TTL después del lock. TDD con el rojo y el test de carrera (SC4) | — |
| PR2 | `feat(trip-state-machine): cancelación post-match y rematch` | Transiciones, guards y `TRANSICIONES_SOLICITUD`. Reemplaza `esCancelablePorShipper` en la ruta (SC13). Agrega `cambio-carga.ts` (`clasificarEdicion`, schemas). TDD con el rojo | — |
| PR3 | `feat(cargas): notas, referencia y datos libres editables` | M1. Campos opcionales al crear. `serializeTripDetail` con consignee, notas, referencia y `acciones_permitidas`. `PATCH /datos-libres` + push + reenvío del link de tracking (SC23). Web: TripForm, tarjeta «Contacto y notas»; el transportista y el conductor ven los datos | PR2 |
| PR4 | `feat(cargas): anular antes del match y cancelar con aviso` | `/cancelar` ampliado. Filtro de anuladas, también las históricas. `anulacion`/`cancelacion` y teléfono del conductor en el detalle (SC24). `notify-cambio-carga.ts`. Web de los tres roles. TDD en cancelación y capacidades | PR2, PR3 |
| PR5 | `chore(db): unicidad de ofertas solo para pendientes` | M2, contract aprobado. Lista de verificación y corrida en seco registradas en el PR | — |
| PR6 | `feat(cargas): edición total antes del match con re-matching` | `PUT /:id`, `valoresViajeDesdeInput`, invalidación de ofertas y re-match. Recálculo de tasa al cambiar modalidad. Web `/app/cargas/:id/editar` con el diálogo. TDD en matching y comisión | PR1, PR3, PR5 |
| PR7 | `feat(asignaciones): solicitudes de cambio y bloqueo de recogida` | M3. Endpoints de crear, retirar, listar, aceptar y rechazar. Bloqueo `cambio_pendiente` en recogida y entrega, con `FOR UPDATE` en recogida (SC18). Capacidad (SC20). Vista reducida del conductor (SC22). Recálculo de derivados. Push. Campos no comerciales | PR2, PR4 |
| PR8 | `feat(pricing): cambio de precio y modalidad tras el match` | `tasaCongeladaParaModalidad`, recálculo al aceptar, `desglose_propuesto`, test de liquidación. TDD con el rojo (SC19) | PR7 |
| PR9 | `feat(asignaciones): recordatorios de cambios pendientes` | `POST /admin/jobs/solicitudes-cambio-recordatorio`, service, config, `infrastructure/cambio-carga.tf` sin IAM (SC21). El `terraform apply` lo hace el PO | PR7 |
| PR10 | `feat(web): solicitar y responder cambios de carga` | Formulario y banner del generador (con precio y modalidad), tarjeta destacada en `asignacion-detalle`, badge en `servicios`, banner y bloqueo en `conductor`, E2E | PR7, PR8 |

El rojo se exhibe en PR1, PR2, PR4 (cancelación y auth), PR5 (migración), PR6 (matching y comisión), PR7 (migración, bloqueo de recogida y auth del transportista), PR8 (pricing) y PR9 (job).

PR7, PR8 y PR10 se despliegan juntos: sin la web, el transportista no puede responder y la recogida queda bloqueada. PR9 puede ir en el mismo deploy o justo después; su job de Scheduler requiere el `terraform apply` del PO. El deploy es manual y no forma parte de estos PRs.

Los templates de WhatsApp de cancelación y cambio (§12-P5) van en un PR posterior, cuando Meta los apruebe.

## 12. Decisiones del PO (2026-11-09)

- **P1 — Unicidad de ofertas.** Aprobada la migración contract M2: `uq_ofertas_viaje_empresa` se reemplaza por un índice único parcial sobre `estado='pendiente'`. Va en PR propio (PR5), con lista de verificación y corrida en seco.
- **P1b — Re-oferta a quien rechazó.** Se vuelve a ofertar también a quien rechazó en la ronda anterior. `runMatching` no filtra el historial.
- **P2 — `en_proceso` (carga ya recogida).** No se cancela ni se pide cambio en esta versión. Ambos responden 409 y se coordina por teléfono o como incidente. Solo `asignado` admite cancelación y solicitudes.
- **P3 — Campos no nombrados, después del match.** Todos se pueden proponer con aceptación del transportista: volumen, descripción, precio (`precio_propuesto_clp`) y modalidad (`modalidad_carga`). Comuna, región y lat/lng van con origen o destino. Al aceptar precio o modalidad se recalcula según §7.
- **P4 — Notas y referencia.** `notas` de texto (≤1000) y `referencia` (≤100), opcionales también al crear. Visibles para el transportista y el conductor. No visibles en el tracking público ni para el destinatario.
- **P5 — Avisos.** v1 por push más el estado en la app. En paralelo se piden a Meta templates Utility (sin PIN) de cancelación y de cambio, y se conectan en un PR posterior.
- **P6 — Motivo.** Obligatorio al cancelar después del match (1–500, lo ve el transportista). Opcional al anular antes del match.
- **P7 — Respuesta obligatoria a la solicitud de cambio.** La solicitud no vence sola. Mientras haya una pendiente, el transportista no puede confirmar la recogida: la ruta responde 409 `cambio_pendiente` para la oficina y para el conductor. El transportista recibe aviso al crearse y recordatorios mientras siga pendiente (job interno con Cloud Scheduler). La solicitud se ve destacada en Servicios, en el detalle de la asignación y en la pantalla del conductor; el conductor ve que existe, pero no los datos propuestos. Una sola pendiente por viaje; el generador la puede retirar; se invalida si se cancela el viaje.
- **P8 — Teléfono del destinatario cambiado después del match.** Se reenvía el link de tracking al número nuevo, con el mismo token.
- **P9 — Peso sobre la capacidad del vehículo asignado.** Se puede solicitar. El transportista solo puede aceptarlo si antes asigna un vehículo con capacidad suficiente; si no, rechaza. El servidor bloquea la aceptación con 422 `excede_capacidad_vehiculo`.
- **P10 — Anuladas históricas.** La regla «cancelado sin asignación = anulada» aplica hacia atrás: las canceladas antiguas salen del historial del generador. El detalle por URL sigue en solo lectura.
- **P11 — Teléfono del conductor para el generador.** Se ve solo mientras el viaje está en `asignado` o `en_proceso`.
- **P12 — Entrega directa desde `asignado`.** Con una solicitud pendiente también se bloquea la entrega desde `asignado` (409 `cambio_pendiente`), para que el bloqueo de P7 no se esquive cerrando sin recogida. Confirmado por el PO el 2026-11-09.
- **P13 — Comisión al aceptar un cambio de modalidad.** Se usa la configuración comercial congelada del viaje (`configuracion_comercial_id`) con la tasa de la modalidad nueva. Una configuración publicada después no aplica. Confirmado por el PO el 2026-11-09.

## 13. Fuera de alcance

- Penalidad o compensación por cancelación tardía. Si se quiere, va con un ADR comercial aparte.
- Editar o republicar una carga `expirado`, incluido «Duplicar carga».
- Cancelar o cambiar un servicio `en_proceso` (§12-P2).
- Un job programado de expiración de ofertas. Las solicitudes de cambio tampoco expiran; solo tienen recordatorios.
- Templates de WhatsApp nuevos (PR posterior, §12-P5).
- Confirmación de lectura del conductor («Entendido» / `conductor_visto_en`).
- Avisar a los transportistas con ofertas pendientes cuando la carga se anula o cambia antes del match.
- Control de concurrencia optimista entre pestañas (`version_esperada` / `expected_updated_at`).
- Rate limit de re-matching por viaje.
- Validar la capacidad contra el peso al reasignar el vehículo fuera de una solicitud (`asignar-conductor-a-assignment.ts` no lo hace hoy).
- Rotar el token de tracking al cambiar el destinatario.
- Borrado físico de cualquier fila.

## 14. Riesgos abiertos

- **Efectos de `programada` fuera de la comisión.** En el código, `modalidad_carga` solo define la tasa (`cotizacion-comercial.ts:15-28`) y se guarda en la liquidación (`liquidar-trip.ts:330`). Si `programada` implica condiciones con el transportista que no están en el código (contrato, retorno), cambiarla después del match puede requerir más que aceptación.
- **Comisión v2.** En v2 la comisión sale del tier del transportista (`liquidar-trip.ts:166-210`). Un cambio de precio cambia el monto de la comisión v2 en la liquidación sin otra lógica. Se asume correcto; no hay viajes v2 nuevos con v3 activo.
- **Capacidad con arrastre.** La validación de P9 usa `vehiculos.capacidad_kg` del vehículo motriz, igual que el matching (`matching.ts:240`). Con arrastre enganchado (`asignaciones`, migración 0048) la capacidad efectiva de la combinación no está definida en el código.
- **Recogida por geofence bloqueada.** Con una solicitud pendiente, la recogida automática de la PWA recibe 409 y pierde el instante del cruce. Al desbloquearse, la recogida se confirma con la hora del toque, no la del geofence.
- **Precio 0 heredado.** `matching.ts:309` usa `?? 0` cuando el viaje no tiene precio. Esas asignaciones tienen `precio_acordado_clp = 0`; el cambio de precio post-match exige `> 0`.

---

### Nota de síntesis: fallas de los jueces aceptadas y descartadas

**Aceptadas** (verificadas en `origin/main`):
- La carrera de `acceptOffer`: lectura sin lock en l.137 y UPDATE sin CAS en l.176-185. Ahora es PR1.
- `eco_route_polyline_encoded` vive en `asignaciones`.
- Faltaban las migraciones `down/`.
- La restricción de usar `ADD VALUE` en el mismo lote (nota de 0055).
- `en_proceso` queda fuera (P2).
- PII en `eventos_viaje`: no se guardan los valores de `consignee` ni de `notes`.
- La solicitud en jsonb dentro de `asignaciones` se reemplazó por una tabla con índice parcial y auto-invalidación al aceptar.
- El PR de la máquina de estados reemplaza el guard en la misma entrega.
- `expirado→esperando_match` se rechaza (`transiciones.test.ts:96-97`).
- No se agregan contratos no pedidos (`version_esperada`, `Idempotency-Key`, `too_close_to_pickup`, `visto`) ni avisos a ofertas antes del match.
- No hay estado `anulado`.
- No se duplican columnas de cancelación en `viajes`.

**Correcciones propias:**
- `confirmar-entrega-viaje.ts` también saca al viaje de `asignado` (l.233). Con P7 eso se resuelve bloqueando también la entrega desde `asignado`.
- Las métricas estimadas se calculan al aceptar la oferta (offer-actions.ts:289), no en la recogida, así que se recalculan al aceptar un cambio de ruta o carga.
- `confirmar-recogida-viaje.ts` lee sin `FOR UPDATE` (l.72-86): el bloqueo de P7 necesita el lock para no perder la carrera con una solicitud nueva.
- `tracking_link_enviado_en` no existe: la idempotencia de `notifyTrackingLinkAtAssignment` era solo un comentario.
- El desglose del generador lee `viajes.precio_propuesto_clp` y la liquidación lee `asignaciones.precio_acordado_clp`: un cambio de precio actualiza las dos.

**Descartadas o matizadas:**
- «El LEFT JOIN de `GET /` no está verificado»: sí existe (l.531).
- «`emparejando` nunca commiteado es una inferencia»: verificado, `runMatching` es una sola tx (`matching.ts:122`). La guarda queda solo como defensa.
- «Precio y modalidad como materiales antes del match no fueron pedidos»: se mantiene, porque la oferta copia el precio y el transportista evaluó otra carga. Invalidarla es parte de «editar todo» sin dejar ofertas con datos falsos.
- El estado de oferta `retirada`: se descarta en v1 para no ampliar el enum. El motivo va en el payload del evento.
