# Recon read-only — ADR-053 + acoplamiento es_demo ↔ impersonación

Objetivo: extraer las invariantes de seguridad que el set NUEVO de usuarios de prueba (parte 2) debe cumplir sin reintroducir el vector que retiró las cuentas demo. **Read-only: sin prod, sin writes al schema, sin crear cuentas, sin PR.** Cada hallazgo cita `ruta:línea`; lo no fundamentable va como GAP.

---

## C1 — ¿ADR-053 es el del retiro post-disclosure? ✅ SÍ

`docs/adr/053-post-disclosure-account-replacement.md:1` — título **"ADR-053: Post-disclosure account replacement (SEC-001 H1.1)"**. `:3` Status **Accepted (2026-05-25)**. `:5` Decider **Felipe Vicencio (PO)**. `:10` **"PR de origen del vector: #206 (`feat(demo): subdominio demo.boosterchile.com operativo`)"**. `:11` References **NIST SP 800-63 §5.1.1.1** (memorized secret post-compromise) + **OWASP A07**. El número 053 resuelve al ADR correcto (no es CSP/headers).

## C2 — Causa raíz explícita del incidente (citada, no inferida)

El vector fue un **password compartido hardcoded en código, público en git** — NO el flag `es_demo`:

- `ADR-053:15` — *"El seed contenía un literal password `BoosterDemo2026!` hardcoded en `apps/api/src/services/seed-demo.ts:86` y `seed-demo-startup.ts:142`"*.
- `ADR-053:17` — *"La auditoría… catalogó el literal como **public attack surface** dado que el repo… ya tenía el commit `8400542` (literal en plain) push-edo público desde 2026-05-10. 4 días de exposición pública + 4 UIDs de cuentas activas (`nQSqGqVCHGUn8yrU21uFtnLvaCK2`, …) + emails predecibles (`demo-shipper@`, `demo-carrier@`, …) constituyen un compromise de la primary credential (password)"*.

Tres componentes del vector, textual del ADR: **(a)** primary credential (password) **compartida + hardcodeada + pública en git history**; **(b)** **emails/UIDs predecibles** de cuentas activas (enumeration/credential-stuffing, OWASP A07 `:27`); **(c)** superficie de login demo (`#206`, `demo.boosterchile.com` + `/demo/login`) que las hacía usables. `ADR-053:56` marca residual **R-DA-LITERAL-HISTORY**: el literal *"permanece en git history público (force-push imposible)"* — aceptado, mitigado con monitoreo 90d.

## C3 — Invariantes/constraints que impone la remediación (el set NUEVO debe respetarlas)

Del ADR-053 §Decision y §Consequences:

1. **Credenciales fuera del código, random, por-cuenta, en Secret Manager.** `:23` *"passwords nuevos (random 128-bit en Secret Manager)"*; `:31` *"passwords from new Secret Manager secrets `demo-account-password-*-2026`"*. → El set nuevo **jamás** con secreto compartido ni literal en repo.
2. **No resucitar las 4 identidades comprometidas.** `:23` retiro **irreversible** `disabled:true`; `:48` *"once-compromised es permanently-compromised"*; `:32` `updateUser(uid,{disabled:true})`. → El set nuevo debe ser **identidades nuevas** (UIDs + emails nuevos), no las 4 retiradas.
3. **Identidades distinguibles / no-predecibles-triviales.** `:23`/`:41` nuevos emails `demo-2026-<persona>@…` con pattern distinguible; el ataque era *"predictable email patterns + known passwords + active accounts"* (`:27`). → Evitar emails que revivan el patrón comprometido.
4. **TTL + enforcement server-side si son alcanzables por login.** `:23` claims `expires_at` 30d; `:33` *"Middleware `demo-expires.ts` enforces `expires_at` server-side con `checkRevoked: true`"*; `:34` cron TTL-alerter. → Si el set nuevo es login-reachable, gate + TTL + expiry enforcement.
5. **Reducir la superficie estructuralmente.** `:80` nota future-self: *"Considerar Firebase App Check + provider gate para reducir attack surface estructural"*. → Cuanto menos superficie de login tengan los usuarios de prueba, mejor.

