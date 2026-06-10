# Follow-up: XFF trust boundary en rate-limit-signup y demo-cache-warm + reset-on-success

**Origen**: REVIEW de `sec-rate-limit-login-rut` (security-auditor ALTO), 2026-06-10.
**Prioridad**: P1 (signup es endpoint anónimo en prod).

## Problema

1. `rate-limit-pin.ts` ya toma la PENÚLTIMA entry del `X-Forwarded-For` (la IP que vio el GCLB; la primera es 100% controlada por el cliente). Pero `apps/api/src/middleware/rate-limit-signup.ts:~81` y `apps/api/src/routes/demo-cache-warm.ts:~59` siguen tomando `[0]` — el counter per-IP de signup-request es anulable rotando XFF falsos.
2. Los counters per-RUT del login universal incrementan también en logins EXITOSOS: >5 logins legítimos/15min = lockout, y cualquiera que conozca un RUT puede bloquear a la víctima con 5 requests basura (DoS dirigido).

## Acción propuesta

- Extraer `extractClientIp` (versión penúltima-entry) a un util compartido (`apps/api/src/middleware/client-ip.ts`) y usarlo en los 3 sitios; tests del caso spoofeado en cada uno.
- Evaluar reset-on-success para el counter per-RUT del login (DEL en login exitoso) o contar solo intentos fallidos (mover el INCR post-handler con status 401).

## Estado

Pendiente. Sin asignar a ciclo.
