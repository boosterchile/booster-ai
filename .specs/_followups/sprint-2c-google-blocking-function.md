# Followup: SEC-001 Sprint 2c — Google sign-in Blocking Function (deferred from Sprint 2b)

**Status**: Draft (stub, no ejecutar todavía)
**Created**: 2026-05-26
**Triggered by**: Spec `.specs/sec-001-cierre/spec.md` v3.4 amendment A3 (2026-05-25) — SC-1.2.2 Google leg = `TRACKED_RESIDUAL`
**Estimated effort**: ~3-5 días (Cloud Function nueva + ADR propio + integration tests + deploy IaC)

---

## Contexto

Sprint 2b H1.2 cierra SC-1.2.2 **solo para el leg email/password** (Identity Platform self-signup OFF vía Terraform). El leg Google se quedó como residual conocido. Razones técnicas verificadas el 2026-05-25:

- `apps/web/src/hooks/use-auth.ts:84-87` invoca `signInWithPopup(firebaseAuth, googleProvider)` 100 % client-side. **No existe** ruta backend tipo `auth-google-callback.ts` ni handler de OAuth en `apps/api/src/routes/`.
- Identity Platform GA **no expone** toggle per-provider equivalente a "Allow new accounts to sign up = OFF" para Google. La doc oficial sólo provee el flag para email/password. Configuración manual desde consola tampoco lo expone.
- Sin un gate adicional, `signInWithPopup` con cuenta Google nueva crea un user en Identity Platform en el primer login, antes de que cualquier middleware backend pueda inspeccionar el estado de `solicitudes_registro`.

**Riesgo residual aceptado** (documentado en spec §3 SC-1.2.2 amendment A3): Google self-signup queda OPEN entre Sprint 2b ship y Sprint 2c ship. No es exploitable end-to-end sin un role-assignment posterior (los roles `shipper / carrier / driver / stakeholder` se asignan via `users` table + memberships en backend, no vía claim de Identity Platform). Atacante con cuenta Google nueva podría crear un Firebase User pero quedaría sin role → bloqueado downstream por checks de membership en cada endpoint.

## Trigger (cuándo ejecutar)

Iniciar esta migración cuando ocurra cualquiera de:

- Sprint 2b H1.2 PR2 mergeado a `main` (ADR-052 Accepted post-canary success).
- PO marque la mitigación del residual Google como prioridad explícita.
- Se descubra evidencia de explotación del residual en monitoring (`R-DA-GOOGLE-OPEN` en spec §9; alerta sobre Identity Platform audit log con sign-up Google sin matching `solicitudes_registro.estado=aprobado`).

## Inputs requeridos

