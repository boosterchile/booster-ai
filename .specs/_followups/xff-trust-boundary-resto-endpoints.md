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

✅ **RESUELTO (2026-06-22)**.

- **Parte 1 (XFF trust boundary)** — ya estaba hecha en `main`: `extractClientIp`
  (penúltima entry) vive en `apps/api/src/middleware/client-ip.ts` y es la fuente
  única en los 3 sitios + 5 más (`rate-limit-signup.ts:50`, `demo-cache-warm.ts:65`,
  `rate-limit-pin`, `rate-limit-public-tracking`, `rate-limit-transport-documents`,
  `me-consents`, `me`). Verificado: 0 lecturas de `xff[0]` fuera del util.
- **Parte 2 (counter per-RUT)** — esta PR: **reset-on-success** en
  `rate-limit-pin.ts` (DEL del `rutKey` cuando el handler responde 2xx). Un login
  legítimo ya no cuenta para el lockout; el per-IP NO se resetea; fallo=401 → el
  counter persiste (mantiene anti-brute-force). TDD: 4 casos nuevos (éxito→DEL,
  401→no, 429→no, DEL-falla→best-effort).

**Residual aceptado (inherente)**: el DoS dirigido con requests **fallidos**
(alguien con un RUT conocido manda 5 fallidos y bloquea a la víctima 15min) no se
elimina con reset-on-success ni con "contar-solo-fallidos" — es inherente a
cualquier rate-limit per-RUT. Mitigado por el counter per-IP (30/15min) + Cloud
Armor (1000/min/IP). Eliminarlo del todo exigiría quitar el límite per-RUT, lo que
debilitaría la protección anti-brute-force del PIN/clave. Se documenta como deuda
conscientemente no tomada.
