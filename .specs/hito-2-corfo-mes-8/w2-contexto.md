# W2 — Contexto verificado para IMEI self-service (exploración 2026-07-06)

> Producido por exploración read-only sobre `main`+docs. Insumo del brief de implementación W2.

## 1. Rutas de vehículos (`apps/api/src/routes/vehiculos.ts`, 747 líneas)

- Endpoints: `GET /`, `GET /flota`, `POST /`, `GET /:id`, `PATCH /:id`, `DELETE /:id` (soft), `GET /:id/telemetria`, `GET /:id/ubicacion`.
- Middlewares (server.ts:746-759): `firebaseAuth → demoExpires → isDemoEnforcement(requireNotDemo) → userContext`.
- Helpers de rol (L82-127): `requireAuth`, `requireWriteRole` (dueno|admin|despachador), `requireDeleteRole` (dueno|admin).
- Patrón IDOR canónico: `and(eq(vehicles.id,id), eq(vehicles.empresaId,empresaId))`; no-match → **404 vehicle_not_found** (nunca 403). PATCH L408-487: SELECT ownership + UPDATE con mismo filtro.
- `updateBodySchema` NO declara `teltonika_imei` (comentario L24-26: se asigna solo vía admin-dispositivos; si viene en body se descarta silencioso por zValidator, no hay 400 explícito).
- `serializeVehicle` (L729-747) expone `teltonika_imei`, NO expone `teltonika_imei_espejo` (solo se usa internamente en `/flota` y `/:id/ubicacion`; expone `teltonika_source`).

## 2. Patrón admin-dispositivos (`apps/api/src/routes/admin-dispositivos.ts`, 219 líneas)

