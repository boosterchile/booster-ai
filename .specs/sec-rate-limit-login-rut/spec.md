# Spec: sec-rate-limit-login-rut

- Author: Felipe Vicencio (with agent-rigor)
- Date: 2026-06-10
- Status: Approved
- Linked: Auditoría arquitectónica 2026-06-09, riesgo alto #3 (verificado independientemente); ADR-035

## 1. Objective

Proteger `POST /auth/login-rut` (RUT + clave numérica de 6 dígitos, espacio de 10^6) con el mismo rate-limit Redis fail-closed que ya protege `POST /auth/driver-activate`. Hoy el endpoint se monta sin rate-limit (apps/api/src/server.ts:723-726) y su única defensa es Cloud Armor (1000 req/min/IP) — que además tiene bypass total del preset OWASP para el host api.

## 2. Why now

ADR-035 Alt-3 justifica la clave de 6 dígitos explícitamente "para sistemas con face ID + rate limiting" — el rate limiting nunca se implementó para este endpoint. Brute-force por-RUT es viable hoy. Es auth de TODOS los roles (flow universal).

## 3. Success criteria

- [ ] `POST /auth/login-rut` rate-limitado: 5 intentos/15min por RUT + 30/15min por IP, counters Redis con prefijo propio (`rl:login-rut:`), sin contaminar los counters de driver-activate.
- [ ] Fail-closed: Redis caído → 503 (no fail-open silencioso), mismo contrato que rate-limit-pin (SC-H2.1b).
- [ ] El middleware es parámetro requerido de `createAuthUniversalRoutes` (imposible montar el route sin él).
- [ ] Tests del prefijo configurable y del wiring en auth-universal.

## 4. User-visible behaviour

Usuario legítimo: sin cambios (5 intentos/15min es holgado para un login). Atacante: 429 `too_many_attempts` con `Retry-After` y `X-RateLimit-Scope: rut|ip` tras exceder los límites.

## 5. Out of scope

- Lockout permanente por cuenta / captcha progresivo (escalamiento futuro si hay señal de abuso).
- Cambiar los límites de driver-activate.
- Rate-limit de otros endpoints de auth (demo/login ya tiene gates propios).

## 6. Constraints

1. Reusar `createRateLimitPinMiddleware` generalizando el prefijo de keys — no duplicar 160 líneas testeadas.
2. Backwards-compatible: sin opts nuevos, el middleware se comporta exactamente igual (driver-activate intacto).
3. Fail-closed obligatorio (regla de seguridad del repo).

## 7. Approach

Agregar `keyPrefix`/`ipKeyPrefix` opcionales a `RateLimitPinOptions` (defaults = constantes actuales). En `server.ts`, crear una segunda instancia con prefijos `rl:login-rut:`/`rl:login-rut:ip:` y pasarla a `createAuthUniversalRoutes` como opt **requerido** `rateLimitLogin`; el route la aplica con `app.use('/login-rut', ...)`. El middleware ya parsea `rut` del body con rutSchema (mismo boundary que loginRutSchema), por lo que funciona sin cambios para este endpoint.

## 8. Alternatives considered

- **A. Middleware nuevo copiado de rate-limit-pin** — Rechazada: duplica lógica de pipeline atómico, fail-closed y extracción de IP ya testeadas; drift garantizado.
- **B. Confiar en Cloud Armor** — Rechazada: 1000 req/min/IP permite ~21M intentos/15min distribuidos en 100 IPs; además el host api bypassea el preset OWASP (networking.tf:198-225) y el rate de Armor no es por-RUT.
- **C. Opt `rateLimitLogin` opcional (patrón driver-activate)** — Rechazada: opcional = posible olvido de wiring en el futuro; requerido hace imposible montar el endpoint sin defensa.

## 9. Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Falso positivo bloquea usuarios legítimos compartiendo IP (oficina) | L | M | Límite IP 30/15min es 6× el por-RUT; scope=rut protege el caso común |
| Redis caído bloquea TODO login universal (fail-closed) | L | H | Decisión deliberada del repo (SC-H2.1b); alerta de Redis ya existe; flag AUTH_UNIVERSAL permite fallback a email/password en el front |
| Counters de login comparten ventana con pin-activate | — | — | Eliminado por diseño: prefijos propios |

## 10. Test list

- T1: middleware con keyPrefix custom usa `rl:login-rut:<rut>` y `rl:login-rut:ip:<ip>` en Redis (no el prefijo pin-activate).
- T2: sexto intento con mismo RUT → 429 scope=rut.
- T3: Redis caído → 503 fail-closed.
- T4: `createAuthUniversalRoutes` aplica el middleware a /login-rut (request con middleware que retorna 429 → el handler no corre).
- T5: defaults sin opts nuevos = comportamiento actual (tests existentes de rate-limit-pin sin cambios).

## 11. Rollout

- Feature-flagged? No — control de seguridad; siempre activo.
- Migration needed? No.
- Rollback plan: revert del commit (vuelve al estado sin rate-limit; no peor que hoy).
- Monitoring: logs `rate-limit-pin: 429` existentes ahora incluyen el prefijo del endpoint; el dashboard de Redis ya monitorea la instancia.

## 12. Open questions

None as of 2026-06-10.

## 13. Decision log

- 2026-06-10 — Draft + aprobación del PO vía "ejecutar lo propuesto en el punto 6". Opt requerido (no opcional) por default-deny.
