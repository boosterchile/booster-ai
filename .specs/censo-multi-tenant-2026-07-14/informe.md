# Censo de aislamiento multi-tenant — Booster AI

**Fecha de ejecución**: 2026-07-14 (queries a prod y censo de código; redactado 2026-07-15).
**Alcance**: READ-ONLY — repo en `main`-equivalente (rama `fix/gateway-tls-observabilidad`, sin divergencia en las rutas auditadas) + Cloud SQL prod vía `scripts/db/agent-query.sh`.
**Pregunta del PO**: ¿la arquitectura multi-tenant es real, o es un MVP single-tenant con `empresa_id` decorativo?
**Regla de oro aplicada**: no se concluyó nada desde nombres de tabla, comentarios ni UI — solo filtro efectivo en queries y resolución del tenant en runtime. Lo no verificable quedó marcado **NO VERIFICADO**.

---

## VEREDICTO: (B) — multi-tenant estructural, no ejercido como producto self-service

- **No es (C)**: 0 hardcodes de tenant, 0 queries sin filtro sobre tablas de tenant (censo de 148 sitios), resolución del tenant desde la sesión con 403 real ante empresa ajena, 7 tenants coexistiendo en prod con actividad en más de uno. El `empresa_id` no es decorativo y está enforced por CI en la capa de rutas.
- **No alcanza (A)**: el pipeline de onboarding existe completo en código pero está apagado por feature flags en prod (encenderlo = `terraform apply` + secreto), la cola de solicitudes lleva un mes sin poder atenderse, el alta real más reciente entró por vía no trazable al flujo, falta invitación de miembros operativos, y el aislamiento es 100 % capa aplicación (0 RLS en Postgres) con la capa services fuera del alcance del linter que lo enforcea.

---

## 1. Inventario de tablas — 39 (fuente única: `apps/api/src/db/schema.ts`)

| Categoría | N | Tablas (archivo:línea de `pgTable`) |
|---|---|---|
| Con `empresa_id` exacto | 9 | `membresias` (:764, nullable XOR stakeholder), `vehiculos` (:822), `sucursales_empresa` (:924), `conductores` (:1093), `zonas` (:1136), `ofertas` (:1230), `asignaciones` (:1267), `carrier_memberships` (:2013), `eventos_impersonacion` (:2552, nullable) |
| Discriminador renombrado → `empresas.id` | 6 | `viajes` (`generador_carga_empresa_id` :1172, nullable por draft WhatsApp), `mensajes_chat` (`remitente_empresa_id` :1839), `liquidaciones` (`empresa_carrier_id` :2059), `facturas_booster_clp` (`empresa_destino_id` :2125), `shipper_credit_decisions` (`empresa_shipper_id` :2215), `adelantos_carrier` (carrier+shipper :2252/:2255) |
| Sin discriminador, con FK indirecto a tabla tenant-scoped | 10 | `documentos_vehiculo` (:978→vehiculos), `documentos_conductor` (:1014→conductores), `posiciones_movil_conductor` (:1047→vehiculos), `eventos_viaje` (:1374→viajes), `metricas_viaje` (:1403→viajes), `borradores_whatsapp` (:1647→viajes, nullable), `dispositivos_pendientes` (:1685→vehiculos, nullable), `telemetria_puntos` (:1717→vehiculos), `eventos_conduccion_verde` (:1768→vehiculos), `documentos_transporte` (:2501→viajes) |
| Sin discriminador ni FK indirecto | 14 | `planes` (catálogo), `empresas` (raíz de tenant), `usuarios` (identidad global, N:M vía membresias), `organizaciones_stakeholder` (tenant paralelo, :696), `zonas_stakeholder`, `stakeholders` (user-scoped), `consentimientos`, `log_acceso_stakeholder`, `push_subscriptions` (user-scoped), `membership_tiers` (catálogo), `matching_backtest_runs` (admin), `configuracion_sitio` (singleton), `cuentas_demo` (registry ADR-053), `solicitudes_registro` (pre-tenant) |

