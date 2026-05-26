# Rate-limit cascade — `/auth/driver-activate` + `/api/v1/signup-request`

> T10 SEC-001 (`.specs/sec-001-cierre/plan.md`) · 2026-05-25
> T9b SEC-001 Sprint 2b (`.specs/sec-001-cierre/plan-sprint-2b.md`) · 2026-05-26
> SC-1.2.5 + SC-H2.1, SC-H2.1b, SC-H2.1c, SC-H2.2, SC-H2.4

Defensa en capas para los endpoints públicos sin auth previa. Cada capa filtra una clase distinta de abuso; juntas componen la postura de seguridad. Dos endpoints comparten arquitectura cascade pero con counters Redis disjuntos:

- `POST /auth/driver-activate` — activación PIN del conductor (cascade original T10 Sprint 2a).
- `POST /api/v1/signup-request` — solicitud signup admin-approval (cascade T8+T9b Sprint 2b, ver §signup-request layer).

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

## Referencias — `/auth/driver-activate`

- Spec: `.specs/sec-001-cierre/spec.md` §3 H2 + §SC-1.2.5.
- Plan: `.specs/sec-001-cierre/plan.md` T9 + T10.
- T9 commit: `9d1b2e5` (per-RUT base + wire en auth-driver).
- T1 evidence (Redis HA): `.specs/sec-001-cierre/sprint-1-evidence/t1-redis-state.md`.
- Cloud Armor config: `infrastructure/security.tf`.
- Middleware: `apps/api/src/middleware/rate-limit-pin.ts`.
- Tests: `apps/api/src/middleware/rate-limit-pin.test.ts`.

---

## signup-request layer (Sprint 2b T8 + T9b)

> SEC-001 Sprint 2b H1.2 (`.specs/sec-001-cierre/plan-sprint-2b.md` T8 entrega
> el middleware; T9b entrega los fail-closed + cascade integration tests).
> SC-1.2.5 completion (fail-closed Redis + cascade documentation).

Cascade para el endpoint público `POST /api/v1/signup-request` (signup admin-approval gate per [ADR-052](../adr/052-signup-migration-admin-sdk-gate.md)). Comparte estructura con `/auth/driver-activate` pero con scope distinto y counter Redis disjunto.

### Capas (orden de evaluación)

```
1. Cloud Armor (LB nivel)        — 1000 req/min/IP    [pre-filter, compartido]
2. Redis IP-based (middleware)   — 5 req/15min/IP     [SC-1.2.5]
3. zValidator (handler)           — email + nombreCompleto schema
4. Service signup-request        — email enumeration defense (shadow path)
```

Diferencias clave vs `/auth/driver-activate`:

| Aspecto | `/auth/driver-activate` | `/api/v1/signup-request` |
|---|---|---|
| Scope rate-limit | per-RUT (5) + per-IP (30) | solo per-IP (5) |
| Trust source | RUT en body + IP | IP solamente |
| Counter Redis key | `rl:pin-activate:<rut>` + `rl:pin-activate:ip:<ip>` | `rl:signup-request:<ip>` |
| Window | 900s (15min) | 900s (15min) |
| Justificación scope | RUT-based defense contra brute-force PIN específico + IP-based contra rotation | Email no es trust source (atacante rota emails @gmail.com); IP es la única señal estable pre-auth |

### Capa 1 — Cloud Armor WAF

Idéntica a `/auth/driver-activate`. Ver §"Capa 1 — Cloud Armor WAF" arriba. La policy del LB cubre todos los paths `*.boosterchile.com` indistintamente.

### Capa 2 — Redis IP-based (T8)

- **Ubicación**: `apps/api/src/middleware/rate-limit-signup.ts` `createRateLimitSignupMiddleware`.
- **Key**: `rl:signup-request:<x-forwarded-for[0]>`.
- **Política**: 5 req/15min/IP. Window fija (`EXPIRE NX`).
- **Acción**: response `429 too_many_attempts` + `Retry-After: 900` + `X-RateLimit-Scope: ip`.
- **Body parsing**: el middleware NO inspecciona body. Cualquier POST al path cuenta como intento — un attacker no puede evadir incrementando con bodies basura porque siempre incrementa. Distinto a `rate-limit-pin` que skipea si el body no parsea (allí el RUT-based counter requiere conocer el RUT primero).
- **Trust del X-Forwarded-For**: mismo trust model que `rate-limit-pin`. Sin LB delante (dev) cae a bucket `unknown`. En prod Cloud Armor (Capa 1) filtra spoofing.

### Capa 3 — zValidator handler

- **Ubicación**: `apps/api/src/routes/signup-request.ts` `zValidator('json', signupRequestBodySchema)`.
- **Política**: `email` Zod email() max 320; `nombreCompleto` min 1 max 200.
- **Acción**: 400 `bad_request` si body inválido. **Counter side-effect**: el counter Redis YA incrementó en Capa 2 (el counter cuenta intentos al path, no INSERTs exitosos). Trade-off aceptable: attacker que envía body inválido infinitamente desde una IP llega al 429 con su propio counter.

### Capa 4 — Service (email enumeration defense)

