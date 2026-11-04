# Spec — Mandato de cobro (ADR-080, T10-25)

**Contrato**: [ADR-080](../../docs/adr/080-flujo-de-dinero-mandato-de-cobro-y-capital-de-trabajo.md). Este documento es el plan de implementación; el ADR manda.
**Programa**: TRL 10 (ADR-082, en revisión en boosterchile/booster-ai#742), criterio T10-25.
**Depende de**: ADR-079 (modelo comercial v3, boosterchile/booster-ai#766–#772). Usa `liquidaciones.precio_transportista_clp`, `precio_generador_clp`, `total_factura_generador_clp` y `configuracion_comercial.financiamiento`. Este PR se apila sobre #772.

**Decisiones del PO (2026-10-10)**:

- **Esquema de tabla de eventos**: `liquidaciones.modo_flujo` más la tabla `eventos_pago_viaje`, append-only, con evidencia obligatoria.
- **Alcance**: flujo completo con `MANDATO_COBRO_ACTIVATED` apagado. Incluye endpoints, conciliación, métricas y UI. Queda fuera la integración por API con el operador financiero.

## Entradas

- **Flag `MANDATO_COBRO_ACTIVATED`**: `booleanFlag(false)`, solo por env y Terraform.
- **Tope `MANDATO_COBRO_FLOAT_MAXIMO_CLP`**: entero ≥ 0, **por omisión 0**. Sin decisión escrita del PO, Booster no adelanta caja propia (precondición 3).
- **Plazos** de `configuracion_comercial.financiamiento`: `plazo_pago_generador_dias` (30) y `plazo_liberacion_transportista_dias` (5). Se leen de la versión con que se liquidó el viaje, no de la vigente.
- **Recepción conforme**: el generador confirma la recepción y el viaje tiene al menos un documento archivado (`documentos_transporte`, ADR-070).
- **Anticipo del operador**: un registro de `adelantos_carrier` desembolsado sobre la misma asignación (Cobra Hoy, ADR-029/032).

## Modelo

### `liquidaciones.modo_flujo`

Enum `modo_flujo` con los valores `conector | mandato_cobro`, `NOT NULL DEFAULT 'conector'`. Lo fija `liquidarTrip` al crear la liquidación:

- **`mandato_cobro`**: solo si el flag está encendido **y** la liquidación es v3, porque el flujo cobra `precio_generador_clp` y libera `precio_transportista_clp`.
- **`conector`**: en cualquier otro caso. Una liquidación v2 siempre es `conector`, porque su comisión se descuenta al transportista y no tiene precio del generador.

### Tabla `eventos_pago_viaje` (append-only)

| columna | tipo | nota |
|---|---|---|
| `id` | uuid | |
| `asignacion_id` | uuid FK `asignaciones` | La clave es la asignación, no la liquidación: la recepción conforme puede llegar antes que la liquidación, que es asíncrona. |
| `tipo` | enum `tipo_evento_pago` | ver abajo |
| `monto_clp` | integer null | monto efectivamente movido (cobro, liberación, anticipo) |
| `evidencia_tipo` | text NOT NULL | ver tabla de evidencias |
| `evidencia_ref` | text NOT NULL, no vacío | id o referencia verificable |
| `detalle` | text null | motivo de disputa, nota del admin |
| `ocurrido_en` | timestamptz NOT NULL | cuándo pasó (fecha de abono o de transferencia) |
| `registrado_en` | timestamptz default now() | |
| `registrado_por` | text NOT NULL | email o `sistema` |

- **Append-only**: un trigger rechaza `UPDATE` y `DELETE`. Una corrección es un evento nuevo, nunca una edición.
- **Unicidad**: un índice parcial impide más de una `recepcion_conforme` por asignación.

**Tipos de evento y evidencia obligatoria:**

| `tipo` | línea | `evidencia_tipo` | `evidencia_ref` | quién |
|---|---|---|---|---|
| `recepcion_conforme` | ambas arrancan | `confirmacion_generador` | id del documento archivado | generador (al confirmar recepción) |
| `cobro_registrado` | cobro | `abono_bancario` | referencia del abono en la cuenta de terceros | platform-admin (conciliación) |
| `mora_registrada` | cobro | `vencimiento_plazo` | fecha de vencimiento (ISO) | sistema (job diario) |
| `liberacion_booster` | liberación | `transferencia_bancaria` | id de la transferencia | platform-admin |
| `anticipo_operador` | liberación | `adelanto_carrier` | id de `adelantos_carrier` desembolsado | platform-admin |
| `disputa_abierta` | liberación | `objecion_generador` | id del usuario que objeta | generador |
| `disputa_resuelta` | liberación | `resolucion_admin` | referencia de la resolución | platform-admin |

### Estados (función pura en `packages/factoring-engine`)

`reducirPagoViaje(eventos)` produce, en orden de `ocurrido_en`:

- **Cobro**: `sin_recepcion` → `pendiente` → `cobrado`, o `pendiente` → `mora` → `cobrado`.
- **Liberación**: `sin_recepcion` → `pendiente` → `liberado_por_booster` | `anticipado_por_operador`, o `pendiente` → `disputa` → `pendiente` (con `disputa_resuelta`).

`validarEvento(estado, evento, contexto)` rechaza toda transición fuera de esa tabla, con un código explícito:

- `sin_recepcion_conforme`
- `recepcion_duplicada`
- `cobro_no_pendiente`
- `liberacion_no_pendiente`
- `liberacion_en_disputa`
- `sin_disputa_abierta`
- `mora_antes_de_vencer`
- `monto_invalido`

Reglas:

- **La disputa congela la liberación, no el cobro** (ADR-080 §2).
- **Una disputa solo se abre con la liberación `pendiente`.** Después de liberar, la objeción sigue la vía contractual (adendum §7: recurso contra el transportista); el sistema no la modela.
- **`disputa_resuelta` en v1 solo devuelve la liberación a `pendiente`** (se libera). El resultado "a favor del generador" (devolución) queda fuera de v1: requiere la definición legal del adendum v2 y se registra a mano.
- **Montos**:
  - `cobro_registrado` debe ser igual a `precio_generador_clp + IVA de la comisión`, es decir, `total_factura_generador_clp + precio_transportista_clp`;
  - `liberacion_booster` debe ser igual a `precio_transportista_clp`;
  - `anticipo_operador` debe ser igual al `monto_adelantado_clp` del adelanto referido.
  - Un monto distinto se rechaza con `monto_invalido`. Los pagos parciales quedan fuera de v1.

### Vencimientos y float

- **Vencimiento del cobro**: `recepcion_conforme.ocurrido_en + plazo_pago_generador_dias`.
- **Vencimiento de la liberación**: `recepcion_conforme.ocurrido_en + plazo_liberacion_transportista_dias`.
- **Float de terceros** (`caja.float_terceros_clp`): suma del `monto_clp` de cada `liberacion_booster` cuyo cobro no está `cobrado`. Es la caja propia de Booster expuesta. El anticipo del operador no cuenta: lo financia el operador.
- **Tope** (ADR-080 §6.3 y Verificación 4): una `liberacion_booster` con el cobro aún no `cobrado` se rechaza si `float + monto > MANDATO_COBRO_FLOAT_MAXIMO_CLP`. Responde con el error explícito `tope_float_excedido` y suma 1 a la métrica `caja.liberaciones_rechazadas_tope`. Nunca falla en silencio. Una liberación con el cobro ya `cobrado` no mueve el float y no se limita.

## Salidas

1. **Migración `0061_mandato_cobro.sql`**, expand-only, con su `down`: enum `modo_flujo`, la columna en `liquidaciones`, el enum `tipo_evento_pago`, la tabla `eventos_pago_viaje`, el índice único parcial y el trigger append-only.
2. **`packages/factoring-engine/src/mandato-cobro.ts`**: `reducirPagoViaje`, `validarEvento`, `vencimientos`, `calcularFloat`, `verificarTopeFloat` y `diasEntre`. Los esquemas Zod del dominio van en `packages/shared-schemas/src/domain/pago-viaje.ts`.
3. **`liquidarTrip`**: persiste `modo_flujo` según la regla de arriba.
4. **Servicio `services/mandato-cobro/`**:
   - `registrarEventoPago`: transacción con lock de la asignación, que lee los eventos, reduce, valida, aplica el tope e inserta. Registra los histogramas `caja.dias_cobro_generador` y `caja.dias_liberacion_transportista`, en días desde la recepción.
   - `registrarRecepcionConforme`: lo llama la confirmación del generador.
   - `leerPagoViaje`: estado de un viaje.
   - `listarPagosMandato`: vista de conciliación.
   - `conciliarMandatoCobro`: el job. Registra `mora_registrada` en los cobros vencidos y publica los gauges `caja.float_terceros_clp`, `caja.mora_generador_pct_mes`, `factoring.anticipos_pct_viajes_mes` y `caja.liberaciones_vencidas`.
5. **API**, toda detrás del flag. Con el flag apagado, los endpoints responden 404 `mandato_cobro_desactivado` y la confirmación del generador no escribe eventos.
   - `PATCH /trip-requests-v2/:id/confirmar-recepcion`, que ya existe: con el flag encendido, además registra `recepcion_conforme`. Si la carga ya estaba entregada por POD del transportista, igual la registra. Responde con `pago` (estado de las dos líneas) cuando el flujo es mandato.
   - `GET /trip-requests-v2/:id/pago` (generador dueño del viaje): estado de las dos líneas y vencimientos.
   - `POST /trip-requests-v2/:id/disputa` (generador dueño del viaje), body `{ motivo }`: abre la disputa.
   - `GET /admin/mandato-cobro`: resumen con float, tope, conteos por estado, vencidos y la lista de viajes en mandato (filtro por estado).
   - `POST /admin/mandato-cobro/:asignacionId/eventos` (platform-admin), body `{ tipo, monto_clp, evidencia_ref, ocurrido_en, detalle? }`, para `cobro_registrado`, `liberacion_booster`, `anticipo_operador` y `disputa_resuelta`.
   - `POST /admin/jobs/mandato-cobro-conciliacion`: lo dispara Cloud Scheduler a diario.
   - `GET /me/liquidaciones` agrega `modo_flujo` y, en mandato, `liberacion: { estado, vence_en }` para el transportista.
6. **Web**:
   - **Detalle de carga del generador**: botón **Confirmar recepción** cuando el viaje está `asignado`, `en_proceso` o `entregado` sin recepción conforme. Hoy no existe ninguna pantalla que llame a `confirmar-recepcion`, y esa es la brecha de la precondición 5. En mandato muestra además el bloque **Pago** y la opción **Objetar recepción**.
   - **Platform-admin**: página `Mandato de cobro` con el resumen, la tabla de viajes y un formulario de registro de eventos con su evidencia.
   - **Liquidaciones del transportista**: estado de la liberación en las filas en mandato.
7. **Terraform**, sin IAM: `mandato-cobro.tf` con el job de Scheduler diario, que reutiliza `internal_cron_invoker`, y las env `MANDATO_COBRO_ACTIVATED` (variable, default `false`) y `MANDATO_COBRO_FLOAT_MAXIMO_CLP` (variable, default `0`) en el api.
8. **`activacion.md`**: la lista de verificación de las seis precondiciones de §6, con su evidencia actual.

## Fuera de v1 (declarado)

- **Integración por API con el operador**: adhesión de proveedores, anticipo y estado (ADR-080, acción 4). El anticipo se registra a mano con referencia al `adelantos_carrier` desembolsado.
- **Re-escopado de Cobra Hoy a `factoring-v2.0-cl-2026.09`**: base `precio_transportista_clp` y tasa del operador. Depende del operador.
- **Pagos parciales** y **devolución al generador** por disputa resuelta a su favor.
- **Movimiento real de dinero**: el sistema **registra** cobros y transferencias con su evidencia; no ejecuta transferencias bancarias.

## Criterios de éxito

- [ ] Rojo exhibido antes de implementar: máquina de estados, migración (append-only y unicidad), `liquidarTrip` con `modo_flujo`, servicio de eventos y rutas.
- [ ] **Verificación 1 de ADR-080**: con el flag apagado (default, también con `NODE_ENV=production`), cada liquidación nueva queda `conector` y no se escribe ningún evento de pago.
- [ ] **Verificación 2**: con el flag encendido, en integración contra Postgres:
  - la confirmación con documento produce `recepcion_conforme`;
  - los vencimientos se calculan con los plazos de la versión liquidada;
  - el float es exactamente Σ(liberado por Booster − cobrado).
- [ ] **Verificación 3**: un anticipo solo se registra sobre un viaje con recepción conforme y un `adelantos_carrier` desembolsado de esa asignación.
- [ ] **Verificación 4**: superado el tope, la liberación se rechaza con `tope_float_excedido` y métrica.
- [ ] El trigger rechaza `UPDATE` y `DELETE` sobre `eventos_pago_viaje`.
- [ ] Coverage ≥ 80 % en el código nuevo; lint, typecheck, build, default-deny, `lint:rls`, `terraform validate` y `fmt`.
- [ ] **Verificación 5**: `activacion.md` contiene las seis precondiciones con su estado. El flip del flag queda fuera de este PR y lo decide el PO con la evidencia completa.
