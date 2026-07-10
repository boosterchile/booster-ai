# Impersonación auditada — backend (parte 2)

**Estado:** implementado, PR abierto (no mergeado — merge = PO, auth sensible).
**Feature flag:** `IMPERSONATION_V1_ACTIVATED` (default `false`, opt-in del PO en Terraform).
**Precede:** parte 1 (recon de auth, read-only) validó las 4 decisiones selladas y encontró que el modo demo ya mintea custom token con claim (patrón a extender).

## Objetivo

Que un platform-admin pueda actuar como cualquier usuario **no-admin**, con
**escritura acotada a empresas `es_demo`** y **auditoría completa** de quién
impersonó a quién y cuándo. Solo backend; el frontend (banner + picker + salir)
es un goal aparte.

## Decisiones SELLADAS con el PO (no reabrir)

1. **Escritura solo en empresas `es_demo`.** Empresa real + sesión impersonada +
   método mutante → 403. Lecturas sobre cualquier empresa del target.
2. **Solo platform-admin impersona, solo a target NO-admin** (sin admin→admin).
3. **Auditoría:** tabla `eventos_impersonacion`; `impersonated_by` viaja en la
   sesión; toda mutación atribuible al admin.
4. **El endpoint de mint es el trust boundary:** airtight (requirePlatformAdmin +
   target-no-admin + rate-limit + audit + token corto).
5. **Diseño de sesión:** el token se mintea sobre el UID del **target** (la sesión
   ES el target, con SUS empresas → validación X-Empresa-Id normal, sin huecos);
   `impersonated_by` va como claim aparte para guard/auditoría/banner.

## Contrato

### Emisión — `POST /auth/impersonate`
- Body: `{ target_user_id: uuid }`.
- Guards en orden: `requirePlatformAdmin` (featureFlag + auth + allowlist
  `BOOSTER_PLATFORM_ADMIN_EMAILS`) → lookup target → `evaluateImpersonationTarget`
  (pura) → `createCustomToken(targetFirebaseUid, { impersonated_by, impersonated_at })`
  → INSERT en `eventos_impersonacion`.
- Rate-limit: `createRateLimitImpersonateMiddleware` (per-admin-uid, 10/60s,
  fail-closed 503).
- Respuestas: 200 `{ custom_token, target_user_id, impersonated_at }`; 400
  invalid_request | cannot_impersonate_self; 401 unauthorized; 403
  forbidden_platform_admin | forbidden_impersonate_admin; 404 target_not_found;
  409 target_not_activated; 502 firebase_error (sin fila de auditoría); 503
  feature_disabled.

### Guard de escritura — `impersonation-write-guard`
- Middleware method-based (espejo de `is-demo-enforcement`). Si el claim
  `impersonated_by` está presente y el método es mutante y la empresa activa NO
  es `es_demo` (o no hay userContext resoluble) → 403
  `forbidden_impersonation_write`. **Fail-closed.** Lecturas passthrough.
- Emite log estructurado en cada mutación impersonada: `auth.impersonation.
  write_blocked` (bloqueada) / `auth.impersonation.write_allowed` (permitida
  sobre demo) — con `impersonated_by` → atribución.
- **Cobertura sin gaps:** cableado per-group DESPUÉS de userContext en todos los
  mount points auth-required. Garantizado por `check-impersonation-wire-
  completeness.ts` + su test vitest contra el `server.ts` real.

### Propagación
- `UserContext.impersonatedBy` leído de `claims.custom.impersonated_by` en el
  userContextMiddleware. El claim solo RESTRINGE (nunca otorga) → seguro.

### Auditoría — tabla `eventos_impersonacion` (migración 0049)
- `admin_id` (FK usuarios RESTRICT), `usuario_impersonado_id` (FK usuarios
  RESTRICT), `empresa_id` (FK empresas RESTRICT, nullable), `iniciado_en`,
  `finalizado_en` (nullable). Reverse manual en `drizzle/down/`.

## Criterios de éxito

Ver `verify.md` para la evidencia fresca (todos los criterios del goal cubiertos
con TDD: tests de seguridad escritos primero, vistos fallar, luego verdes).

## Notas para el PO (frontera / decisiones que exceden el backend)

### N1 — Token corto vs. persistencia del claim (threat-model)
Los custom claims de `createCustomToken` **no sobreviven al refresh del ID token**
(~1h): Firebase reconstruye el token del record del usuario, y `impersonated_by`
solo vive en el token minteado. El modo demo lo evita con `setCustomUserClaims`,
pero eso **contaminaría el record del usuario real** impersonado (su próximo login
llevaría el claim). El PO selló **"token corto"** → **no persistimos**.
Consecuencia: la impersonación caduca con el token; el ciclo entrar/salir/re-mint
lo define el goal de frontend. **No se abre hueco para sesiones normales** (nunca
llevan el claim); la frontera es solo la duración de la ventana impersonada. Si el
PO prefiere impersonación persistente (fail-closed cross-refresh) a costa de tocar
el record del target + un endpoint de "stop" que lo limpie, es una decisión de
threat-model a reabrir explícitamente — no la tomé por criterio propio.

### N2 — CI gate en security.yml (no wireado)
El gate `check-impersonation-wire-completeness.ts` está escrito y su invariante
corre en el job `test` estándar vía un test vitest (`test/impersonation-wire-
completeness.test.ts`) — así CI enforcea el gap-free **sin tocar workflows**.
Wirear además el script `tsx` en `security.yml` (junto a check-is-demo) es una
mejora opcional que toca un quality-gate de CI (archivo protegido, CLAUDE.md) →
la dejo para aprobación explícita del PO, no la apliqué unilateralmente.
