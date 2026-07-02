# ADR-057 — Cierre del leg Google (SEC-001 H1.2) por boundary ADR-001 + reaper de higiene (supersede ADR-054 blocking function)

**Status**: Accepted
**Date**: 2026-06-04
**Decider**: Felipe Vicencio (Product Owner)
**Technical contributor**: Claude (agente de desarrollo)
**Supersedes**: [ADR-054 — Google federated signup admin-approval gate via Identity Platform Blocking Function](./054-google-blocking-function-signup-gate.md)
**Related**: [ADR-001 Stack/Auth Zero-Trust](./001-stack-selection.md) · [ADR-052 signup admin-approval (Admin SDK leg)](./052-signup-migration-admin-sdk-gate.md) · [ADR-053 post-disclosure account replacement](./053-post-disclosure-account-replacement.md) · spec [`.specs/sec-001-h1-2-google-boundary-closure/spec.md`](../../.specs/sec-001-h1-2-google-boundary-closure/spec.md) (v2, DA R2 APPROVE_WITH_RESERVATIONS) · lessons-learned [`docs/lessons-learned/2026-05-sprint-2c-gen1-vs-gen2.md`](../lessons-learned/2026-05-sprint-2c-gen1-vs-gen2.md) · residual [`.specs/sec-001-cierre/`](../../.specs/sec-001-cierre/) SC-1.2.2 · follow-up [`.specs/_followups/sprint-2c-google-blocking-function.md`](../../.specs/_followups/sprint-2c-google-blocking-function.md)

---

## Contexto

ADR-052 cerró el leg email/password del gate de signup (Admin SDK + `disabled_user_signup=true` en Identity Platform). Ese flag **no** bloquea el self-signup federado por Google (el OAuth-redirect no pasa por la knob de IdP). ADR-054 propuso cerrar ese residual (`SC-1.2.2 Google leg`) con una **Identity Platform Blocking Function** (`beforeCreate`, Cloud Function Gen 1 + `gcip-cloud-functions`).

Esa dirección quedó **abandonada** antes de llegar a producción, por dos razones empíricas:

1. **Gen 1 está deprecado.** Las blocking functions de Identity Platform solo soportaban Cloud Functions Gen 1 al momento de ADR-054 (verificado vía WebFetch, ver lessons-learned). La plataforma de ejecución elegida está en deprecación; construir sobre ella suma deuda de migración garantizada.
2. **Gen 2 no está verificado.** El path Gen 2 requiere un spike no realizado y, peor, su validación es **mutante de producción** (probar el trigger `beforeCreate` real implica tocar el flujo de creación de cuentas en vivo). No hay forma de verificarlo sin riesgo sobre el funnel de onboarding.

En paralelo, el vector de auto-promoción a platform-admin fue **cerrado por el hotfix** (self-serve onboarding OFF: `EMPRESA_SELF_ONBOARDING_ENABLED` default-false, unset en prod; auto-provision de platform-admin gateado por `BOOSTER_PLATFORM_ADMIN_EMAILS` default-vacío). La auditoría sistemática del boundary (SC-G1, `route-boundary-audit.md`) confirmó **cero GAP**: toda ruta de negocio/admin es `ENFORCED` (userContext) o `GATED-CLOSED` (gate in-handler por `firebase_uid`/allowlist/flag); ninguna sirve datos ni otorga privilegio a un token autenticado-pero-no-provisionado.

El residual real, entonces, no es "un usuario Google puede crear sesión" (eso es inocuo si el boundary niega), sino **higiene**: cuentas IdP Google inertes (sin fila `users`, sin solicitud pending/aprobada, añejas) acumuladas por el botón "Sign in with Google" vivo.

## Decisión

Cerrar el leg Google (SEC-001 H1.2) por la **Alternativa G** elegida por el PO: **consolidar la autorización en el boundary (ADR-001) + un reaper de higiene**, sin Cloud Function ni Gen 2.

1. **La autorización vive en el boundary, no en un gate de creación.** El invariante "ningún usuario autenticado-pero-no-provisionado obtiene datos o privilegio" se sostiene en el wiring de rutas (userContext / gate in-handler), no en bloquear la creación del Firebase user. Una cuenta Google sin fila `users` puede existir y autenticarse; el boundary la deja inerte.

2. **Harness CI default-deny hace durable el boundary (SC-G1b).** Un check de CI enumera **cada** mount (`app.use` + `app.route()` + `<router>.route()` sub-mounts) y asserta que cada uno esté clasificado: `userContext`-wired (`ENFORCED`) **o** en un allowlist explícito con rationale por entrada (`GATED-CLOSED`/`INTENTIONAL-OPEN`/`INTERNAL`/`MIXED`). **Falla el build** ante un mount nuevo sin clasificar. Reemplaza el backstop creation-time (la blocking function) por una **invariante de wiring durable**.