**Lista (b) — "debería tener tenant y no lo tiene": 0 tablas.** Asteriscos (no-(b), pero constan):

- `consentimientos.alcance_id` y `log_acceso_stakeholder.alcance_id` polimórficos **sin FK** (`schema.ts:1561`, `:1611`) — scoping no verificable por integridad referencial.
- `posicion es_movil_conductor.asignacion_id` uuid **sin `.references`** (`schema.ts:1046`) — hueco de integridad, no de tenancy.
- Gating de lectura de `matching_backtest_runs`: **NO VERIFICADO** (sus reads no aparecen en `routes/`).

Definiciones fuera de `schema.ts`: ninguna en workspaces reales (los hits extra son git worktrees en `.claude/worktrees/`, copias del mismo archivo).

## 2. Filtro efectivo en queries — la prueba madre

**Censo por tabla en `apps/api/src/routes/`** (lógica de detección idéntica a `scripts/lint-rls.mjs`, contando en vez de fallar; 148 sitios `.from/.update/.delete`):

| Tabla | Con filtro | Allowlisted | SIN filtro |
|---|---|---|---|
| `vehicles` | 15 | 0 | 0 |
| `conductores` | 9 | 2 | 0 |
| `assignments` | 7 | 2 | 0 |
| `trips` | 7 | 1 | 0 |
| `documentosVehiculo` | 5 | 0 | 0 |
| `documentosConductor` | 5 | 0 | 0 |
| `sucursalesEmpresa` | 5 | 0 | 0 |
| `transportDocuments` | 3 | 1 | 0 |
| `carrierMemberships` | 3 | 0 | 0 |
| `offers` | 2 | 0 | 0 |
| `adelantosCarrier` | 1 | 3 | 0 |
| `liquidaciones` | 1 | 0 | 0 |
| `shipperCreditDecisions` | 0 | 2 | 0 |
| admin/global (`configuracionSitio` 10, `organizacionesStakeholder` 4, `zonasStakeholder` 1, `data` 1) | 0 | 16 | 0 |
| **TOTALES** | **63** | **27** | **0** |

(+58 sitios en las 16 tablas declaradas tenant-free en `lint-rls.mjs:31-48`: `users` 21, `memberships` 9, `pendingDevices` 9, `telemetryPoints` 6, `chatMessages` 4, resto ≤2.)

- **0 queries sin filtro sobre tablas de tenant.** Corroborado con el linter real: `pnpm lint:rls` → `✅ 0 queries sin filtro empresaId fuera de allowlist` (corrido 2026-07-14).
- **Allowlist total: 16 tablas tenant-free (`lint-rls.mjs:31-48`) + 29 comentarios inline `// rls-allowlist:`** (27 cubren sitios de query; 2 cubren no-queries). Dos familias: rutas platform-admin (gateadas por `requirePlatformAdmin`: `admin-cobra-hoy.ts:131,193,238,258,293`, `site-settings.ts` ×11, `admin-stakeholder-orgs.ts` ×6) y cross-tenant por diseño (`stakeholder-zonas.ts:152` agregación k-anon k≥5 ADR-041/042, `chat.ts:162`, `assignments.ts:420` driver-scoped, `auth-driver.ts:130` pre-tenant, `conductores.ts:310` unicidad global, `transport-documents.ts:148,469`, `site-settings.ts:363` lectura pública).
- **Muestreo manual de control (5 rutas de negocio)** — WHERE efectivo con `empresa_id` del request: viajes `trip-requests-v2.ts:246,266`; vehículos `vehiculos.ts:340,640,677,767,894,964,1157`; documentos vía gate `authorizeOverTrip` (`transport-documents.ts:219-244`, invocado en `:267,:434,:520,:568`); ofertas `offers.ts:85`; financiero `cobra-hoy.ts:205` (+ chequeo app-level `assignments.ts:169-179`). En todos, el valor proviene de `auth.activeMembership.empresa.id`.
- **Fuera del linter** (services/jobs/otros apps): 0 lecturas accidentales sin aislamiento. Categorías legítimas: (1) scoped por `tripId`/`assignmentId`/`vehicleId` ya validado (pipeline métricas/score/certificado/coaching, financiero cobra-hoy); (2) global por diseño (resolución IMEI `imei-auth.ts:51` y `persist.ts:44`, tracking público por token `get-public-tracking.ts:190`, matching cross-empresa `matching.ts:224`, jobs de sistema `backfill-certificados.ts:135`, `merge-duplicate-users.ts:109`, `reap-inert-idp-accounts.ts:146`, cobro mensual `cobrar-memberships-mensual.ts:144`); (3) empresa derivada del recurso (`matching-v2-lookups.ts:73,92` filtra `inArray(assignments.empresaId, …)`, `route-safety-recipients.ts:93`, `notify-offer.ts:98`); (4) tenant-free/pre-tenant (`user-context.ts:58,66`, `onboarding.ts:187-215`, `signup-request.ts:58,128`). Workspaces sin acceso a DB: notification-service, whatsapp-bot, matching-engine, eco-routing-service, sms-fallback-gateway, auth-blocking-functions y todos los `packages/*`.

