# Plan de implementación — Identidad universal Booster + Dashboard Conductor

**Fecha**: 2026-05-12
**Autor**: Felipe (PO) + Claude
**Estado**: pendiente de aprobación
**Branch base**: `feat/conductor-identity-y-dashboard` (Wave 1 ya está en este branch)
**Referencias previas**: ADR-004, ADR-008, ADR-028, memoria `project_identity_model_decisions.md`

---

## Contexto

Tres fuerzas convergen hoy:

1. **Bug productivo**: conductores creados por el carrier no tenían `memberships` → `/me` devolvía null → frontend mostraba "Sin empresa activa". Tapado parcialmente en branch actual.
2. **Decisión de producto** (Felipe, 2026-05-12): URL única `app.boosterchile.com`, login universal RUT + clave numérica (sin email/password), selector de **4 UI types** (Generador / Transporte / Conductor / Stakeholder, + Booster como 5° admin), empresas como "espacios de configuración" no como personas.
3. **Demo Corfo lunes 18-may**: requiere que el flujo conductor funcione end-to-end sin parches visibles.

La consigna explícita: **sin parches, soluciones definitivas, trabajar de noche si hace falta**.

---

## Arquitectura objetivo

```
                ┌─────────────────────────────────────────┐
                │  app.boosterchile.com (URL ÚNICA)        │
                │  ┌────────────────────────────────────┐ │
                │  │  Selector: tipo de usuario        │ │
                │  │  · Generador de carga             │ │
                │  │  · Transporte                     │ │
                │  │  · Conductor                      │ │
                │  │  · Stakeholder                    │ │
                │  │  · Booster (platform admin)       │ │
                │  └────────────────────────────────────┘ │
                │            ↓ RUT + clave numérica       │
                └─────────────────────────────────────────┘
                              │
       ┌──────────┬──────────┼──────────┬──────────────┐
       ↓          ↓          ↓          ↓              ↓
  /app/cargas /app/ofertas /app/    /app/         /app/platform-
  (shipper)  (carrier)    conductor stakeholder/  admin
                                     zonas
       │          │          │          │              │
       │          │          │          │              │
   "espacios" = empresas (configuración compartida por
   dueño + admin + asistentes; mismo UI dentro del mismo tipo)
       │          │          │          │              │
       └──────────┴──────────┴──────────┴──────────────┘
                              │
                    ┌─────────▼──────────┐
                    │  Backend Hono       │
                    │  · /me              │
                    │  · /auth/login-rut  │← NUEVO (Wave 4)
                    │  · /auth/driver-activate (legacy, mantener)
                    └─────────────────────┘
```

**Invariante de identidad**:
- 1 persona = 1 `usuarios` (PK por `rut`).
- 1 `usuarios` ↔ N `memberships` (rol específico por empresa).
- 1 `empresa` = espacio de configuración compartido por sus memberships.
- 1 `conductor` activo ⇒ existe `membership(rol=conductor, estado=activa)` (invariante reforzado en backend, Wave 1).
- Stakeholder vive en `organizaciones_stakeholder` (no `empresas`).

---

## Mapa de waves

| Wave | Alcance | PRs | Bloquea | ETA |
|------|---------|-----|---------|-----|
| **1** | Conductor membership + dashboard split (`/app/conductor` vs `/app/conductor/configuracion`) | 1 (branch actual) | Demo lunes | 1 día |
| **2** | Tests del dashboard + sweep español neutro completo en surfaces driver | 1 | nada | 1 día |
| **3** | Stakeholder organizations + auth stakeholder | 1 ADR + 2 PRs | nada (paralelo a 4) | 3 días |
| **4** | Auth universal RUT + clave numérica (reemplaza email/password) | 1 ADR + 3 PRs | retira email/password legacy | 5 días |
| **5** | Wake-word voice activation tipo "Hey Booster" | 1 ADR + 1 PR | requiere Wave 1 | 3 días |
| **6** | Investigación cultural conductor chileno (gremios, modismos) — no-code | research note | informa Wave 5 + copy | 2 días paralelos |

---

## WAVE 1 — Conductor identity + dashboard split

**Estado**: branch `feat/conductor-identity-y-dashboard` (este worktree). Falta solo PR + tests + smoke staging.

### Archivos modificados/creados (ya en branch)

