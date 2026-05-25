# Rate-limit cascade — `/auth/driver-activate`

> T10 SEC-001 (`.specs/sec-001-cierre/plan.md`) · 2026-05-25
> SC-1.2.5 + SC-H2.1, SC-H2.1b, SC-H2.1c, SC-H2.2, SC-H2.4

Defensa en capas para el endpoint público `POST /auth/driver-activate`. Cada capa filtra una clase distinta de abuso; juntas componen la postura de seguridad.

## Capas (orden de evaluación)

```
1. Cloud Armor (LB nivel)        — 1000 req/min/IP    [pre-filter]
2. Redis IP-based (middleware)   — 30 req/15min/IP    [SC-H2.4]
3. Redis RUT-based (middleware)  — 5 req/15min/RUT    [SC-H2.1, SC-H2.1c]
4. zValidator (handler)           — schema RUT + PIN   [pre-existing]
5. Handler (auth-driver.ts)       — 401 si RUT/PIN no matchean
```

### Capa 1 — Cloud Armor WAF

- **Ubicación**: `infrastructure/security.tf` `google_compute_security_policy.waf` adaptive throttle.
- **Política**: 1000 req/min/IP por defecto sobre el LB global de Booster (\*.boosterchile.com).
- **Acción**: throttle de la IP (RPC `THROTTLE` con ban window definido por Cloud Armor).
- **Cuando dispara**: antes de que el request llegue al runtime Cloud Run.
- **Cuando NO dispara**: tráfico interno Cloud Run-to-Cloud Run (no pasa por el LB).

### Capa 2 — Redis IP-based (T10)

- **Ubicación**: `apps/api/src/middleware/rate-limit-pin.ts` `createRateLimitPinMiddleware`.
- **Key**: `rl:pin-activate:ip:<x-forwarded-for[0]>`.
- **Política**: 30 req/15min/IP. Window fija (`EXPIRE NX`).
- **Acción**: response `429 too_many_attempts` + `Retry-After: 900` + `X-RateLimit-Scope: ip`.
- **Cuando dispara**: attacker rota RUTs distintos desde la misma IP para evitar el límite per-RUT (Capa 3).
- **Trust del X-Forwarded-For**: en prod el LB lo setea con el client IP real (`global_compute_target_https_proxy` lo agrega antes de rutear al backend Cloud Run). Sin LB delante (dev local) el header puede ser ausente — el middleware cae a `unknown` (bucket único compartido). Cualquier consumidor que envíe el header sin pasar por el LB debe ser tratado como untrusted; Cloud Armor en Capa 1 es la defensa primaria contra spoofing.

### Capa 3 — Redis RUT-based (T9)

- **Ubicación**: idem (mismo middleware).
- **Key**: `rl:pin-activate:<rutCanonical>` (normalizado via `rutSchema.safeParse`).
- **Política**: 5 req/15min/RUT. Window fija.
- **Acción**: response `429 too_many_attempts` + `Retry-After: 900` + `X-RateLimit-Scope: rut`.
- **Cuando dispara**: brute-force contra un RUT específico (probar 6+ PINs).

### Capa 4 — zValidator (existente)

- **Ubicación**: `apps/api/src/routes/auth-driver.ts` `zValidator('json', activateBodySchema)`.
- **Política**: `rut` string ≥1, `pin` regex `^\d{6}$`.
- **Acción**: 400 `bad_request` si el body no matchea.
- **Counter side-effect**: ninguno — la Capa 3 ya filtró antes con el mismo `rutSchema` validation, así que cualquier 400 acá es por `pin` malformado únicamente.

### Capa 5 — Handler

- **Ubicación**: `auth-driver.ts` post handler.
- **Política**: lookup user por RUT + verify PIN con `verifyActivationPin` (scrypt timing-safe).
- **Acción**: 401 `invalid_credentials` si RUT no existe O PIN no matchea (response idéntico — no oracle de RUTs existentes).

## Casos cubiertos

### Caso A — brute-force PIN contra un RUT específico

- Request 1-5: PIN incorrecto. Counter RUT 1→5. Handler retorna 401. Counter IP 1→5.
- Request 6: Counter RUT incrementa a 6 > 5. **Middleware retorna 429 + scope=rut**. Handler NO se ejecuta — counter no se "infla" más por este RUT.
- Request 7+ desde otra IP, mismo RUT: igual 429 (key compartida por RUT).

### Caso B — attacker rota RUTs (SC-H2.4)