**Límites honestos de la prueba**:
1. El linter es textual, no AST: ventana −10/+30 líneas y `includes` de token (`lint-rls.mjs:92-103`) — "con filtro" = presencia del token en la ventana. Mitigado por el muestreo manual.
2. Solo cubre `apps/api/src/routes/` (`lint-rls.mjs:28`) y no ve raw SQL (regex `:68`). El patrón "scoped-por-id-validado" de la capa services **no está enforced por ninguna herramienta** — depende de que cada ruta llamadora valide tenant antes de pasar el id.
3. **0 RLS a nivel Postgres**: sin `CREATE POLICY` ni `ROW LEVEL SECURITY` en migraciones. Todo el aislamiento es capa aplicación.

## 3. Resolución del tenant — se resuelve desde la sesión, no se asume

- Cadena: token Firebase → `middleware/user-context.ts:32-48` (lee header `X-Empresa-Id`, `:41`) → `services/user-context.ts:58` (user por `firebase_uid`) → `:64-68` (**solo memberships activas del user**: `WHERE user_id AND status='activa'`) → `:76-81` (empresa pedida ∉ memberships → `EmpresaNotInMembershipsError` → **403** en `middleware/user-context.ts:69-78`) → `:82-84` (sin header: default = primera membership propia). El header restringe, nunca otorga.
- Greps de firma MVP (repo completo): `DEFAULT_EMPRESA` → **0 matches**. `empresa_id = 1` / `empresaId: 1` → **0 matches**. UUID `60c344e0` (Van Oosterwyk) → **1 match, solo documentación** (`.specs/hito-2-corfo-mes-8/decisiones.md:105`), **0 en código**.

## 4. Ruteo IMEI → empresa — por join, sin atajo

- Gateway: `apps/telemetry-tcp-gateway/src/imei-auth.ts:50-52` — `SELECT id FROM vehiculos WHERE teltonika_imei = ${imei}`; sin match → upsert `dispositivos_pendientes` (`:85-98`) con `vehicleId: null` (open enrollment, rate-limited `:62-68`).
- Processor: `apps/telemetry-processor/src/persist.ts:41-46` — re-lookup por IMEI si falta `vehicleId`; si sigue null **descarta con warn** (`:55`), jamás persiste huérfano; INSERT con `vehiculo_id` (`:73-78`).
- Pertenencia a empresa: FK `telemetria_puntos.vehiculo_id → vehiculos` (`schema.ts:1717`) + `vehiculos.empresa_id` (`:826`). En ningún punto del pipeline hay empresa asumida.

## 5. Onboarding — código completo, apagado en prod