| Archivo | Cambio |
|---------|--------|
| `apps/api/drizzle/0029_conductor_memberships_backfill.sql` | NUEVO — backfill `memberships(rol=conductor)` para conductores existentes |
| `apps/api/drizzle/meta/_journal.json` | Registro de migration 0029 |
| `apps/api/src/services/seed-demo.ts` | `ensureConductor()` crea membership automáticamente |
| `apps/api/src/routes/auth-driver.ts` | Driver-activate promueve/crea membership al activar PIN |
| `apps/api/src/routes/{conductores,assignments,me}.ts` | Comments actualizados con nuevo URL |
| `apps/api/src/services/asignar-conductor-a-assignment.ts` | Comment actualizado |
| `apps/api/scripts/demo-dry-run.mjs` | Comment actualizado |
| `apps/web/src/routes/conductor.tsx` | NUEVO — dashboard operativo del conductor |
| `apps/web/src/routes/conductor-configuracion.tsx` | NUEVO — config aislada (sin GPS reporter) |
| `apps/web/src/routes/conductor-modo.{tsx,test.tsx}` | ELIMINADOS — superseded |
| `apps/web/src/router.tsx` | Registra 2 rutas: `/app/conductor` + `/app/conductor/configuracion` |
| `apps/web/src/routes/{app,ofertas,perfil}.tsx` | Removidos los links carrier→driver (separación de surfaces) |
| `apps/web/src/routes/{app,login-conductor}.test.tsx` | Tests actualizados al nuevo URL |
| `apps/web/src/routes/{login-conductor,app,ofertas}.tsx` | Redirección a `/app/conductor` |
| `apps/web/src/services/driver-position.ts` | Comment actualizado |
| `apps/web/src/components/scoring/DriverAssignmentCard.tsx` | Comment actualizado |

### Pendiente Wave 1

1. **Tests nuevos** (PR mismo):
   - `apps/web/src/routes/conductor.test.tsx` — covers:
     - empty state cuando `/me/assignments` devuelve []
     - render de assignment card (origen, destino, vehículo)
     - GPS reporter button disabled si `geoPermission !== 'granted'`
     - Banner WhatsApp visible
     - Click engranaje navega a `/app/conductor/configuracion`
   - `apps/web/src/routes/conductor-configuracion.test.tsx` — port del antiguo `conductor-modo.test.tsx` quitando assertions de GPS reporter
2. **Smoke E2E** staging tras deploy:
   - Login carrier → crea conductor con PIN
   - Logout
   - `/login/conductor` con RUT + PIN
   - Aterriza en `/app/conductor`
   - Ve assignment card (si fue asignado previamente)
   - Toca engranaje → ve configuración
   - Activa permisos GPS → "Iniciar reporte" funciona
3. **PR + merge** a main → autodeploy staging → smoke → autodeploy prod

### Riesgos Wave 1

| Riesgo | Mitigación |
|--------|-----------|
| Migration 0029 rompe DBs con conductores que YA tienen membership (dueño-conductor) | El `NOT EXISTS` clause del INSERT lo protege. Validado lógicamente; testear en staging. |
| Conductor que tenía 2 memberships (e.g. dueño + conductor) pierde una | UNIQUE `(user_id, empresa_id)` ya bloquea esto. Caso edge documentado para Wave 4. |
| `/app/conductor` rompe para roles no-conductor | `ProtectedRoute` con `meRequirement="require-onboarded"` ya lo gatea; pero el dashboard asume `myRole=conductor`. Añadir guard explícito que redirija no-conductores a `/app`. |

### Feature flags Wave 1
Ninguno — el split de rutas es backward-compatible con redirects.

---

## WAVE 2 — Tests + español neutro completo

### Trigger
Felipe identificó argentinismos en surfaces driver. Sweep completo + tests del dashboard cubren el gap de Wave 1.

### Archivos a modificar

| Archivo | Cambio |
|---------|--------|
| `apps/web/src/routes/conductor.tsx` | "acá" → "aquí" (2 instancias detectadas) |
| `apps/web/src/components/scoring/DriverAssignmentCard.tsx` | "No tenés conductores" → "No tienes conductores"; "Creá uno" → "Crea uno"; "Pedile a un usuario" → "Pídele a un usuario" |
| `apps/web/src/routes/platform-admin-matching.tsx` | "querés simular" → "quieres simular" |
| `apps/web/src/routes/cobra-hoy-historial.tsx` | "acá el historial" → "aquí el historial" |
| `apps/web/src/routes/conductor-configuracion.tsx` | Audit completo (es archivo recién copiado, puede tener argentinismos heredados) |

### Test coverage Wave 2