- **Ubicación**: `apps/api/src/services/signup-request.ts` `submitSignupRequest`.
- **Política**: SELECT users WHERE email=$lower → si exists, log structured `outcome=shadowed` + return sin INSERT. Si no exists, INSERT solicitudes_registro estado=pendiente_aprobacion.
- **Acción al caller**: response **idéntico** 202 `{ok:true}` en ambos cases (submitted vs shadowed). Anti-enumeration estructural — sin canal lateral de timing ni status code.
- **Cuando dispara shadow**: user real intentando re-signup, o attacker probando emails. El log structured permite a Booster medir la rate sin filtrar al exterior.

### Casos cubiertos

#### Caso A — flood signup desde una IP

- Requests 1-5: emails distintos (`a@x.cl, b@x.cl, ...`). Counter IP 1→5. Cada uno → 202 + INSERT (asumiendo no shadowed).
- Request 6: Counter IP 6 > 5. **Middleware retorna 429 + scope=ip**. Handler NO ejecuta — NO row insertado.
- IP queda bloqueada 15min para `/api/v1/signup-request`. Otros endpoints siguen accesibles.
- Cubierto por integration test T9a scenario 3 + T9b scenario verifies NO row inserted al 6º.

#### Caso B — Redis down durante signup attempt (SC-1.2.5)

- Pipeline INCR/EXPIRE arroja (`ECONNREFUSED`, timeout, etc.).
- **Middleware fail-closed loudly**: response `503 service_unavailable` + `Retry-After: 30`. logger.error con el err.
- Handler NO ejecuta — **rate-limit es defensa de seguridad, no degradable a fail-open** (paridad SC-H2.1b ↔ SC-1.2.5).
- Cubierto por T9b integration test scenario 1 (testcontainers up→stop→503).

#### Caso C — Cloud Armor banea ANTES de signup

- Attacker pasa 1000 req/min desde una IP → Cloud Armor THROTTLE al LB.
- Request 1001 NUNCA llega al Cloud Run. Counter Redis signup-request no incrementa (mismo behavior que driver-activate).
- El middleware app NO inspecciona headers Cloud Armor — la cascade Cloud Armor está fuera del app, en el LB. Cualquier header sintético inyectado por un cliente (e.g., `X-Cloud-Armor-Banned: true`) NO es interpretado por el middleware; el counter Redis incrementa normalmente.
- Cubierto por T9b integration test scenario 2 (header sintético pasa through sin interpretation).

#### Caso D — email enumeration attempt

- Attacker prueba emails para descubrir users registrados.
- Each request → counter Redis incrementa per-IP. Si email YA está en users → `outcome=shadowed` (NO row inserted) + response 202 idéntico.
- Attacker NO puede distinguir submitted vs shadowed por status/latency. Cubierto por T9a integration test scenario 2.

### Configuración / fixing

| Param | Default | Override |
|---|---|---|
| `limitPerIp` (signup) | 5 | factory arg en `server.ts` (`createRateLimitSignupMiddleware`) |
| `windowSeconds` (signup) | 900 | factory arg |
| Cloud Armor req/min/IP | 1000 | `infrastructure/security.tf` (compartido) |

### Observabilidad

- **Logs**: `logger.warn` con `{ip, ipCount, ipLimit, windowSeconds}` en cada 429. `logger.error` con `{err, ip}` en 503 fail-closed.
- **Métrica futura** (no incluida T8/T9b): contador Prometheus `rate_limit_signup_blocked_total` para alertas SRE. Tracked como follow-up junto con `rate_limit_pin_blocked_total`.

### Tests

- Unit: `apps/api/src/middleware/rate-limit-signup.test.ts` — 6 tests cubriendo happy / 6º 429 / Redis throw → 503 / IPs independientes / sin XFF / multi-hop XFF.
- Integration happy + enumeration + rate-limit: `apps/api/test/integration/signup-request.integration.test.ts` (T9a, 3 cases).
- Integration fail-closed + cloud-armor cascade docs: `apps/api/test/integration/signup-request-fail-closed.integration.test.ts` (T9b, 2 cases).

### Cómo escalar

| Si | Bumpear |
|---|---|
| Booster lanza campaña marketing con signup wave esperado | `limitPerIp` a 20-50 durante el evento + revert post-evento |
| Empresas onboarding masivo (10+ users por empresa desde mismo NAT) | `limitPerIp` a 30 (paridad driver-activate) + considerar burst window 60s sub-counter |
| Redis flapping crónico | investigar Memorystore HA, NO relajar 503 fail-closed (defensa estructural SC-1.2.5) |

### Referencias

- Spec: `.specs/sec-001-cierre/spec.md` §3 H1.2 + §SC-1.2.5.
- Plan: `.specs/sec-001-cierre/plan-sprint-2b.md` T8 + T9b.
- ADR: `docs/adr/052-signup-migration-admin-sdk-gate.md` (Proposed, Status flip Accepted en T13).
- Audit inventory: `docs/qa/signup-paths-audit.md` (T6).
- Middleware: `apps/api/src/middleware/rate-limit-signup.ts`.
- Route: `apps/api/src/routes/signup-request.ts`.
- Service: `apps/api/src/services/signup-request.ts`.