**Flujo end-to-end por API+UI, sin SQL manual**:
1. `POST /api/v1/signup-request` público (`routes/signup-request.ts:38`; rate-limit 5/15min/IP; anti-enumeration) → fila en `solicitudes_registro`.
2. Platform-admin lista/aprueba (`admin-signup-requests.ts:130,153`; allowlist `BOOSTER_PLATFORM_ADMIN_EMAILS` `:99-113`; UI `/app/platform-admin/signup-requests`, `router.tsx:258`) → crea user Firebase + token one-shot HMAC → `onboarding_link`.
3. Usuario completa alta: `POST /empresas/onboarding-admin` (`empresas.ts:146`, header `x-onboarding-token`) → `onboardEmpresa` inserta **empresa+user+membership dueño** atómico (`services/onboarding.ts:241,269`, carrier free `:289`), consumiendo el token (`:158-182`). UI `/onboarding-admin?token=` (`router.tsx:75`).
4. Flota por UI: `POST /vehiculos` (`vehiculos.ts:518`, empresaId de sesión `:524`), `POST /conductores` (`conductores.ts:259,265`). Rutas web `router.tsx:143-267`.
   (Path legacy self-service: `POST /empresas/onboarding`, `empresas.ts:73,86`.)

**Estado real en prod**:
- Los 3 flags **OFF**: `signup_request_flow_activated = false` (`infrastructure/terraform.tfvars:34`; comentario: corrió `true` hasta ~2026-07-02, revertido), `admin_provisioned_onboarding_enabled` default false (`variables.tf:453-457`), `EMPRESA_SELF_ONBOARDING_ENABLED` default false (`config.ts:543`). Activar = `terraform apply` + rotación de `onboarding-token-signing-secret` (runbook `docs/corfo/hito-2/runbook-activacion-onboarding.md`).
- Notifier de email = **stub** (`LoggingSignupRequestNotifier`): el admin copia y entrega el link a mano.
- **No existe** endpoint para que un dueño invite miembros operativos (admin/despachador) a su propia empresa — memberships solo nacen en onboarding (`onboarding.ts:269`), flujo conductor (`auth-driver.ts:229`) y gestión admin de stakeholder-orgs (`admin-stakeholder-orgs.ts:280`).
- **Sin seeds de empresas**: 0 `INSERT INTO empresas` en scripts/migraciones (solo seed de `plans`).

**Evidencia prod (queries 2026-07-14, read-only)**:
- `empresas`: **7 filas, todas `es_demo=false`**. Actividad: `d277a221` (may-02, shipper, 7 viajes generados), `b79c8e2a` (may-02, carrier, 4 vehículos, 1 asignación), `60c344e0` (may-04, carrier, 8 vehículos), `f93e5ad1`/`cae09bdc` (may-08, mínimas), `98f26fe7`/`da794a7a` (**2026-07-12**, sin actividad; la última con 2 miembros).
- `solicitudes_registro`: **6 filas, todas `pendiente_aprobacion`** (2026-06-07 → 2026-07-07). Nadie puede aprobarlas con el flag OFF (el admin recibe 503).
- Las 2 empresas del 07-12 **no** pasaron por el flujo moderno (0 solicitudes aprobadas). Vía exacta: **NO VERIFICADO** desde el repo (indicio circunstancial: activación temporal del path legacy para evidencia CORFO hito-2 — existe el runbook y el screenshot `prod-login-legacy.png` del 07-14 en el working tree).

---

## NO VERIFICADO (consolidado)

1. Gating de lectura de `matching_backtest_runs` (sus reads no están en `routes/`).
2. Vía de creación de las 2 empresas del 2026-07-12 en prod.
3. Enforcement del scoping-por-id-validado en la capa `services/` (verificado por barrido manual una vez; sin herramienta que lo mantenga).
4. Verificación semántica AST de los 63 "con filtro" (el linter es textual; mitigado por muestreo de 5 rutas).

## Metodología

- Inventario y censo de código: barrido del repo (3 pasadas independientes) + censo derivado de `scripts/lint-rls.mjs` (misma regex/ventana/tokens, contando por tabla).
- Prod: `scripts/db/agent-query.sh` (IAP tunnel + ADC, read-only), 4 queries: `dispositivos_pendientes`, `empresas` (conteo es_demo), actividad por empresa (membresias/vehiculos/viajes/asignaciones), `solicitudes_registro` por estado.
- Sin cambios de código propuestos: este censo diagnostica, no arregla (pedido explícito del PO).
