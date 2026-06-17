# Spec: fix-config-redis-footgun-y-demo-expires

- Author: Felipe Vicencio (with agent-rigor)
- Date: 2026-06-11
- Status: Approved
- Linked: Auditoría 2026-06-09 — riesgo medio "footgun z.coerce.boolean en REDIS_TLS del package compartido" + gap reconocido "demo-expires ausente en /certificates/*" (follow-up Sprint 2c track-1 documentado inline en server.ts)

## 1. Objective

Cerrar dos gaps menores de la auditoría: (1) `packages/config/src/schemas/redis.ts` usa `z.coerce.boolean()` para `REDIS_TLS` — el mismo footgun ya corregido en apps/api (bug 2026-05-13: `"false"` coercea a `true`); un servicio que setee `REDIS_TLS=false` activaría TLS. (2) El chain de `/certificates/*` no incluye `demoExpiresMiddleware` (gap reconocido en el propio código): una sesión demo expirada puede seguir listando certificados.

## 2. Why now

(1) es una bomba latente para cualquier servicio nuevo que use el schema compartido; (2) es el único mount point auth-required sin el middleware, con follow-up prometido y nunca ejecutado.

## 3. Success criteria

- [ ] `REDIS_TLS="false"`/`"0"` parsea a `false`; `"true"`/`"1"` a `true`; ausente → default `false`. Helper `booleanFlag` exportado desde `@booster-ai/config` (reutilizable; converger apps/api queda anotado).
- [ ] `/certificates/*` tiene `demoExpiresMiddleware` con el mismo short-circuit del path público `/verify` que ya usan firebaseAuth/userContext; el comentario del gap se elimina.
- [ ] Tests de ambos comportamientos.

## 4. User-visible behaviour

(1) Ninguno hoy (nadie setea REDIS_TLS=false explícito); evita el incidente futuro. (2) Sesiones demo expiradas reciben el mismo tratamiento en certificados que en el resto de la superficie.

## 5. Out of scope

- Migrar apps/api/src/config.ts a usar el booleanFlag compartido (anotado en el commit; churn de 8 flags con tests propios — ciclo aparte si se prioriza).
- Otros usos de z.coerce en el monorepo (grep no encontró más booleans coercionados en boundaries).

## 6. Constraints

1. packages/config mantiene zod como única dep.
2. El short-circuit de /verify debe ser idéntico al de los otros dos middlewares del chain (mismo regex).

## 7. Approach

`booleanFlag(default)` en packages/config (preprocess explícito true/1/false/0/vacío, mismo contrato que el helper local de apps/api) usado por `redisEnvSchema.REDIS_TLS` + export en index. En server.ts, tercer wrapper del chain certificates con el regex `skipAuthForVerify` aplicando `demoExpiresMiddleware`.

## 8. Alternatives considered

- **A. Fix inline solo en redis.ts sin helper exportado** — Rechazada: el footgun reaparecería en el próximo boolean del package; el helper con tests es la barrera real.
- **B. Mover /certificates a chain estándar sin short-circuit (separar /verify a otro mount)** — Rechazada: cambia la URL pública documentada del verificador (contrato externo del certificado).

## 9. Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Algún entorno dependía del bug (REDIS_TLS=false con TLS activo) | L | M | Solo prod usa TLS y lo setea `true` explícito vía TF; dev no setea la var (default false antes y después) |
| demoExpires rompe el path público /verify | L | M | Short-circuit idéntico al de firebaseAuth + test del verify sin auth |

## 10. Test list

- T1: redisEnvSchema con REDIS_TLS="false" → false; "0" → false; "true" → true; ausente → false.
- T2: booleanFlag exportado se comporta igual que el helper de apps/api (tabla de casos).
- T3: GET /certificates/:tracking/verify sigue público (sin auth, sin demo middleware aplicado).
- T4: sesión demo expirada en /certificates → respuesta del demoExpiresMiddleware (mismo contrato que otros mounts).

## 11. Rollout

- Flag: no. Migración: no. Rollback: revert.
- Monitoring: ninguno extra (comportamiento defensivo).

## 12. Open questions

None as of 2026-06-11.

## 13. Decision log

- 2026-06-11 — Draft + mandato del PO "resolver todo lo detectado". Bundle deliberado de 2 gaps menores relacionados (configuración/middleware) para no fragmentar PRs.