3. **Reaper de higiene fail-safe.** Un job programado remueve cuentas IdP inertes — **Google-only**, con email presente, sin fila `users` (dual-match uid+email contra la forma degradada guardada, lowercase+trim), no pending/aprobada, más añejas que `REAPER_GRACE_DAYS=30` (creationTime **y** lastSignInTime). Guardas: **dry-run default**, **disable-before-delete** (reversible), hard-guard de `users` por uid+email, `dev@boosterchile.com` nunca reapable, email hasheado en logs. El primer run destructivo está gateado por dry-run revisado + sign-off PO.

4. **Decomiso de los artefactos de la blocking function (SC-G7).** Se remueven/decomisan la Cloud Function, su monitoring y la wire `blocking_functions` (per-entorno, `terraform plan` limpio en dev/staging/prod, `state rm` vs `destroy` enumerado, IAM-reuse verificado) y se **archiva** `apps/auth-blocking-functions/` (no se borra: queda como referencia deny-pure del invariante).

## Consecuencias

### Positivas

- **Cero deuda Gen 1/Gen 2**: se elimina el path de Cloud Function deprecado y el spike no verificado mutante-de-prod.
- **Invariante durable y testeable**: el harness CI falla el build ante una ruta nueva sin clasificar — protege exactamente la clase de ruta del riesgo (sub-mounts `<router>.route()` fuera de userContext, p.ej. `/me/consents`), que el backstop creation-time no cubría.
- **Defense-in-depth real**: la autorización está en el boundary auditado (cero GAP) + el reaper como higiene, no en un único gate de creación que, de fallar, abría todo.
- **Reversibilidad**: `disable-before-delete` + dry-run default + gate de sign-off PO hacen que el reaper no destruya en su primer contacto.

### Negativas

- **Ventana de existencia de cuentas inertes**: entre la creación de una cuenta Google sin provisión y su reaping (≥30 días) la cuenta existe (autenticada pero sin acceso a datos por el boundary). Aceptado: el boundary la mantiene inerte; el reaper es higiene, no contención.
- **El reaper es Google-only por diseño**: si en el futuro se re-habilita otro self-signup auto-creador (hoy OFF), esa decisión debe revisitar el scope del reaper (documentado en `oq-resolution.md` OQ-G3).
- **Normalización degradada del match**: el reaper matchea la forma con que se guardó el email (lowercase+trim), no una forma canónica que el dato no tiene; el normalizador compartido + backfill se difieren a Stream B (OQ-G6=(b)).

### Neutrales

- **Botón "Sign in with Google" se mantiene vivo** (prioridad de negocio: UX de onboarding shipper). El reaper repuebla-inertes se asume como parte del estado estable.
- El residual `SC-1.2.2` transiciona `TRACKED_RESIDUAL → MET` cuando: self-serve OFF (verificado) + audit sin GAP (SC-G1) + harness activo (SC-G1b) + reaper desplegado (SC-G8).

## Alternativas consideradas

### Alt-A: Mantener la dirección blocking function (ADR-054) y migrar a Gen 2

**Rechazada**: requiere spike no verificado + validación mutante de prod; Gen 1 deprecado suma deuda inmediata. El boundary ya niega el acceso, haciendo el gate de creación redundante para la propiedad de seguridad real.

### Alt-B: Deshabilitar "Sign in with Google" por completo

**Rechazada** (consistente con ADR-054 Alt-I): rompe el funnel de onboarding; el botón Google es la UX preferida para shippers.

### Alt-C: Solo reaper, sin harness CI

**Rechazada**: el reaper es higiene reactiva; sin el harness default-deny, una ruta nueva mal-wireada reintroduce el vector silenciosamente. El harness es la invariante durable; el reaper la complementa.

## Notas para el yo-futuro

- **Cross-ref lessons-learned**: el patrón de verificación empírica Gen 1 vs Gen 2 (spike vía WebFetch antes de `/build` para evitar arquitectura sobre runtime deprecado) está en [`docs/lessons-learned/2026-05-sprint-2c-gen1-vs-gen2.md`](../lessons-learned/2026-05-sprint-2c-gen1-vs-gen2.md). Aplica a cualquier Cloud Function sobre runtime con constraints service-specific.
- **ADR-054 anotado** con marcador `Superseded by ADR-057` (precedente ADR-056→ADR-020). El contenido de ADR-054 se conserva como registro histórico de una dirección que no se sostuvo; no se edita retroactivamente más allá del marcador de Status.
- **Si se re-habilita self-signup auto-creador** (distinto de Google): revisitar el scope del reaper (`oq-resolution.md` OQ-G3) y re-auditar el boundary (SC-G1) + el harness clasificará el mount nuevo automáticamente.
