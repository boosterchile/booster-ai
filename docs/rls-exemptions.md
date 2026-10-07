# Exenciones del aislamiento por tenant

Cada tabla de `apps/api/src/db/schema.ts` sin columna de tenant (`empresaId`, `generadorCargaEmpresaId`, `empresaCarrierId` o `empresaShipperId`), con la razón y la forma en que se protege. Criterio T10-13 del programa TRL 10 (ADR-082).

**Este documento se verifica en CI.** `pnpm lint:rls` (parte de `pnpm lint`) falla si:

- la primera tabla no coincide exactamente con `TENANT_FREE_TABLES` de `scripts/lint-rls.mjs`;
- alguna tabla del schema sin columna de tenant no figura en ninguna de las dos tablas;
- una entrada no es una tabla del schema.

Al agregar una tabla sin `empresa_id`, se documenta aquí en el mismo PR. Una tabla nueva **con** `empresa_id` no se anota: `lint:rls` exige el filtro en cada query.

## Exentas por tabla (`TENANT_FREE_TABLES`)

`lint:rls` no exige filtro de empresa en ninguna query sobre estas tablas. Entrar aquí es la excepción más amplia: la tabla es global, pública, pre-tenant o se resuelve siempre por una clave que ya validó el tenant.

| Tabla (Drizzle) | Tabla SQL | Razón |
|---|---|---|
| `plans` | `planes` | Catálogo público de planes; no pertenece a ninguna empresa. |
| `membershipTiers` | `membership_tiers` | Catálogo global de tiers de membresía. |
| `empresas` | `empresas` | Raíz del tenant: es la tabla de empresas misma. Se lee por el `empresa_id` de la membresía activa. |
| `users` | `usuarios` | Identidad de la persona, que puede trabajar en varias empresas. Se resuelve por `firebase_uid` o RUT (auth), nunca por empresa. |
| `memberships` | `membresias` | Tabla pivote usuario↔empresa u organización. Se filtra por `userId`; es la que define el tenant, no la que lo consume. |
| `consents` | `consentimientos` | Se filtra por `grantedByUserId` / `stakeholderId` (ADR-028). |
| `stakeholders` | `stakeholders` | Se filtra por `userId` / `stakeholderId`. |
| `stakeholderAccessLog` | `log_acceso_stakeholder` | Bitácora append-only de accesos de stakeholders. |
| `tripEvents` | `eventos_viaje` | Se inserta y lee dentro de la transacción de un viaje ya validado contra el tenant. |
| `tripMetrics` | `metricas_viaje` | Se filtra por `trip_id`, ya validado contra el tenant. |
| `chatMessages` | `mensajes_chat` | Se filtra por `assignment_id`, validado en `resolveChatAccess`. |
| `pushSubscriptions` | `push_subscriptions` | Se filtra por `userId`. |
| `telemetryPoints` | `telemetria_puntos` | Se filtra por `vehicleId` o IMEI de un vehículo ya validado contra el tenant. |
| `posicionesMovilConductor` | `posiciones_movil_conductor` | Igual que `telemetryPoints`: por `vehicleId` validado. |
| `pendingDevices` | `dispositivos_pendientes` | Dispositivos Teltonika aún sin asignar a ninguna empresa (pre-asignación). |
| `whatsAppIntakeDrafts` | `borradores_whatsapp` | Intake anónimo por WhatsApp antes del binding con una empresa. |
| `solicitudesRegistro` | `solicitudes_registro` | Signup público gateado por admin: la empresa todavía no existe. |
| `matchingBacktestRuns` | `matching_backtest_runs` | Backtest de platform-admin sobre todas las empresas. |
| `cuentasDemo` | `cuentas_demo` | Registro global de cuentas demo (ADR-053). Sale con la migración 0059 (T10-03, #748). |

## Sin columna `empresa_id`, protegidas en cada query

`lint:rls` sí exige el filtro en estas tablas. Como no tienen columna de tenant, cada query lleva el filtro por la entidad padre ya validada o un comentario `// rls-allowlist: <razón>` que lo justifica.

| Tabla (Drizzle) | Tabla SQL | Cómo se protege |
|---|---|---|
| `organizacionesStakeholder` | `organizaciones_stakeholder` | Organización stakeholder, no empresa. Solo la gestiona platform-admin (`requirePlatformAdmin`); los miembros la alcanzan por su membresía. |
| `zonasStakeholder` | `zonas_stakeholder` | Catálogo curado de zonas de observación (ADR-041). El alcance lo ponen el rol, la región y los consentimientos del stakeholder; la query lleva `rls-allowlist`. |
| `documentosVehiculo` | `documentos_vehiculo` | Se filtra por `vehicleId` de un vehículo validado contra la empresa activa. |
| `documentosConductor` | `documentos_conductor` | Se filtra por `conductorId` de un conductor validado contra la empresa activa. |
| `greenDrivingEvents` | `eventos_conduccion_verde` | Se filtra por `vehicleId` / IMEI de un vehículo validado, como la telemetría. |
| `transportDocuments` | `documentos_transporte` | Se filtra por `viajeId` de un viaje validado contra el generador o el transportista (ADR-070). |
| `facturasBoosterClp` | `facturas_booster_clp` | Tiene columna de tenant con otro nombre (`empresaDestinoId`). Las queries filtran por ella con el `empresaId` de la membresía. |
| `configuracionSitio` | `configuracion_sitio` | Configuración global del sitio público; la edita solo platform-admin. |
| `bitacoraBackfillDistancia` | `bitacora_backfill_distancia` | Bitácora del job admin de backfill de distancia, por `tripId`. |