- Spec `.specs/sec-001-cierre/spec.md` §3 SC-1.2.2 (Google leg) + §13 amendment A3 decision log.
- ADR-052 `docs/adr/052-signup-migration-admin-sdk-gate.md` (status `Accepted` esperado al iniciar Sprint 2c) — contiene la decisión email/password leg sobre la que Sprint 2c construye el equivalente Google.
- ADR-049 `docs/adr/049-claude-code-plugin-system-adoption.md` — convenciones plugin system.
- Documentación Firebase Auth Blocking Functions: `beforeCreate` y `beforeSignIn` hooks ([Firebase docs](https://firebase.google.com/docs/auth/extend-with-blocking-functions)).
- Inventario `docs/qa/signup-paths-audit.md` (entrega T6 Sprint 2b) — sección Google provider.
- `infrastructure/identity-platform.tf` (entrega T11 Sprint 2b) — Terraform base sobre la que se monta el provider Blocking Function trigger.

## Solution sketch

### Decisión propuesta (a validar en /spec dedicado Sprint 2c)

**Firebase Auth Blocking Function `beforeCreate`** desplegada como Cloud Function (Gen 2, TypeScript, runtime Node.js 20+) en project `booster-ai-494222`. El hook se dispara antes de que Firebase Auth persista el `User` y permite rechazar la creación.

Pseudocode esperado del handler:

```ts
import { beforeUserCreated, HttpsError } from 'firebase-functions/v2/identity';
import { getDb } from './db'; // Cloud SQL connector or Firestore lookup

export const enforceSignupApproval = beforeUserCreated(async (event) => {
  const email = event.data.email;
  const provider = event.data.providerData?.[0]?.providerId;

  // Allow service-minted sign-ins (server-side Admin SDK createUser bypass este hook).
  // Solo aplica a self-signups via Identity Platform providers (google.com, password si hubiese).
  if (provider !== 'google.com') {
    return; // email/password ya esta OFF via Terraform Sprint 2b T11; defensa en profundidad.
  }

  const approved = await getDb().query(
    'SELECT 1 FROM solicitudes_registro WHERE email = $1 AND estado = $2 LIMIT 1',
    [email, 'aprobado'],
  );

  if (!approved.length) {
    throw new HttpsError('permission-denied', 'signup-not-approved');
  }
});
```

### Componentes a entregar (esbozados)

1. **Spec dedicada Sprint 2c**: `.specs/sec-001-h1-2-google-blocking/spec.md` con SC's claros — happy path (Google login con aprobado pre-existente OK), negative (Google login sin aprobado → `auth/internal-error` propagado desde Blocking Function), integration test contra emulador Firebase.
2. **ADR-NNN nuevo** (numbering al momento de empezar Sprint 2c, no reservar ahora — ver CLAUDE.md "ADR before code"): documenta decisión Blocking Function vs alternativas (custom claims-only, server-side OAuth callback, eliminar Google provider del todo).
3. **Apps nueva**: `apps/auth-blocking-functions/` (Cloud Function separada del API monolito por restricciones de runtime y latencia — la Blocking Function tiene SLA estricto de Firebase: <7s o el sign-in falla). Decisión final sobre apps vs colocar en `apps/api` se evaluará en /plan.
4. **IaC**: extender `infrastructure/identity-platform.tf` con `google_identity_platform_config.blocking_functions.before_create_function` apuntando al endpoint de la Cloud Function. Mantener Sprint 2b ignore_changes scoping.
5. **Tests**: integration test Firebase emulator + Cloud Function emulator; e2e mock sobre Identity Platform UI signup flow.
6. **Observabilidad**: structured logs `signup.blocked.google` + métrica counter; alerta Cloud Monitoring 3-sigma anomaly si rate de blocked sign-ups sube (señal de attack o de bug post-deploy).

### Alternatives consideradas (preliminares — refinar en /spec Sprint 2c)

- **A. Eliminar Google provider del todo (`signInWithPopup` removido del web app)**. Costo UX: shippers/carriers con cuenta Google tienen que crear cuenta email/password manual. Decisión de producto.
- **B. Custom claims-only enforcement (downstream check, no Blocking Function)**. Rechazo: deja el user Firebase creado aunque sin role → bloat de Identity Platform tenant + audit log noise; no resuelve el problema estructural.
- **C. Reverse-proxy OAuth callback (interceptar Google OAuth flow antes de que llegue a Firebase)**. Rechazo preliminar: alto costo de mantención, fuera de patrones Firebase Auth idiomáticos.

## Riesgos y mitigaciones (esbozo)

- **R-2C-1: SLA Blocking Function 7s**: si la query a `solicitudes_registro` tarda demasiado (cold-start Cloud Run de DB pool), el sign-in falla con error opaco. Mitigation: connection pool warm + timeout interno con fail-closed explícito + structured log para diagnose.
- **R-2C-2: Cold-start Cloud Function**: cada Blocking Function invocation puede sufrir cold-start ~1-2s. Mitigation: min instances ≥ 1 en config Cloud Run.
- **R-2C-3: Cost surface**: cada login Google invoca la Blocking Function. Si Booster escala a 10k users activos/mes, invocaciones ~50k/mes. Costo estimado: <$5/mes en Cloud Functions Gen 2. Mitigation: monitorear y revisar.
- **R-2C-4: Loop con Sprint 2c reaper cron**: si futuro cron limpia `solicitudes_registro` con `estado=aprobado` después de un tiempo, ese user existente no podrá volver a hacer sign-in con Google. Decisión: cron solo borra `rechazado` rows, no `aprobado`. Validar en /spec Sprint 2c.

## Decisión de cierre del residual (cuándo se considera resuelto)

Sprint 2c ship + 2h watch sin alertas + 7 días en prod sin matches en `signup.blocked.google` que indiquen attacker probing → spec §3 SC-1.2.2 Google leg pasa de `TRACKED_RESIDUAL` a `MET`. Update `.specs/sec-001-cierre/spec.md` decision log con cierre.

## Tracking

- Link desde `docs/handoff/CURRENT.md` (sección "deuda activa SEC-001" post-Sprint-2b ship).
- Link desde `.specs/sec-001-cierre/spec.md` §3 SC-1.2.2.
- Link desde `docs/adr/052-signup-migration-admin-sdk-gate.md` (Consequences §Negativas + §Riesgo residual).

## Notas operacionales

- No iniciar Sprint 2c hasta que ADR-052 esté en `Accepted` (post-T13 canary success + 2h watch). Sin esto, el patrón email/password no está estabilizado en prod y agregar Google leg expande risk surface sin reducirlo.
- Si durante el monitoring de 7 días post-Sprint-2b se detecta exploitation activa del residual Google → escalation a Sprint 2c emergency (sin cooling-off normal).