- `conductor.test.tsx` (mencionado en Wave 1, formaliza en este PR)
- `conductor-configuracion.test.tsx`
- Snapshot del header del conductor (logo, fullName, ícono engranaje)
- Test de regresión: argentinismos detectados por regex en CI (script `scripts/check-spanish-neutral.sh`)

### Riesgos Wave 2
- Bajos — refactor de strings + tests.

---

## WAVE 3 — Stakeholder organizations

### Trigger
Felipe (2026-05-12): "me faltó incluir a los stakeholder, ayúdame con la forma de ingreso. investiga en fuentes públicas, gremios u otros…"

Hoy el `stakeholder_sostenibilidad` es solo un rol de `memberships`, lo que asume que pertenece a una `empresa`. Pero un stakeholder NO es una empresa transportista ni shipper — es una organización distinta (regulador, asociación gremial, observatorio académico, ONG).

### ADR nuevo: `docs/adr/034-stakeholder-organizations-y-acceso.md`

Decisión:
- Nueva entidad `organizaciones_stakeholder` (no `empresas`).
- Campos: `id`, `nombre_legal`, `tipo` (enum: `regulador` | `gremio` | `observatorio_academico` | `ong` | `corporativo_esg`), `region_ambito`, `creado_por_admin_id`, `creado_en`, `actualizado_en`, `eliminado_en`.
- Memberships extendidas: `memberships.organizacion_stakeholder_id` (nullable; XOR con `empresa_id`).
- Alta solo por platform-admin (auditado en `events`).
- Auth: mismo flow RUT + clave numérica (Wave 4) cuando esté listo; mientras tanto, email/password con allowlist de dominios institucionales (`@subtrans.gob.cl`, `@uc.cl`, etc.).
- Datos accesibles: agregados con k-anonymity ≥ 5, scopeados por `region_ambito` de la org del stakeholder.

### Migraciones

- `0030_organizaciones_stakeholder.sql` — crea tabla + enum `tipo_organizacion_stakeholder`.
- `0031_memberships_stakeholder_org.sql` — columna nullable `organizacion_stakeholder_id` + CHECK XOR.

### Archivos a crear/modificar

| Archivo | Cambio |
|---------|--------|
| `docs/adr/034-stakeholder-organizations-y-acceso.md` | NUEVO ADR |
| `apps/api/drizzle/003{0,1}_*.sql` | Migrations |
| `apps/api/src/db/schema.ts` | `organizacionesStakeholder` table + relations |
| `packages/shared-schemas/src/domain/stakeholder.ts` | NUEVO — `OrganizacionStakeholderSchema`, `TipoOrganizacionStakeholder` |
| `apps/api/src/routes/admin-stakeholder-orgs.ts` | NUEVO — CRUD restringido a platform-admin |
| `apps/api/src/routes/me.ts` | Si membership.organizacion_stakeholder_id, popula `active_membership.organizacion_stakeholder` |
| `apps/web/src/routes/platform-admin.tsx` | Sección "Organizaciones stakeholder" con tabla + crear |
| `apps/web/src/routes/stakeholder-zonas.tsx` | Lee `region_ambito` desde la org y filtra |
| `apps/api/src/services/seed-demo.ts` | Seed un stakeholder de demo (e.g. "Observatorio Logístico UC", tipo `observatorio_academico`) |

### Orden de commits Wave 3

1. `feat(domain): organizaciones_stakeholder schema (Wave 3 PR 1/2)`
2. `feat(api): admin CRUD para organizaciones_stakeholder`
3. `feat(web): UI platform-admin para crear y listar stakeholder orgs`
4. `feat(stakeholder): zonas filtradas por region_ambito de la org`
5. `chore(seed): seed-demo incluye observatorio stakeholder`

### Riesgos Wave 3

| Riesgo | Mitigación |
|--------|-----------|
| Memberships XOR rompe queries existentes | Migration default `empresa_id NOT NULL`, ya tiene FK; XOR aplica solo a stakeholder nuevos. |
| Stakeholder pre-existente (rol en empresa) hay que migrarlo | Por ahora ninguno en prod. Si aparece, migration data-fix scripteada. |
| k-anonymity ≥ 5 puede vaciar pantalla en regiones chicas | Default-fallback a "datos insuficientes" UI, no crashea. |

---

## WAVE 4 — Auth universal RUT + clave numérica

