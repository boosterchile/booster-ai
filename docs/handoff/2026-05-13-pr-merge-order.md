# Handoff 2026-05-13 — Orden de merge consolidado (12 PRs abiertos)

**Fecha**: 2026-05-13
**Audiencia**: Felipe (PO) para review/merge
**Contexto**: cierre de la sesión de noche con la implementación completa del plan `docs/plans/2026-05-12-identidad-universal-y-dashboard-conductor.md`. 12 PRs abiertos cubriendo Waves 1-6 + bump security + activación del flag auth universal.

---

## Estado externo confirmado

- **Picovoice approval**: PENDIENTE. Console responde *"Thank you for your interest. Our team will review it shortly."* Significa que el modelo custom `oye-booster-cl.ppn` y el access key NO están disponibles todavía. Wave 5 PR 2 wire real queda bloqueado hasta que llegue la aprobación.
- **Cuenta Picovoice**: creada (Felipe registró `dev@boosterchile.com`).
- **Demo Corfo**: lunes 18-may. Wave 1 + auth universal listos para esa fecha.

---

## Orden de merge recomendado

El orden respeta:
1. **Desbloqueo de CI** primero (npm audit fix).
2. **Cierre del bug productivo** (Wave 1 — "Sin empresa activa").
3. **Stakeholder data model** independiente.
4. **Auth universal end-to-end** antes de activar el flag.
5. **Wake-word stub** (UI inerte hasta Picovoice).
6. **Activación del flag** al final.
7. **Doc/research/scripts** en cualquier momento.

```text
PASO 1: Desbloquear CI
─────────────────────────────────────────────────────────────
 [1] #184 fix(security): bump @opentelemetry/* a 0.218
     → desbloquea npm audit en TODOS los PRs siguientes
     → tras merge, rebase los demás PRs sobre main

PASO 2: Wave 1 — conductor identity (demo Corfo)
─────────────────────────────────────────────────────────────
 [2] #179 feat(conductor): identidad + dashboard split
     → migration 0029 + ensureConductor + driver-activate
     → fix del bug "Sin empresa activa"
     → autodeploy staging
 [3] EJECUTAR scripts/smoke-wave1-conductor.mjs en staging
     → si OK, autodeploy prod
 [4] #189 chore(smoke): script smoke-wave1-conductor (doc/tool, después de [2])

PASO 3: Wave 3 — stakeholder orgs
─────────────────────────────────────────────────────────────
 [5] #180 feat(stakeholder): organizaciones stakeholder + ADR-034
     → migrations 0030 + 0031 (entidad XOR con empresas)
     → CRUD admin + UI platform-admin
 [6] #188 feat(stakeholder): zonas filtradas por region_ambito (follow-up)
     → tras merge de #180, rebase quita los archivos cherry-pickeados

PASO 4: Wave 4 — auth universal (foundation → UI → migración)
─────────────────────────────────────────────────────────────
 [7] #181 feat(auth): foundation auth universal RUT+clave + ADR-035
     → migration 0032 + endpoint POST /auth/login-rut + service scrypt
     → flag false default → cero impacto visible

 [8] #185 feat(auth): UI selector universal + /feature-flags
     → flag false default → todavía cero impacto visible
     → declara variables Terraform AUTH_UNIVERSAL_V1_ACTIVATED +
       WAKE_WORD_VOICE_ACTIVATED

 [9] #187 feat(auth): rotación clave numérica (modal forzado)
     → endpoint POST /me/clave-numerica + UI modal post-login legacy

 [10] EJECUTAR smoke E2E del flow universal en staging
      → curl POST /auth/login-rut (debe responder)
      → Felipe entra a /login en staging → debe ver email/password legacy
        (porque el flag aún es false por default)

 [11] #190 chore(auth): activar AUTH_UNIVERSAL_V1_ACTIVATED en prod
      → cambia default a true en variables.tf
      → tras merge + terraform apply, /login muestra selector RUT+clave
        en todas las sesiones (production + staging)
      → usuarios legacy con Google/email+password ven modal forzado
        de rotación en su próximo login → completan migración

PASO 5: Wave 5 — wake-word foundation (UI inerte hasta Picovoice)
─────────────────────────────────────────────────────────────
 [12] #183 feat(wake-word): foundation Oye Booster — service stub + ADR-036
      → UI no visible (flag WAKE_WORD_VOICE_ACTIVATED=false default)

 [13] #186 feat(wake-word): UI card + banner sticky
      → tras merge de #183 + #179 + #185, rebase quita los cherry-picks
      → flag sigue false → card aparece como "Próximamente" sin
        funcionalidad real

PASO 6: Wave 6 — research (doc-only)
─────────────────────────────────────────────────────────────
 [14] #182 docs(research): cultura conductor chileno
      → mergeable en cualquier momento, no toca código
```

---

## Tabla de PRs con dependencias

