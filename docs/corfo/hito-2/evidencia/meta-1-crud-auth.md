# Meta 1 — Evidencia: plataforma con CRUD + auth operativos

> Hito CORFO mes 8 (proyecto 25IR-305522, SmartAICargo = Booster AI) · W5 cierre
> Fecha de verificación: 2026-07-06 · Rama: `chore/hito-2-cierre` (desde `main` con W1 mergeado, PR #565, commit `62453ae`)
> Spec: [`.specs/hito-2-corfo-mes-8/plan.md`](../../../../.specs/hito-2-corfo-mes-8/plan.md)
> Runbook de activación del alta de usuarios: [`docs/corfo/hito-2/runbook-activacion-onboarding.md`](../runbook-activacion-onboarding.md)

## Metodología

Cada fila cita `file:line` real (verificado contra el árbol de esta rama) y un conteo de tests obtenido con una corrida **fresca** de Vitest (`node 24`, `pnpm vitest run <archivo>`, 2026-07-06), no con grep ni con cifras de memoria. Donde el conteo de `grep -c "it("` difería del conteo real de Vitest (tests parametrizados con `it.each`/`describe.each`), se usó el número de Vitest. Los PRs se citan con su número y estado real al momento de escribir (`gh pr view`).

---

## Tabla resumen

| # | Capacidad | Implementación (file:line) | Evidencia verificable | Estado |
|---|---|---|---|---|
| 1 | Gestión de Cargas | `apps/api/src/routes/trip-requests-v2.ts` (6 endpoints) + `apps/api/src/routes/offers.ts` (3 endpoints) + `apps/api/src/routes/trip-requests.ts` (legacy v1) | 79 tests / 5 archivos (detalle §1) | Operativo en `main` |
| 2 | Gestión de Envíos/Viajes | `apps/api/src/routes/assignments.ts` (8 endpoints) + `packages/trip-state-machine` (estados/transiciones) | 91 tests / 7 archivos (detalle §2) | Operativo en `main` |
| 3 | Gestión de Usuarios (alta operativa) | `solicitar-acceso` → `admin-signup-requests.ts` (approve) → `onboarding-admin.tsx` → `empresas.ts` (`POST /onboarding-admin`) | 121 tests / 10 archivos (86 api + 35 web) — PR #565 mergeado 2026-07-06 (detalle §3) | Código operativo; **activación en prod gateada por runbook** (flags OFF hasta que el PO ejecute los 8 pasos) |
| 4 | Auth / Roles | Firebase ID token (`firebase-auth.ts`) → `user-context.ts` (RBAC 6 roles) → `require-platform-admin.ts` (allowlist) + rate limiting | 50 tests / 6 archivos (detalle §4) | Operativo en `main` |
| 5 | Vehículos/Flota (bonus Meta 1) | `apps/api/src/routes/vehiculos.ts` (8 endpoints CRUD) | 26 tests unit + 4 integration (detalle §5) | CRUD base operativo en `main`; IMEI self-service (#566), temperatura (#567) y tipologías (#568) **en PR, no mergeados** |

---

## 1. Gestión de Cargas

| Endpoint | file:line | Descripción |
|---|---|---|
| `POST /trip-requests-v2` | `apps/api/src/routes/trip-requests-v2.ts:117` | Crea viaje (carga) y dispara matching automático |
| `GET /trip-requests-v2` | `apps/api/src/routes/trip-requests-v2.ts:216` | Lista viajes de la empresa shipper activa |
| `GET /trip-requests-v2/:id` | `apps/api/src/routes/trip-requests-v2.ts:255` | Detalle: eventos, asignación, métricas, ubicación del vehículo |
| `GET /trip-requests-v2/:id/certificate/download` | `apps/api/src/routes/trip-requests-v2.ts:390` | Signed URL del certificado de huella de carbono (TTL 5 min) |
| `PATCH /trip-requests-v2/:id/confirmar-recepcion` | `apps/api/src/routes/trip-requests-v2.ts:464` | Shipper confirma entrega recibida (dispara emisión de certificado) |
| `PATCH /trip-requests-v2/:id/cancelar` | `apps/api/src/routes/trip-requests-v2.ts:517` | Cancelación pre-asignación, transaccional con `FOR UPDATE` (evita race con accept) |
| `GET /offers/mine`, `POST /offers/:id/accept`, `POST /offers/:id/reject`, `GET /offers/:id/eco-preview` | `apps/api/src/routes/offers.ts:53,117,205,260` | Ciclo de vida de la oferta ligada a la carga (transportista ve/responde) |
| `apps/api/src/routes/trip-requests.ts` (121 líneas) | — | Endpoint legacy v1, mantenido solo por compatibilidad; `trip-requests-v2` es el canónico |

**Evidencia (tests, corrida fresca Vitest node 24, 2026-07-06):**

| Archivo | Tests |
|---|---|
| `apps/api/test/unit/trip-requests-v2.test.ts` | 27 |
| `apps/api/test/unit/trip-requests-route.test.ts` (legacy v1) | 9 |
| `apps/api/test/unit/offers.test.ts` | 16 |
| `apps/api/test/unit/offer-actions.test.ts` (lógica pura accept/reject) | 18 |
| `apps/api/test/unit/notify-offer.test.ts` | 9 |
| **Subtotal** | **79 tests / 5 archivos** |

**Estado**: Operativo en `main`, sin flags pendientes.

---

## 2. Gestión de Envíos/Viajes

| Endpoint | file:line | Descripción |
|---|---|---|
| `GET /assignments/:id` | `apps/api/src/routes/assignments.ts:114` | Detalle assignment + trip para el carrier |
| `GET /assignments/:id/eco-route` | `apps/api/src/routes/assignments.ts:267` | Polyline de ruta sugerida (Routes API) |
| `PATCH /assignments/:id/confirmar-entrega` | `apps/api/src/routes/assignments.ts:306` | POD del transportista (fallback al flujo del shipper) |
| `POST /assignments/:id/driver-position` | `apps/api/src/routes/assignments.ts:411` | Conductor reporta posición desde browser |
| `POST /assignments/:id/incidents` | `apps/api/src/routes/assignments.ts:458` | Reporte de incidente operacional (audit-only) |
| `GET /assignments/:id/behavior-score` | `apps/api/src/routes/assignments.ts:510` | Score de conducción post-entrega |
| `GET /assignments/:id/coaching` | `apps/api/src/routes/assignments.ts:571` | Mensaje de coaching IA (Gemini o plantilla) |
| `POST /assignments/:id/asignar-conductor` | `apps/api/src/routes/assignments.ts:639` | Carrier asigna conductor (rol-gate: `dueno`/`admin`/`despachador`, línea 646-650) |

**Máquina de estados** — `packages/trip-state-machine/src/`:
- `estados.ts:12-22` — `ESTADOS_VIAJE`: `borrador, esperando_match, emparejando, ofertas_enviadas, asignado, en_proceso, entregado, cancelado, expirado`.
- `estados.ts:38-42` — `ESTADOS_TERMINALES`: `entregado, cancelado, expirado` (sin transiciones de salida).
- `transiciones.ts:21` — mapa `TRANSICIONES` (tabla completa de transiciones válidas); `transiciones.ts:33` `puedeTransicionar`; `transiciones.ts:50` `assertTransicion`; `transiciones.ts:63` `esCancelablePorShipper`; `transiciones.ts:68` `esAceptableOferta`; `transiciones.ts:77` `esConfirmableEntrega`.
- Paridad con el DDL garantizada por `trip-state-machine-parity.test.ts` en `apps/api` (el package es zero-dep, no importa Drizzle).

**Servicio central de cierre**: `apps/api/src/services/confirmar-entrega-viaje.ts` — un solo servicio compartido entre el flujo shipper (`trip-requests-v2.ts` `PATCH /:id/confirmar-recepcion`) y el flujo carrier (`assignments.ts` `PATCH /:id/confirmar-entrega`); "primer click gana", idempotente.

**Evidencia (tests, corrida fresca):**

| Archivo | Tests |
|---|---|
| `apps/api/test/unit/assignments-route.test.ts` | 22 |
| `apps/api/test/unit/asignar-conductor-a-assignment.test.ts` | 9 |
| `apps/api/test/unit/get-assignment-eco-route.test.ts` | 11 |
| `apps/api/test/unit/confirmar-entrega-viaje.test.ts` | 11 |
| `apps/api/src/services/confirmar-entrega-viaje.test.ts` | 4 |
| `packages/trip-state-machine/src/index.test.ts` (paridad enum DDL) | 1 |
| `packages/trip-state-machine/src/transiciones.test.ts` | 33 |
| **Subtotal** | **91 tests / 7 archivos** |

**Estado**: Operativo en `main`, sin flags pendientes.

---

## 3. Gestión de Usuarios — alta operativa (PR #565, mergeado 2026-07-06)

Cadena E2E: `POST /api/v1/signup-request` (público, anti-enumeración) → admin aprueba → link de onboarding one-shot → `/onboarding-admin?token=` → `POST /empresas/onboarding-admin` (empresa + rol `dueno`).

| Paso | Implementación | Descripción |
|---|---|---|
| 1. Solicitar acceso | `apps/web/src/routes/solicitar-acceso.tsx` → `apps/api/src/routes/signup-request.ts:38` (`POST /`) | Página pública + endpoint; respuesta 202 siempre (anti-enumeración) |
| 2. Approve admin | `apps/api/src/routes/admin-signup-requests.ts:153` (`POST .../approve`) | Emite `onboarding_link` (línea 215, `buildOnboardingLink`) + `onboarding_link_expires_at` (línea 219); token HMAC-SHA256 one-shot en `apps/api/src/services/onboarding-token.ts` |
| 3. UI admin | `apps/web/src/routes/platform-admin-signup-requests.tsx` | Muestra el link copiable **una sola vez** |
| 4. Consumo del token | `apps/web/src/routes/onboarding-admin.tsx` | Header `x-onboarding-token` (nunca en URL ni body); reusa `OnboardingForm` |
| 5. Alta empresa + dueño | `apps/api/src/routes/empresas.ts:146` (`POST /onboarding-admin`) | Valida con `empresaOnboardingInputSchema` (Zod, `packages/shared-schemas/src/onboarding.ts:19`); crea empresa + membership rol `dueno` vía `apps/api/src/services/onboarding.ts` |

**Evidencia (tests, corrida fresca):**

| Archivo (api) | Tests |
|---|---|
| `apps/api/src/routes/admin-signup-requests.test.ts` | 17 |
| `apps/api/src/routes/signup-request.test.ts` | 10 |
| `apps/api/src/services/onboarding-token.test.ts` | 26 |
| `apps/api/src/services/signup-request.test.ts` | 6 |
| `apps/api/src/services/notifications/signup-request-email.test.ts` | 5 |
| `apps/api/test/unit/empresas-onboarding.test.ts` | 22 |
| **Subtotal api** | **86 tests / 6 archivos** |

| Archivo (web) | Tests |
|---|---|
| `apps/web/src/routes/onboarding-admin.test.tsx` | 8 |
| `apps/web/src/routes/onboarding.test.tsx` | 4 |
| `apps/web/src/routes/platform-admin-signup-requests.test.tsx` | 8 |
| `apps/web/src/routes/solicitar-acceso.test.tsx` | 15 |
| **Subtotal web** | **35 tests / 4 archivos** |

**PR #565** — `feat(onboarding): alta de usuarios operativa E2E (W1 hito CORFO mes 8)`, mergeado 2026-07-06 (commit `62453ae`). El propio PR declara, con `pnpm run ci` corrido en la rama (node 24, exit 0): **api 1657/1657 (139 archivos, 2 skipped)** y, como checkpoint de la tarea W1.3, **web 1085/1085 (113 archivos)**. Ver §"Cobertura y calidad" para la reconciliación de esa cifra de web contra la corrida fresca de hoy.

**Trace E2E en producción**: activación aplicada y verificada por REST el 2026-07-07 ~04:06 (flip de ambos flags OK, revisión `booster-ai-api-00375-wkx` 100%, secret v2 montado, `EMPRESA_SELF_ONBOARDING` ausente/false). El trace end-to-end del alta (`signup → approve → link → onboarding → /me`) queda **[PENDIENTE — smoke AM]**: es un flujo multi-tap que se difirió por la regla de parada; script ejecutable en [`../smoke-test-manana.md`](../smoke-test-manana.md) §E2E, con captura del `firebase_uid`/`user_id` reales para pegar acá.

**Estado real de activación** (no confundir con "código operativo"): todo el código de W1 vive en `main` **gateado por flags en `false`**. El runbook [`docs/corfo/hito-2/runbook-activacion-onboarding.md`](../runbook-activacion-onboarding.md) documenta las 4 condiciones de flip — las 4 quedaron cumplidas y con acta firmada el 2026-07-06 (TTL 72h ratificado, sign-off del modelo bearer-token, secret rotado, reaper T1.7 agendado en `paused`). La activación real en prod (pasos 5-8 del runbook: flip de flags, deploy con gate humano, primer tick del reaper, E2E de aceptación, monitoreo 2h) es responsabilidad del PO y se registra por separado.

---

## 4. Auth / Roles

| Componente | file:line | Descripción |
|---|---|---|
| Verificación de Firebase ID token | `apps/api/src/middleware/firebase-auth.ts` (`createFirebaseAuthMiddleware`) | Valida `Authorization: Bearer <id_token>`, propaga `FirebaseClaims` (uid, email, custom claims) al context |
| Resolución de contexto de usuario | `apps/api/src/middleware/user-context.ts:27` (`createUserContextMiddleware`) + `apps/api/src/services/user-context.ts` (`resolveUserContext`) | Resuelve user + memberships activas + empresa activa (header `X-Empresa-Id` opcional si solo hay 1 membership) |
| RBAC — 6 roles por membership | `apps/api/src/db/schema.ts:73-80` (`membershipRoleEnum`, DDL `rol_membresia`) | `dueno, admin, despachador, conductor, visualizador, stakeholder_sostenibilidad` |
| Ejemplo de rol-gate por endpoint | `apps/api/src/routes/assignments.ts:646-650` | `POST /:id/asignar-conductor` exige rol `dueno`/`admin`/`despachador` (excluye `conductor`, `visualizador`, `stakeholder_*`) |
| Platform admin allowlist | `apps/api/src/middleware/require-platform-admin.ts` (`requirePlatformAdmin`) | Guard separado del RBAC per-empresa, para rutas `/admin/*`; allowlist por email en `BOOSTER_PLATFORM_ADMIN_EMAILS` (variable Terraform) |
| Rate limiting — signup | `apps/api/src/middleware/rate-limit-signup.ts` | `POST /api/v1/signup-request`: 5 intentos/15min por IP (Redis), fail-closed (503 si Redis cae) |
| Rate limiting — login PIN (driver) | `apps/api/src/middleware/rate-limit-pin.ts` | `POST /auth/driver-activate`: 5/15min por RUT + 30/15min por IP, fail-closed |

**ADRs de referencia:**
- **ADR-001** — "Selección del Stack Tecnológico" (Accepted, 2026-04-23). El `CLAUDE.md` del repo lo cita como respaldo de "JWT Zero-Trust"; el contenido verificado del archivo trata la selección de stack en general (incluye OAuth vs JWT para server-to-server, línea 101) — el modelo operativo de verificación por-request para usuarios finales está formalizado en ADR-028, no en el cuerpo de ADR-001.
- **ADR-028** — "RBAC/Auth v1: Firebase ID tokens + memberships per-empresa + consent grants para stakeholders" (Accepted, 2026-05-10) — modelo canónico de roles/memberships implementado arriba.
- **ADR-035** — "Auth universal: RUT + clave numérica para todos los roles" (Accepted, 2026-05-13) — flujo alternativo de login, gateado por `AUTH_UNIVERSAL_V1_ACTIVATED` (hoy OFF).

> Nota de higiene de documentación (hallazgo de esta verificación, sin corregir aquí por estar fuera de alcance): `docs/adr/` tiene **dos** archivos con el número 028 (`028-dual-source-data-model-teltonika-vs-maps.md` y `028-rbac-auth-firebase-multi-tenant-with-consent-grants.md`) y **dos** con el número 035 (`035-trl10-mantener-ha-recortar-ruido.md` y `035-auth-universal-rut-clave-numerica.md`). Los títulos citados arriba corresponden a los ADRs de auth/RBAC verificados contra el contenido real de cada archivo.

**Evidencia (tests, corrida fresca):**

| Archivo | Tests |
|---|---|
| `apps/api/test/unit/firebase-auth.test.ts` | 12 |
| `apps/api/test/unit/user-context-middleware.test.ts` | 6 |
| `apps/api/test/unit/user-context.test.ts` | 6 |
| `apps/api/test/unit/observability/require-platform-admin.test.ts` | 7 |
| `apps/api/src/middleware/rate-limit-signup.test.ts` | 7 |
| `apps/api/src/middleware/rate-limit-pin.test.ts` | 12 |
| **Subtotal** | **50 tests / 6 archivos** |

**Estado**: Operativo en `main`, sin flags pendientes.

---

## 5. Vehículos/Flota (bonus Meta 1)

CRUD base ya en `main` — `apps/api/src/routes/vehiculos.ts` (747 líneas):

| Endpoint | file:line |
|---|---|
| `GET /` (listado) | `apps/api/src/routes/vehiculos.ts:132` |
| `GET /flota` (vista agregada) | `apps/api/src/routes/vehiculos.ts:175` |
| `POST /` (crear) | `apps/api/src/routes/vehiculos.ts:335` |
| `GET /:id` (detalle) | `apps/api/src/routes/vehiculos.ts:386` |
| `PATCH /:id` (actualizar) | `apps/api/src/routes/vehiculos.ts:408` |
| `DELETE /:id` (baja) | `apps/api/src/routes/vehiculos.ts:494` |
| `GET /:id/telemetria` | `apps/api/src/routes/vehiculos.ts:523` |
| `GET /:id/ubicacion` | `apps/api/src/routes/vehiculos.ts:593` |

**Evidencia (tests, corrida fresca):**

| Archivo | Tests |
|---|---|
| `apps/api/test/unit/vehiculos.test.ts` | 26 |
| `apps/api/test/integration/matching-vehiculos-index.integration.test.ts` (lane `pnpm test:integration`, requiere Postgres real; no corrido en esta verificación, no incluido en el total de 1657) | 4 |

**PRs abiertos, honestos sobre su estado real** (verificado 2026-07-06 vía `gh pr view <n> --json state`):

| PR | Título | Estado |
|---|---|---|
| #566 | `feat(vehiculos): IMEI Teltonika self-service desde la UI de la empresa (W2)` | **OPEN** — no mergeado |
| #567 | `feat(telemetry): temperatura Dallas E2E — simulador, API y vehiculo-live (W3)` | **OPEN** — no mergeado |
| #568 | `feat(flota): tipologías motriz/arrastre + clase GLEC por configuración (W4a)` | **OPEN** — no mergeado |

**Estado**: el CRUD base de vehículos está **operativo en `main`** y cumple por sí solo el criterio de Meta 1 (plataforma con CRUD). IMEI self-service, temperatura Dallas y tipologías motriz/arrastre son mejoras del hito en curso, **en PR, sin mergear** — no se cuentan como "completadas".

---

## Cobertura y calidad

- **Gate de CI** (`.github/workflows/ci.yml`): coverage mínimo bloqueante — `lines ≥ 80%`, `functions ≥ 80%`, `branches ≥ 75%` (`pnpm test:coverage` + verificación de `coverage-summary.json` por workspace).
- **`apps/api`**: corrida fresca (`node 24`, `vitest run`, 2026-07-06) → **1657 tests pasando, 2 skipped, 139 archivos**, exit 0. Coincide exactamente con lo declarado por el propio PR #565 en su tarea final W1.5.
- **`apps/web`**: corrida fresca (mismas condiciones) → **1096 tests pasando, 115 archivos**, exit 0. El PR #565 citaba **1085/113** como checkpoint de la tarea W1.3 (no como total final de la rama — a diferencia de api, el PR nunca declaró un total acumulado de web). `git log` confirma que `apps/web` no tuvo commits posteriores al merge de #565, por lo que **1096/115 es la cifra vigente y correcta hoy**; la diferencia (+11 tests, +2 archivos) corresponde a trabajo de las tareas W1.4/W1.5 posteriores al checkpoint W1.3 citado.
- **`packages/trip-state-machine`**: 34 tests, 2 archivos.
- **Tests de integración** (`apps/api/test/integration/`, lane separada `pnpm test:integration`, requiere Postgres real): 17 archivos existentes; no corridos en esta verificación por no disponer de una instancia de Postgres en este entorno — quedan fuera del conteo de 1657 (que es exclusivamente unit/route tests con mocks).
- **Suma de tests directamente atribuibles a esta matriz** (por archivo, ya contados arriba): Cargas 79 + Envíos/Viajes 91 + Usuarios 121 (86 api + 35 web) + Auth 50 + Vehículos 26 (unit) = **367 tests**, sobre un universo total del monorepo de 1657 (api) + 1096 (web) = **2753 tests**.