### Trigger
Felipe (2026-05-12): "la url app.boosterchile.com de acceso a Booster es única, en esa interfaz uno selecciona el tipo de usuario… RUT + clave numérica universal (no email/password) — aligned con mobile-first (PIN + face ID)".

Este es el cambio más grande. Reemplaza el paradigma email/password de Firebase Auth con RUT + clave numérica de 6 dígitos para TODOS los roles (no solo conductor).

### ADR nuevo: `docs/adr/035-auth-universal-rut-clave-numerica.md`

Decisiones:
- Toda persona se identifica por RUT (PK en `usuarios.rut`).
- Clave de acceso: 6 dígitos numéricos (cliente puede usar PIN del dispositivo + WebAuthn / passkey en future iter).
- Email queda como contacto opcional (notificaciones), no como credencial.
- Firebase Auth interno sigue, pero con email sintético derivado del RUT (`<rol>+<rut>@boosterchile.invalid`) y password = clave numérica. Esto reusa el patrón de `auth-driver.ts`.
- Migración: usuarios actuales con email/password tienen 30 días para "rotar a RUT" desde su perfil; tras eso, el email/password deja de funcionar.
- Selector de tipo de usuario en `/login`: 5 opciones (Generador / Transporte / Conductor / Stakeholder / Booster). El backend infiere el rol disponible vía memberships del RUT; el selector solo determina la UI inicial.
- 2FA WhatsApp sigue igual.

### Migración de datos

- `0032_user_clave_numerica_hash.sql` — añade `usuarios.clave_numerica_hash` (scrypt timing-safe igual que `activacion_pin_hash`).
- Backfill: a cada usuario con `firebase_uid` real (no `pending-rut:`) le forzamos rotar clave numérica en su próximo login.
- Eliminación de `activacion_pin_hash` se difiere hasta deprecar todos los flujos legacy.

### Archivos a crear/modificar

| Archivo | Cambio |
|---------|--------|
| `docs/adr/035-auth-universal-rut-clave-numerica.md` | NUEVO ADR |
| `apps/api/drizzle/0032_user_clave_numerica_hash.sql` | Migration |
| `apps/api/src/services/clave-numerica.ts` | NUEVO — hash + verify (espejo de `activation-pin.ts`) |
| `apps/api/src/routes/auth-universal.ts` | NUEVO — `POST /auth/login-rut`, `POST /auth/rotate-clave` |
| `apps/api/src/routes/auth-driver.ts` | Refactor: ahora es caso especial de auth-universal con `tipo=conductor` |
| `packages/shared-schemas/src/auth.ts` | NUEVO — schemas `LoginRutSchema`, `RotateClaveSchema` |
| `apps/web/src/routes/login.tsx` | REWRITE — selector de tipo de usuario + form RUT+clave |
| `apps/web/src/routes/login-conductor.tsx` | DEPRECATED — redirige a `/login?tipo=conductor` (mantener 1 ciclo de release, después eliminar) |
| `apps/web/src/hooks/use-auth.ts` | Función `signInWithRutClave(rut, clave, tipo)` |
| `apps/web/src/components/profile/RotateClaveSection.tsx` | NUEVO — UI para rotar clave numérica |
| `apps/api/src/services/seed-demo.ts` | Seed asigna `clave_numerica` a usuarios demo |

### Orden de commits Wave 4

1. `feat(auth): clave_numerica_hash + service + tests (Wave 4 PR 1/3)` — solo backend, sin cambios de UI
2. `feat(auth): POST /auth/login-rut + endpoint admin de rotate-clave (Wave 4 PR 2/3)` — endpoint vivo pero sin uso desde UI todavía
3. `feat(web): /login con selector tipo usuario + RUT+clave (Wave 4 PR 3/3)` — UI nueva, feature-flag `AUTH_UNIVERSAL_V1_ACTIVATED`

### Feature flag Wave 4

- `AUTH_UNIVERSAL_V1_ACTIVATED` (server-side + cliente):
  - `false` → `/login` es el viejo (email/password). `/login/conductor` funciona normal.
  - `true` → `/login` es el nuevo selector. `/login/conductor` redirige al nuevo.
- Cliente lee desde `/me/feature-flags` (endpoint público). Cambio sin redeploy via Secret Manager → restart.

### Riesgos Wave 4