**Invariante derivada para impersonación (fundada en C2+C4, marcada como tal):** los targets de impersonación deben ser cuentas Firebase **ENABLED** (el 400 `USER_DISABLED` del recon previo es porque los targets actuales son las 4 UIDs retiradas `disabled:true`). Esto **coexiste** con la invariante #2: no reusar las retiradas — hay que apuntar a cuentas nuevas y vivas, no revivir las muertas.

## C4 — Acoplamiento es_demo ↔ impersonación

**Cómo selecciona targets el endpoint:** `apps/api/src/routes/auth-impersonate.ts:90-96` — `WHERE eq(empresas.isDemo, true) AND memberships.status='activa' AND users.isPlatformAdmin=false AND firebase_uid NOT LIKE 'pending-rut:%'`. El filtro es **`es_demo=true`** (línea 92).

**`es_demo` es load-bearing en 3 lugares:**
- **Targets** — `auth-impersonate.ts:92`.
- **Write-guard** — `apps/api/src/middleware/impersonation-write-guard.ts:101-102`: *"`const empresaIsDemo = empresa?.isDemo === true`"* — **autoriza la ESCRITURA impersonada solo sobre empresas `es_demo`** (fail-closed si no). Es la frontera de escritura del feature.
- **Demo-login (la superficie del vector)** — `apps/api/src/routes/demo-login.ts:84` *"`empresas.es_demo=true`"* resuelve los users demo para `/demo/login`, gateado por `DEMO_MODE_ACTIVATED` (`:77`). Es decir: **toda empresa `es_demo` es, por diseño, resoluble por la superficie de login demo (#206)** cuando el flag demo está ON.

**Definición/seteo del flag:** `apps/api/src/db/schema.ts:545` `isDemo: boolean('es_demo').notNull().default(false)`, comentario `:542` *"Marca para empresas creadas por el seed demo"*. Se asigna en `apps/api/src/services/seed-demo.ts:646` (`isDemo: true`).

**¿Crear los nuevos usuarios COMO es_demo reintroduce el riesgo?**
- El riesgo retirado (C2) **NO era el flag `es_demo`** — era el password compartido público + emails predecibles + superficie demo. Marcar una empresa `es_demo` no crea, por sí, el vector.
- **PERO** `es_demo` **acopla** los usuarios de prueba al subsistema demo: los vuelve resolubles por `/demo/login` (misma superficie #206 origen del vector) y sujetos al lifecycle demo (hardening/retire/TTL). Reusar `es_demo` mezcla dos conceptos —"cuenta demo del subdominio" y "usuario de prueba para impersonar"— y **contradice** que el subsistema demo se retira igual (memoria `demo-subsystem-debt`; `ADR-053:70` la demo *"se reactiva en Sprint 3 H1.6"*, es decir vive un ciclo aparte y frágil).
- GAP (fuera de este read-scope, observado en el recon previo — NO reconsultado a prod acá): las filas de `usuarios` que hoy matchea el targets query apuntan a las **UIDs viejas retiradas** (`nQSqGq…` `disabled:true`), no a las `demo-2026-*` que creó `harden-demo-accounts --recreate`. Verificar en parte 2 (con el read-scope adecuado) si `usuarios.firebase_uid` quedó desincronizado de las cuentas nuevas.

---

## Decisión pendiente parte 2 — reusar `es_demo` vs. flag desacoplado

| Opción | A favor | En contra |
|---|---|---|
| **(a) Reusar `es_demo`** | Cero cambio de schema; el targets query (`:92`) y el write-guard (`:102`) ya keyean en `es_demo`; el scope de escritura ya está definido. | Re-acopla los usuarios de prueba al subsistema demo **moribundo**: los hace resolubles por `/demo/login` (superficie #206, origen del vector) + los somete al lifecycle demo (retire/TTL) que ya mató a los targets actuales. Contradice "el subsistema demo se retira igual". Mezcla dos conceptos. |
| **(b) Flag desacoplado (`es_usuario_prueba`/`es_prueba`)** | Separa "usuario de prueba para impersonar" de "cuenta demo del subdominio". Los usuarios de prueba **no** son alcanzables por `/demo/login`, **no** heredan el retire/TTL demo, y **sobreviven** al retiro del subsistema demo. Superficie de login mínima (invariante C3 #4/#5). | Requiere: columna nueva en `empresas` (aditiva), actualizar el targets query (`auth-impersonate.ts:92`) y el write-guard (`impersonation-write-guard.ts:102`) para keyear en el flag nuevo (o en `es_demo OR es_prueba`), + una vía de creación de esas empresas/usuarios de prueba. Cambio de schema + guard (auth sensible → TDD + revisión). |

**Recomendación para validar con el PO (no decidida acá):** la **(b)** alinea con las invariantes del ADR-053 (mínima superficie de login, desacople del subsistema comprometido) y con el retiro planificado de demo; el costo es un cambio aditivo de schema + tocar el write-guard con cuidado (TDD, sin romper el gate de wire-completeness). La **(a)** es más barata pero hereda el acople que este recon marca como riesgoso. Cualquiera de las dos **debe** cumplir C3: credenciales random per-account en Secret Manager, identidades nuevas (no las retiradas), cuentas **enabled**, y —si login-reachable— TTL + enforcement.

---

*Recon read-only. Sin llamadas a prod, sin writes al schema, sin creación de cuentas. Citas verificadas contra archivos en `main`.*

---

## Resolución — el trío que atrapaba al admin en "Crea tu clave numérica" (fix frontend)

**Síntoma:** al impersonar, el admin caía en el modal `RotarClaveModal` sin escape, con el mensaje *"La clave anterior no es correcta."*. Diagnóstico: el backend **hace lo correcto** (el `impersonation-write-guard` 403ea el `POST /me/clave-numerica`, fail-closed sobre `/me`: el admin no debe crear la clave del target). El problema era 100% frontend — un trío:

1. **El modal no debía montarse bajo impersonación.** Fix: `ProtectedRoute.tsx` — `useImpersonation()` + `impersonation.active !== true` en `needsClaveRotation` (mismo trato de `null` que `useIsDemo`: solo `active === true` gatea, no se esconde a usuarios reales por race del claim).
2. **La copy mentía sobre el 403.** `humanizeRotarClaveError` mapeaba **cualquier** `status === 403` → "la clave anterior no es correcta". Fix: distinguir por el IDENTIFICADOR del error, no por status.
   - **Discrepancia con el hint del goal** (registrada para el PO): el goal asumía distinguir por `err.code === 'invalid_clave_anterior'`, pero el wire REAL de `me-clave-numerica.ts` es `{ error: 'invalid_clave_anterior' }` **sin campo `code`** → api-client deja `err.code = undefined` y `err.message = 'invalid_clave_anterior'`. Keyear solo por `err.code` habría roto el caso legítimo. El fix matchea `err.code === 'forbidden_impersonation_write'` (el guard SÍ manda `code`) para el mensaje veraz, y `code === 'invalid_clave_anterior' || message === 'invalid_clave_anterior'` para la copy de clave. Proxy `status === 403` eliminado.
3. **El banner quedaba tapado por el overlay.** Banner y modal compartían `z-50`; el modal (montado después) ganaba el tie y tapaba "Salir". Fix: `ImpersonationBanner.tsx` sube a `z-[60]` → stackea sobre cualquier overlay, "Salir" siempre alcanzable.

**Cero backend:** `git diff` vacío en `me-clave-numerica.ts`, `impersonation-write-guard.ts`, `server.ts`. TDD rojo→verde exhibido (C1 modal montado hoy; C2 copy mentirosa hoy; C4 empate z). No-regresión: usuario real sin clave sigue viendo el modal no-descartable; `invalid_clave_anterior` conserva su texto.

*Fix frontend-only. Sin merge, sin deploy, sin prod (esos son del PO — ADR-072).*