- Requests 1-30: 30 RUTs distintos, mismo IP. Counter RUT por cada uno = 1 (no excede). Counter IP escala 1→30.
- Request 31: Counter IP excede 30. **Middleware retorna 429 + scope=ip**. Handler NO ejecuta.
- IP queda bloqueada 15min para `/auth/driver-activate`. Otros endpoints siguen accesibles.

### Caso C — Redis down (SC-H2.1b)

- Pipeline INCR/EXPIRE arroja (`ECONNREFUSED`, timeout, etc.).
- **Middleware fail-closed loudly**: response `503 service_unavailable` + `Retry-After: 30`. logger.error con el err.
- Handler NO ejecuta — **rate-limit es defensa de seguridad, no degradable a fail-open**.
- Cloud Armor (Capa 1) sigue activo: si attacker explota el window de Redis down, sigue bloqueado por throttle global del LB.
- Mitigación operacional: Memorystore HA (STANDARD_HA tier verificado T1) hace failover automático cross-zone en < 30s. El 503 dura sólo durante el failover, no es una caída de larga duración.

### Caso D — Cloud Armor banea ANTES de Redis

- Attacker pasa 1000 req/min desde una IP → Cloud Armor THROTTLE.
- Request 1001 nunca llega al Cloud Run. Counter Redis no incrementa.
- Cuando el attacker espera y vuelve: comienza nuevamente con counter Redis "limpio" si pasó 15min desde el último intento que SÍ llegó al runtime.

### Caso E — request interno bot → api (sin LB)

- Bypass de Capa 1 (Cloud Armor). Cliente OIDC autenticado.
- El bot NO llama `/auth/driver-activate` — ese endpoint es PWA-only. Si en el futuro un caller interno lo necesitara, debería pasar por una surface dedicada con auth previa.

## Configuración / fixing

| Param | Default | Override |
|---|---|---|
| `limitPerRut` | 5 | factory arg en `server.ts` |
| `limitPerIp` | 30 | factory arg en `server.ts` |
| `windowSeconds` | 900 | factory arg |
| Cloud Armor req/min/IP | 1000 | `infrastructure/security.tf` |

Para flipear runtime: tuning en `server.ts` + redeploy. Hay un futuro flag `RATE_LIMIT_PIN_DISABLED` que puede agregarse si se necesita bypass de emergencia — por defecto no existe, el middleware siempre está ON cuando wireado.

## Observabilidad

- **Logs**: `logger.warn` con `{rutNormalizado, ip, scope, count, limit}` en cada 429. `logger.error` con `{err}` en 503 fail-closed.
- **Métrica futura** (no incluida T10): contador Prometheus `rate_limit_pin_blocked_total{scope}` para alertas SRE. Tracked como follow-up.

## Tests

- Unit: `apps/api/src/middleware/rate-limit-pin.test.ts` — 10 tests cubriendo:
  - 1er/5º intento OK
  - 6º → 429 scope=rut
  - 31º (rotando RUTs desde misma IP) → 429 scope=ip
  - Redis throw → 503 + Retry-After:30
  - IP scope prevalece cuando ambos exceden
  - RUT normalize colapsa formatos válidos
  - body sin RUT / no-JSON / RUT inválido → skip

- Integration: hot path cubierto por `apps/api/test/integration/migrations.integration.test.ts` + smoke E2E manual post-deploy (curl con `Authorization` ausente y 6 RUTs distintos).

## Cómo escalar

| Si | Bumpear |
|---|---|
| Usuario legítimo retry-en-loop por bug UI | client-side throttle (no servidor) |
| Cliente desktop con NAT compartida (muchos drivers → mismo IP) | `limitPerIp` a 60 o 100; trade-off contra protección de rotación |
| Activations masivas en evento (onboarding 100 conductores) | bumpar window a 1800s durante el evento + revert post-evento |
| Redis flapping crónico | investigar Memorystore HA + cuotas, no relajar `503` fail-closed |

## Referencias

- Spec: `.specs/sec-001-cierre/spec.md` §3 H2 + §SC-1.2.5.
- Plan: `.specs/sec-001-cierre/plan.md` T9 + T10.
- T9 commit: `9d1b2e5` (per-RUT base + wire en auth-driver).
- T1 evidence (Redis HA): `.specs/sec-001-cierre/sprint-1-evidence/t1-redis-state.md`.
- Cloud Armor config: `infrastructure/security.tf`.
- Middleware: `apps/api/src/middleware/rate-limit-pin.ts`.
- Tests: `apps/api/src/middleware/rate-limit-pin.test.ts`.