| Riesgo | Mitigación |
|--------|-----------|
| Usuarios productivos con email/password no pueden entrar | Coexistencia 30 días + email de migración con link a `/perfil/rotar-clave`. Feature flag permite rollback instantáneo. |
| Selector tipo usuario es ambiguo (carrier que también es shipper) | El selector determina **vista inicial**, no el rol. Layout siempre muestra switcher de membresías como hoy. |
| Pérdida de clave numérica = recovery flow | Recovery por WhatsApp OTP (Twilio) — reusa el 2FA pipeline existente. |
| Firebase Auth quota con sintéticos | Email sintético ya implementado en auth-driver; mismo costo por usuario. |
| Passkey / WebAuthn no soportado en browsers viejos | Mantener fallback a clave numérica siempre. |

---

## WAVE 5 — Wake-word voice activation

### Trigger
Felipe (2026-05-12): "el comando por voz debería activarse como Alexa o Siri".

Hoy las features voice se disparan via push-to-talk explícito (botón). Cambia a always-on listening con wake-word "Hey Booster" o similar.

### ADR nuevo: `docs/adr/036-wake-word-voice-driver.md`

Decisiones:
- Library: Picovoice **Porcupine** (on-device, ~700KB, gratis hasta 100 usuarios; comercial después). Alternativa Snowboy DEPRECADA, MyCroft Precise abandonada.
- Wake-word custom: "Hey Booster" (entrenado en Picovoice Console, 24h training).
- Always-on solo cuando vehículo detenido (≤3 km/h por 4s, igual que coaching). Cuando se mueve, mic se apaga para batería + privacidad.
- Privacy: audio jamás sale del dispositivo. Wake-word detection es on-device. Solo tras wake-word el audio se streamea a Web Speech API para STT.
- Costo: $20-100/mo por wake-word custom según escala.

### Archivos a crear/modificar

| Archivo | Cambio |
|---------|--------|
| `docs/adr/036-wake-word-voice-driver.md` | NUEVO ADR |
| `apps/web/package.json` | Dep nueva: `@picovoice/porcupine-web` |
| `apps/web/src/services/wake-word.ts` | NUEVO — wrapper Porcupine con start/stop/onWake |
| `apps/web/src/hooks/use-wake-word.ts` | NUEVO — hook React que integra con vehicle-stopped-detector |
| `apps/web/src/routes/conductor.tsx` | Integra wake-word: cuando suena "Hey Booster" → abre control de voice command activo |
| `apps/web/src/routes/conductor-configuracion.tsx` | Card nuevo: "Activación por voz" con toggle on/off + estado del modelo |
| `apps/web/public/wake-word/hey-booster.ppn` | Asset binario del modelo entrenado |

### Riesgos Wave 5

| Riesgo | Mitigación |
|--------|-----------|
| Battery drain on Android | Solo activo cuando parado (gating ya en sistema). Test en device real. |
| False positives en conversación normal | Tuning del threshold; usuario puede desactivar por completo. |
| Privacy concern del usuario | Banner explícito + opt-in (default OFF). Texto: "El micrófono solo escucha la frase 'Hey Booster', no se graba conversación, no sale del teléfono." |
| Picovoice license cambia | ADR explica licencia actual; tenemos abstracción `wake-word.ts` para swap futuro. |

### Feature flag Wave 5
- `WAKE_WORD_VOICE_ACTIVATED` — default OFF, opt-in por usuario en configuración.

---

## WAVE 6 — Investigación cultural conductor chileno (no-code)

### Trigger
Felipe (2026-05-12): "Es importante conocer la cultura de los conductores… investiga en fuentes públicas, gremios u otros".

### Deliverables

| Doc | Ubicación |
|-----|-----------|
| Research note "Cultura conductor chileno — modismos y adherencia digital" | `docs/research/2026-05-13-cultura-conductor-chileno.md` |
| Glosario español neutro vs chileno (qué keep, qué neutralizar) | `docs/copy-guide.md` (extend existing) |
| Mapeo de gremios y referentes | en research note |

### Fuentes a consultar (públicas)

- Asociación Chilena de Empresas de Transporte de Carga (ChileTransporte)
- Confederación Nacional de Dueños de Camiones (CNDC)
- Subsecretaría de Transportes (Subtrans) — estudios de modos de transporte
- Tesis y papers académicos UC + USACH sobre adherencia tecnológica en sector transporte
- Foros y subreddits: r/chile, grupos de Facebook "Camioneros de Chile"
- Entrevistas: 3-5 conductores reales (vía Transportes Van Oosterwyk para referidos)

### Cómo informa el código

- Wake-word: ¿"Hey Booster" o algo más natural? ("Oye Booster", "Booster")
- Voice commands: frases que realmente usan al conducir vs literatura
- Iconografía + colores: paletas que evocan confianza vs gimicky
- UI copy: nivel de formalidad (tú vs usted en Chile depende de edad y región)