- **Tenant-scoped** (`requireAdmin` = dueno|admin de la empresa activa), NO panel de plataforma, pese al nombre.
- `POST /:id/asociar {vehiculo_id}` en tx: pending por id (`status!=='pendiente'`→409 `device_not_pending`) → vehículo con filtro empresa (no-match→**403 vehicle_forbidden**, ojo: acá 403, no 404) → si `teltonikaImei` ya seteado y distinto→409 `vehicle_has_other_device` → UPDATE vehicle + UPDATE pending (`aprobado`, assignedTo/At/By) → `logger.info` con contexto completo.
- `POST /:id/rechazar {notas?}`: UPDATE atómico `WHERE status='pendiente'`.
- **NO valida espejo en ningún punto** — la exclusión mutua documentada NO está enforced en ningún código hoy. El PATCH nuevo sería el primer enforcement real.
- **`pending_devices` NO tiene `empresaId`** (by design, idor-audit-2026-05-10 #2: dispositivos globales pre-asignación; cualquier empresa los reclama vía asociar).
- Estado `'reemplazado'` del enum: **nunca usado por ningún código actual** — la reconciliación de W2 sería su primer uso.
- **Sin tests** (ni unit ni integration) para este router.

## 3. Schema DB — sin migración nueva para W2

- `vehicles` (schema.ts L772-837, tabla `vehiculos`): `teltonikaImei varchar(20) .unique()` (L791, unique implícito); `teltonikaImeiEspejo varchar(20)` nullable SIN unique, sin CHECK (comentario L804-806: "validado en runtime, no en BD" — pero ese runtime check no existe hoy). Índice parcial `idx_vehiculos_espejo_imei` (0024). FK empresa `restrict`.
- `pendingDevices` (L1565-1593, `dispositivos_pendientes`): `imei unique notNull`, `status` enum `pendiente|aprobado|rechazado|reemplazado` default pendiente, `assignedToVehicleId`/`assignedByUserId` FKs nullable, `connectionCount`, `lastSourceIp`, `notes`. Sin empresaId.

## 4. Semántica del espejo — artefacto de DEMO, no feature de negocio

- Origen 0024 + comentario schema L792-807: vehículo sintético del carrier demo "mira" el stream del Teltonika real de Van Oosterwyk vía `teltonika_imei_espejo`, sin escribir telemetría propia.
- Solo lo escribe `seed-demo.ts` (L316-328, L905-927). Ningún endpoint HTTP lo lee/escribe como campo mutable.
- `route-safety-recipients.ts:46`: las notificaciones de pánico ignoran el espejo deliberadamente.
- Defensa en profundidad existente: `isDemoEnforcementMiddleware(requireNotDemo)` ya bloquea escrituras de users demo en `/vehiculos/*`.

## 5. Resolución IMEI en pipeline

- `telemetry-processor/persist.ts` L43-58: resuelve `vehicleId` solo si viene null (path sms-fallback) por `teltonika_imei` real; sin match → warn + descarte. NO mira espejo ni pending.
- `telemetry-tcp-gateway/imei-auth.ts` L33-87 (`resolveImei`): busca `vehiculos.teltonika_imei`; sin match → upsert en `dispositivos_pendientes` (open enrollment) y la conexión sigue (puntos se descartan hasta asociar).

## 6. RBAC

- Roles (schema L73-80): dueno, admin, despachador, conductor, visualizador, stakeholder_sostenibilidad — scoped por `memberships`.
- `resolveUserContext` (services/user-context.ts) + header `X-Empresa-Id` → `activeMembership`.
- Admin de plataforma = concepto distinto (`require-platform-admin.ts`, allowlist emails) — NO aplica a este endpoint.
- Patrón a replicar: `requireAdmin` de admin-dispositivos.ts L37-57 (dueno|admin).

## 7. UI (`apps/web/src/routes/vehiculos.tsx`, 747 líneas)

- Detalle (`VehiculoDetallePage` L397-550): `useQuery(['vehiculos', id])`; IMEI solo banner read-only (L502-517) si existe; **no hay campo IMEI en el form** (`VehicleFormValues` L556-568).
- Mutación edición: `updateM` L416-431 → `api.patch('/vehiculos/'+id, ...)`, invalida `['vehiculos']` y `['vehiculos', id]`.
- Cliente: `lib/api-client.ts` — `ApiError(status, code, details, message)`; `message` = payload.error.
- **Gotcha a NO replicar**: `onError` L425-430 usa `err.message.includes('plate_duplicate')` pero ese string vive en `err.code` — check muerto. Usar `err.code`.
- Forms: react-hook-form + `FormField` + `useScrollToFirstError`; validación client mínima (patente vía `chileanPlateSchema`).

## 8. Tests de referencia

- `apps/api/test/unit/vehiculos.test.ts` (506 líneas): DB stub fluent-chain con `vi.fn()` (`makeDbStub` L64-96), `buildApp(db,{role})` L98-124; cubre 401/403/201/409(23505)/404/roles/flota. Sin Postgres real.
- admin-dispositivos: **cero tests** (gap).
- Integration relacionado: solo `matching-vehiculos-index.integration.test.ts`.

## 9. Checklist IDOR aplicable

- Patrón canónico: filtro compuesto id+empresaId; no-match → 404 (no revelar existencia).
- Recomendaciones abiertas del audit: log estructurado de 403 con actor/target para detectar scans; test IDOR explícito A-no-escribe-en-B (sería el primero del repo si se hace en W2 — hacerlo).
- security-checklist: Zod boundary + límites; evaluar rate-limit (409 de UNIQUE permite enumerar IMEIs ajenos — considerar respuesta neutra o rate limit).

## Implicancias de diseño para el brief W2

1. Sin migración: puro código de aplicación.
2. El PATCH nuevo define POR PRIMERA VEZ el enforcement espejo (422 `imei_espejo_activo`) y el uso de `reemplazado`.
3. Decidir semántica de reconciliación pending_devices (plan: aprobar al asociar; reemplazado al cambiar) — el estado global sin empresaId implica que "aprobar" un pending por IMEI podría pisar un pending que otra empresa "iba a reclamar": el UNIQUE de vehiculos.teltonika_imei + 409 imei_en_uso resuelve el conflicto de fondo.
4. UNIQUE→409 `imei_en_uso` sin revelar tenant (mensaje neutro).
5. UI: agregar campo en detalle (no en create) + corregir patrón de error con `err.code`.
6. Crear Zod de IMEI (`^\d{15}$`) — no existe; evaluar shared-schemas para paridad cliente/servidor.