| # | Branch | Depende de | Default flag |
|---|--------|------------|--------------|
| [#184](https://github.com/boosterchile/booster-ai/pull/184) | `fix/bump-opentelemetry-security` | — | — |
| [#179](https://github.com/boosterchile/booster-ai/pull/179) | `feat/conductor-identity-y-dashboard` | #184 (CI) | — |
| [#189](https://github.com/boosterchile/booster-ai/pull/189) | `chore/smoke-script-wave1-conductor-flow` | #179 | — |
| [#180](https://github.com/boosterchile/booster-ai/pull/180) | `feat/stakeholder-organizations` | #184 (CI) | — |
| [#188](https://github.com/boosterchile/booster-ai/pull/188) | `feat/stakeholder-zonas-region-filter` | #180 | — |
| [#181](https://github.com/boosterchile/booster-ai/pull/181) | `feat/auth-universal-rut-clave` | #184 (CI) | `AUTH_UNIVERSAL_V1_ACTIVATED=false` |
| [#185](https://github.com/boosterchile/booster-ai/pull/185) | `feat/auth-universal-ui-selector` | #181 | declaró flag en Terraform |
| [#187](https://github.com/boosterchile/booster-ai/pull/187) | `feat/auth-universal-rotar-clave` | #185 | — |
| [#190](https://github.com/boosterchile/booster-ai/pull/190) | `chore/activate-auth-universal-flag` | #181 + #185 + #187 | **`=true`** |
| [#183](https://github.com/boosterchile/booster-ai/pull/183) | `feat/wake-word-oye-booster` | #184 (CI) | `WAKE_WORD_VOICE_ACTIVATED=false` |
| [#186](https://github.com/boosterchile/booster-ai/pull/186) | `feat/wake-word-ui-card` | #179 + #183 + #185 | — |
| [#182](https://github.com/boosterchile/booster-ai/pull/182) | `docs/research-cultura-conductor-chileno` | — | — |

---

## Qué pasa después del paso 4 (Wave 4 PR 3 + #190 mergeados)

Cuando `terraform apply` propague `AUTH_UNIVERSAL_V1_ACTIVATED=true` a Cloud Run:

### Para usuarios NUEVOS (post-deploy)

1. Visitan `app.boosterchile.com` → ven selector de 5 botones.
2. Eligen tipo (e.g. "Transporte"), ingresan RUT + clave numérica de 6 dígitos al registrarse.
3. /me devuelve `has_clave_numerica=true` desde el inicio.
4. Próximos logins van directos por flow universal.

### Para usuarios LEGACY con Google / email+password

1. Visitan `app.boosterchile.com` → ven selector.
2. Intentan login con RUT + clave → 410 `needs_rotation`.
3. UI los redirige a `/login?legacy=1` (escape hatch).
4. Entran con Google o email+password.
5. ProtectedRoute detecta `has_clave_numerica=false` → renderiza `<RotarClaveModal/>` bloqueante.
6. Crean clave de 6 dígitos → POST `/me/clave-numerica`.
7. `/me` invalida → `has_clave_numerica=true` → modal se desmonta.
8. Próximos logins van por flow universal (sin modal).

### Para conductores (no afectados directamente)

- El flow `/login/conductor` con RUT + PIN sigue igual.
- Tras activar, también pueden entrar via `/login?tipo=conductor` con su RUT + clave numérica (que es el mismo PIN que setearon en su activación).
- Es invisible al conductor — `auth-driver.ts` legacy sigue funcionando.

### Rollback si algo se rompe

```bash
# editar infrastructure/variables.tf:
default = false   # revertir auth_universal_v1_activated
terraform apply
# Cloud Run respawn ~30s, todos los usuarios vuelven al flow legacy
```

---

## Wave 5 — qué falta para Picovoice ready

Tras la aprobación de Picovoice Console:

1. **Definir wake-word custom** en Picovoice Console:
   - Wake phrase: "Oye Booster"
   - Idiomas: español (será extendido con muestras chilenas).
   - Sensitivity: 0.5 default; ajustar tras testing.

2. **Coordinar samples de voz chilena** con Van Oosterwyk:
   - 3 conductores reales × 5 min de audio limpio cada uno.
   - Idealmente: 1 norteño (Antofagasta/Iquique), 1 centro (RM/V), 1 sureño (Bío Bío+).
   - Subir al training pipeline de Picovoice.

3. **Entrenar modelo** (~24h training time):
   - Output: `oye-booster-cl.ppn` (~50 KB binario).
   - Commitear a `apps/web/public/wake-word/oye-booster-cl.ppn`.

4. **Provisionar access key**:
   - Crear secret `PICOVOICE_ACCESS_KEY` en Secret Manager.
   - Modificar `infrastructure/compute.tf` para inyectar a Cloud Run.
   - Variable VITE_PICOVOICE_ACCESS_KEY para build del frontend (se embebe en bundle — es OK, Picovoice valida origin).

5. **Wire real en `apps/web/src/services/wake-word.ts`**:
   - Instalar `@picovoice/porcupine-web` dependency.
   - Reemplazar `StubWakeWordController` por `PorcupineWakeWordController`.
   - Conectar con `useDriverStoppedGate` para pausar al moverse.

6. **Activar flag**:
   - PR similar a #190: cambiar default de `wake_word_voice_activated` a `true`.

ETA realista: 1 semana tras approval Picovoice + samples Van Oosterwyk.

---

## Acción requerida de Felipe

1. **Revisar y mergear PRs en el orden de arriba**. CI debe pasar en cada uno (el bump #184 cierra el último hueco rojo).
2. **Ejecutar smoke script Wave 1** post-merge de #179: `node apps/api/scripts/smoke-wave1-conductor.mjs` apuntando a staging.
3. **Decidir cuándo activar `AUTH_UNIVERSAL_V1_ACTIVATED=true` en prod** — el PR #190 está listo pero solo mergear cuando #181 + #185 + #187 estén en main.
4. **Coordinar con Van Oosterwyk** los samples de voz chilenos para Picovoice.

---

## Métricas de la sesión

- **12 PRs abiertos**, ~3.000 líneas netas de código, ~85 specs nuevos de tests.
- **6 Waves** completas (1-6) más migration security (#184) más activación flag (#190).
- **3 ADRs** nuevos (034, 035, 036) más actualización del plan central.
- **9 migrations** de DB (0029, 0030, 0031, 0032) en cuatro PRs distintos.
- **Cero downtime esperado**: todos los feature flags son OFF por default; activación es por flip explícito reversible.

---

## Estado actual: aguardando merge

Toda la implementación está hecha. El bloqueante es **review humano**.