### Cronograma Wave 6
- En paralelo a Wave 1-3. NO bloquea código.
- Resultado entra como input a Wave 5 (wake-word naming) y a refinamientos UI continuos.

---

## Riesgos transversales

| Riesgo | Wave(s) afectadas | Mitigación |
|--------|-------------------|------------|
| Demo Corfo (lunes 18-may) bloqueada si Wave 1 no llega | 1 | Wave 1 ya está en branch; solo falta PR + smoke. Plan B: rollback al commit anterior si algo rompe. |
| Cambio de auth (Wave 4) rompe sesiones activas | 4 | Feature flag + 30 días de coexistencia + recovery por WhatsApp. |
| Picovoice quota / pricing model cambia | 5 | Abstracción permite swap. Mantener fallback push-to-talk siempre. |
| Stakeholder org schema evoluciona post-Wave 3 (nuevos tipos) | 3 | Enum extensible via migration ALTER TYPE; no breaking. |

---

## Feature flags (resumen)

| Flag | Default | Activado por | Wave |
|------|---------|--------------|------|
| `MATCHING_ALGORITHM_V2_ACTIVATED` | `true` (ya activo prod) | — | (existente) |
| `AUTH_UNIVERSAL_V1_ACTIVATED` | `false` (rollout gradual) | Felipe via Secret Manager | 4 |
| `WAKE_WORD_VOICE_ACTIVATED` | `false` (opt-in usuario) | Cada conductor en su configuración | 5 |

---

## Orden de deploy recomendado

```
2026-05-12 (hoy)    Wave 1 — PR + smoke staging + merge → prod
2026-05-13          Wave 2 — tests + español neutro (1 PR)
2026-05-13 a 15     Wave 6 — research en paralelo
2026-05-13 a 16     Wave 3 — stakeholder orgs (3 PRs incrementales)
2026-05-14 a 19     Wave 4 — auth universal (3 PRs, behind flag)
2026-05-17 a 20     Wave 5 — wake-word voice (1 PR, opt-in)

Demo Corfo lunes 18-may: necesita Wave 1 ✓ + Wave 2 ✓ + idealmente Wave 3
                         (stakeholder en demo si Felipe quiere mostrarlo).
                         Wave 4 + 5 NO bloquean demo.
```

---

## Exit criteria del plan

- [ ] Felipe aprueba waves y orden
- [ ] ADRs 034 (stakeholder), 035 (auth universal), 036 (wake-word) escritos antes de los PRs respectivos
- [ ] Cada wave tiene su PR con sección "Evidencia" (tests + screenshots + traces) per CLAUDE.md
- [ ] Cada migration tiene rollback documentado
- [ ] Feature flags declarados en Terraform antes del primer commit que los lea
- [ ] Demo Corfo (18-may) corre verde con Wave 1 + 2 mínimo

---

## Decisiones cerradas (2026-05-12, aprobación Felipe)

1. **Wake-word literal**: **"Oye Booster"** — natural en español de Chile, dos sílabas iniciales son fonéticamente distintas → menos falsos positivos.
2. **Recovery de clave numérica**: WhatsApp OTP reusando pipeline 2FA existente. NO email backup (mobile-first).
3. **URL canónica**: `app.boosterchile.com` para todos los roles. Subdominios por rol (`transporte`, `carga`, `conductor`, `stakeholder`, `admin`) son **301 redirects** al canónico con query param `?tipo=<rol>` que pre-selecciona el selector de login. No son apps separadas — single bundle, single Cloud Run, single SSO.
4. **Excepción `admin.boosterchile.com`**: evaluar hard-separation por seguridad (IP allowlist + WAF estricto). Decisión final en ADR-035.
5. **Plan completo aprobado hasta finalizar.** Felipe: "Apruebo el plan completo hasta terminar a la hora que sea".

## Decisiones pendientes para definir dentro de las Waves

1. **Stakeholder allowlist de dominios** (Wave 3): qué dominios institucionales pre-aprobamos antes de Wave 4 (`@subtrans.gob.cl`, `@uc.cl`, etc.)
2. **Migración usuarios actuales a clave numérica** (Wave 4): forzamos rotación al login siguiente, o damos 30 días con UI nag.
3. **Admin hard-separation** (Wave 4 ADR-035): `admin.boosterchile.com` separado o solo redirect.
