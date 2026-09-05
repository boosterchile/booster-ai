# Spec: chore-renovar-reviewby-is-demo-allowlist

- Author: Felipe Vicencio (with Claude Fable 5.1)
- Date: 2026-09-05
- Status: Approved
- Linked: `apps/api/src/middleware/is-demo-allowlist.ts` (regla 2: «`reviewBy` ≤90 días; re-review obligatoria al expirar»); gates CI `is-demo allowlist comment-lint (SC-1.3.6 T6c)` y `PR-modifies guard (SC-1.3.6 T6d)` en `security.yml`; `.specs/sec-001-cierre/plan-sprint-2b.md` §3 T2b; PR #349 (T1–T3) y PR #356 (T10) que poblaron el allowlist; PR #593 (retiro de la superficie demo login).

## 1. Objective

Cumplir la re-revisión que el allowlist exige al expirar y dejar el gate T6c en verde: cada entrada vigente recibe `reviewBy: '2026-12-04'` (hoy +90 días, el máximo por defecto), y las entradas que la revisión demuestra muertas o incorrectas se retiran o corrigen en vez de renovarse a ciegas.

## 2. Why now

Las 6 entradas vencieron el 25 y 26 de agosto de 2026. Desde la corrida programada de `security.yml` del 2026-08-31 (run 33376768759, `main` @ `782c71f`) el job T6c falla en `main` y en toda PR abierta, incluida #667. No es check requerido por la protección de `main` (ADR-076), pero un rojo permanente entrena a ignorar rojos.

## 3. Success criteria

- [ ] `pnpm --filter @booster-ai/api exec tsx scripts/check-is-demo-allowlist-comments.ts` → `OK — 5 entries validated` (rojo exhibido antes: `6 violation(s) in 6 entries`).
- [ ] Ninguna entrada con `reviewBy` posterior a 2026-12-04 (regla ≤90 días).
- [ ] Cada entrada que queda tiene ruta real con el mismo método en `apps/api/src` (tabla en §7).
- [ ] `POST /demo/login` fuera del allowlist: la ruta fue retirada en PR #593 (`server.ts`: «POST /demo/login … RETIRADO»).
- [ ] `cache-warm` con `methods: ['GET']`, igual que `routes/demo-cache-warm.ts` (`app.get('/cache-warm/:persona')`).
- [ ] Biome sin hallazgos sobre el archivo; gitleaks limpio; CI de la PR con T6c y T6d en verde.

## 4. User-visible behaviour

Ninguno. El middleware `is-demo-enforcement` está cableado en `server.ts` con `mode: 'requireNotDemo'`, y el allowlist solo se consulta en `mode: 'explicitAllow'` (`is-demo-enforcement.ts`, opción `allowlist`). Hoy el allowlist es defensa preventiva sin efecto en runtime; el cambio solo altera qué quedaría permitido si algún día se cablea `explicitAllow`.

## 5. Out of scope

- Cambiar el modo del middleware o cablear `explicitAllow`.
- Los fixtures con `reviewBy: '2026-08-25'` en `is-demo-enforcement.test.ts`: son datos de prueba del middleware, no los valida T6c.
- Evitar la próxima expiración silenciosa (aviso previo o recordatorio agendado): follow-up aparte, ver §8.

## 6. Constraints

1. Renovar solo tras verificar cada ruta contra el código vivo; no se renueva ninguna entrada sin ruta.
2. Diff mínimo: solo `is-demo-allowlist.ts` y esta spec. Sin tocar `server.ts`, routers ni gates de CI.
3. Este chore no pertenece a ninguno de los tres frentes vivos; entra por orden expresa del PO (2026-09-05) como mantenimiento.

## 7. Approach

Re-revisión entrada por entrada contra `apps/api/src` @ `782c71f`:

| Entrada | Ruta viva | Método real | Compuerta | Decisión |
|---|---|---|---|---|
| `POST /demo/login` | No: `server.ts:216` «RETIRADO — chore/retiro-subsistema-demo» (PR #593) | — | — | **Retirar** |
| `/api/v1/demo/cache-warm/:persona` | Sí: `server.ts:223` monta `createDemoCacheWarmRoutes` bajo `/api/v1/demo` | `GET` (`routes/demo-cache-warm.ts:63`) | pública, rate-limit por IP | **Corregir método POST→GET y renovar** |
| `GET /feature-flags` | Sí: `server.ts:214` | `GET` (`routes/feature-flags.ts:31`) | pública, sin auth por diseño (ADR-035/036) | Renovar |
| `POST /api/v1/signup-request` | Sí: `server.ts:250-251` | `POST` (`routes/signup-request.ts:38`) | pública, `rateLimitSignup` | Renovar |
| `POST /admin/signup-requests/:id/approve` | Sí: `server.ts:706-720` | `POST` (`routes/admin-signup-requests.ts:153-154`) | firebaseAuth + demoExpires + isDemoEnforcement + `requirePlatformAdmin` (`BOOSTER_PLATFORM_ADMIN_EMAILS`) | Renovar |
| `POST /admin/signup-requests/:id/reject` | Sí: ídem | `POST` (`routes/admin-signup-requests.ts:250-251`) | ídem | Renovar |

Fecha nueva: `2026-12-04` = 2026-09-05 + 90 días (`date -v+90d`).

## 8. Alternatives considered

- **Renovar las 6 fechas sin revisar.** Descartada: la regla del archivo exige re-review, y habría certificado por 90 días más una ruta inexistente y un método falso.
- **Poner `reviewBy: '2099-01-01'`.** Descartada: viola el «≤90 días por defecto» y vacía de sentido el mecanismo.
- **Relajar T6c a advertencia.** Descartada: toca un quality gate de `security.yml`, que el contrato reserva al PO y exige ADR.
- **Follow-up sugerido, no incluido**: que T6c avise (sin fallar) 14 días antes del vencimiento, o un recordatorio agendado, para que la expiración no aparezca como rojo sorpresa en PRs ajenas.
