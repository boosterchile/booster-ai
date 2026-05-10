# ADR-028 — RBAC/Auth v1: Firebase ID tokens + memberships per-empresa + consent grants para stakeholders

**Status**: Accepted
**Date**: 2026-05-10
**Decider**: Felipe Vicencio (Product Owner)
**Technical contributor**: Claude (Cowork) actuando como arquitecto de software
**Supersedes**: nada (formaliza retroactivamente la implementación de auth + RBAC en `apps/api` y `apps/web`).
**Related**:
- [ADR-001 Stack selection](./001-stack-selection.md) (Firebase como Identity Provider del stack)
- [ADR-004 Modelo Uber-like y roles](./004-uber-like-model-and-roles.md) (define los 5 roles conceptuales del marketplace)
- [ADR-008 PWA multi-rol](./008-pwa-multirole.md) (una sola web app sirve a todos los roles)
- [ADR-006 WhatsApp canal primario](./006-whatsapp-primary-channel.md) (intake anónimo NO es auth — explicado §6)
- [ADR-011 Admin console](./011-admin-console.md) (rol admin Booster)
- [docs/pii-handling-stakeholders-consents.md](../pii-handling-stakeholders-consents.md) (modelo stakeholder + consent grants)

---

## Contexto

`apps/api` (backend Hono) y `apps/web` (PWA Vite multi-rol) implementan autenticación y autorización para 5 roles distintos definidos en ADR-004 (shipper, carrier, driver, admin Booster, stakeholder ESG). La implementación a 2026-05-10 incluye:

- **Identity provider único**: Firebase Auth (apps/api/src/middleware/firebase-auth.ts, apps/web/src/lib/firebase.ts).
- **Modelo de roles** mapeado a un enum `rol_membresia` en BD (`apps/api/src/db/schema.ts:69-76`) con 6 valores granulares: `dueno`, `admin`, `despachador`, `conductor`, `visualizador`, `stakeholder_sostenibilidad`.
- **Multi-empresa**: tabla `membresias` une `usuarios` ↔ `empresas` con composite UNIQUE `(usuario_id, empresa_id)`. Un user puede ser admin en empresa A y conductor en empresa B simultáneamente.
- **Tenant selector**: header `X-Empresa-Id` en requests autenticados. Si user tiene 1 sola membership, default automático.
- **Stakeholder sostenibilidad** modelado en tabla aparte `stakeholders` + `consentimientos` (default deny, scope tipado, expirable, revocable) — ver `docs/pii-handling-stakeholders-consents.md`.
- **Tests**: `auth.test.ts`, `firebase-auth.test.ts`, `me-profile.test.ts`, `empresas-onboarding.test.ts`, `offers.test.ts`, `vehiculos.test.ts`, `notify-offer.test.ts` cubren los happy paths + auth fallido.
- **Sin sesión backend**: stateless. Cada request re-valida ID token contra JWKS de Google (firebase-admin caches internamente).

Sin embargo **no existe ADR formal** que documente:

- Por qué Firebase y no Supabase / Auth0 / Cognito / Clerk
- Por qué role-based "rol = puerta" y no permission-based granular discreto
- Por qué membership-per-empresa y no role global per usuario
- Cómo se integra el modelo de **consent grants** (ESG stakeholders) con el RBAC tradicional
- Riesgos conocidos (IDOR, RLS application-enforced, token revocation gap) y su plan de mitigación
- Roadmap de gaps conocidos (2FA, audit log, SSO empresarial, API keys S2S)

Sin un ADR estos puntos se debaten cada vez que se toca un endpoint nuevo. Este documento los cierra para v1.

---

## Decisión

### 1. Firebase Auth como Identity Provider único

Adoptamos Firebase Authentication como **único IdP** para toda la base de usuarios (shipper, carrier, driver, admin, stakeholder).

**Por qué Firebase y no alternativas**:

| Alternativa | Razón de descarte |
|---|---|
| **Supabase Auth** | Stack ya está en Firebase + Cloud Run + Firebase Hosting; agregar Supabase es coupling extra sin valor diferencial. |
| **Auth0 / Clerk** | Costo escala con MAU; > USD 500/mes a partir de ~5k users — no justificable para startup pre-revenue. |
| **AWS Cognito** | No estamos en AWS. Cross-cloud auth es operacionalmente complejo. |
| **Identidad propia (JWT custom + bcrypt)** | Reinvención sin valor; superficie de ataque que mantenemos nosotros (rotación, revocation, password reset, etc.). |
| **Magic link / passwordless propio** | Requiere SMTP confiable + UX de email; Firebase ya lo soporta como modo opcional. |

**Garantías de Firebase**:
- ID tokens RS256 firmados por Google, JWKS público y rotado, auditable.
- Soporta Email/Password, Google OAuth, Apple, GitHub, Microsoft, magic link, phone (SMS) — todos vía mismo `signInWith*()` API.
- Firebase Admin SDK provee `verifyIdToken(token, { checkRevoked: true })` — habilita revocación inmediata cuando se necesite (no usado en v1, ver §"Riesgos").
- Stateless en backend: zero session storage (Postgres, Redis, etc.).

### 2. Roles RBAC: 6 roles granulares mapeados a 5 conceptos de ADR-004

ADR-004 declara 5 roles conceptuales (shipper, carrier, driver, admin Booster, stakeholder). La implementación los mapea a un enum granular en BD:

```sql
CREATE TYPE rol_membresia AS ENUM (
  'dueno',                       -- "Owner" legal de la empresa (puede transferir, cerrar, etc.)
  'admin',                       -- Administrador operativo (puede invitar/revocar miembros, configurar)
  'despachador',                 -- Operador día-a-día: shipper crea cargas, carrier acepta ofertas
  'conductor',                   -- Driver: solo ve sus asignaciones, marca check-points
  'visualizador',                -- Read-only: dashboards y reportes; útil para gerencia / contabilidad
  'stakeholder_sostenibilidad'   -- ESG stakeholder con consent grants (ver §4)
);
```

Mapping a roles ADR-004:

| Rol ADR-004 | Implementación |
|---|---|
| **Shipper** | Empresa con `es_generador_carga=true`; miembro con role ∈ {`dueno`, `admin`, `despachador`, `visualizador`} |
| **Carrier** | Empresa con `es_transportista=true`; miembro con role ∈ {`dueno`, `admin`, `despachador`, `visualizador`} |
| **Driver** | User con role `conductor` en una empresa transportista (NO requiere ser dueño/admin) |
| **Admin Booster** | User con `usuarios.es_admin_plataforma=true` (flag ortogonal a memberships, no por empresa) |
| **Stakeholder** | Row en tabla `stakeholders` + role `stakeholder_sostenibilidad` en alguna `membresia` (acceso vía consent grants — ver §4) |

**Por qué granular intra-empresa** (vs solo "admin/member"):
- ADR-026 introduce tiers Premium con servicios 24/5 y dashboards específicos: `visualizador` permite que la cuenta de gerencia vea sin tocar.
- Operadores (`despachador`) son distintos de los administradores (`admin`) — distinción frecuente en empresas de logística (operario que crea cargas vs administrativo que paga facturas).
- Dueño legal (`dueno`) es distinto de admin operativo en términos de *governance* (transferencia de empresa, cierre, etc.).

**Por qué role-based y NO permission-based discreto** (ej. `READ_TRIP`, `WRITE_VEHICLE`, ...):
- El espacio de permisos crece exponencialmente: 6 roles × ~30 endpoints relevantes = 180 entradas a mantener.
- Para v1 las decisiones de "qué puede hacer cada rol" son razonablemente estables (no hay clientes que pidan customización).
- Cuando aparezca el primer cliente que requiera customización (ej. "shipper grande quiere que su rol custom 'Auditor Interno' tenga vista de algunos endpoints pero no otros"), se introduce permission-based en un ADR superseding, no antes.

### 3. Multi-empresa: membership per (user, empresa) con `X-Empresa-Id` selector

Un usuario puede pertenecer a N empresas con roles potencialmente distintos en cada una. La tabla `membresias` cumple:

```sql
CREATE TABLE membresias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL REFERENCES usuarios(id),
  empresa_id uuid NOT NULL REFERENCES empresas(id),
  rol rol_membresia NOT NULL,
  estado estado_membresia NOT NULL DEFAULT 'activa',
  creado_en timestamptz NOT NULL DEFAULT now(),
  UNIQUE (usuario_id, empresa_id)
);
```

**Selección del tenant activo en cada request**:
- Header `X-Empresa-Id` opcional. Si presente: middleware verifica que el user tiene membership activa en esa empresa, sino retorna `403 { code: 'empresa_forbidden' }`.
- Si ausente y user tiene 1 sola membership activa: tenant inferido automáticamente.
- Si ausente y user tiene N>1 memberships activas: middleware retorna `400 { code: 'empresa_id_required', available: [...] }` y el cliente muestra dropdown.

**Aislamiento data**: cada query relevante filtra por `empresaId` del `activeMembership`. No hay RLS nativo PostgreSQL — la responsabilidad es del handler. Esto es un **riesgo conocido** (ver §"Riesgos") con plan de mitigación.

### 4. Stakeholders ESG: consent grants explícitos, default deny

El rol `stakeholder_sostenibilidad` NO sigue el patrón "rol da acceso a empresa entera". Stakeholders son entidades externas (auditor SFC, mandante corporativo Walmart, regulador, inversor) que necesitan ver **subsets específicos** de data ESG con expiración y revocabilidad explícitas.

Modelo (ver `docs/pii-handling-stakeholders-consents.md`):

```sql
-- Identidad del stakeholder
CREATE TABLE stakeholders (
  id uuid PRIMARY KEY,
  usuario_id uuid REFERENCES usuarios(id),
  organizacion_nombre varchar(200),
  organizacion_rut varchar(20),
  tipo_stakeholder enum: mandante_corporativo | sostenibilidad_interna | auditor | regulador | inversor,
  estandares_reporte varchar[] -- {GLEC_V3, GHG_PROTOCOL, ISO_14064, GRI, SASB, CDP}
);

-- Grant explícito de acceso, scoped + expirable
CREATE TABLE consentimientos (
  id uuid PRIMARY KEY,
  otorgado_por_id uuid REFERENCES usuarios(id),       -- quién otorga (típicamente dueño/admin de la empresa)
  stakeholder_id uuid REFERENCES stakeholders(id),    -- quién recibe acceso
  tipo_alcance enum: generador_carga | transportista | portafolio_viajes | organizacion,
  alcance_id uuid,                                     -- UUID del recurso (empresa, lista de trips, etc.)
  categorias_datos varchar[] NOT NULL,                 -- mín 1: emisiones | rutas | distancias | combustibles | certificados | perfiles_vehiculos
  otorgado_en timestamptz NOT NULL,
  expira_en timestamptz,                               -- nullable
  revocado_en timestamptz,                             -- nullable
  documento_consentimiento_url text                    -- link al PDF firmado por el otorgante
);
```

**Reglas inquebrantables**:
1. **Default deny**: sin `consentimiento` válido (no expirado, no revocado, scope match), el endpoint retorna `403 { code: 'consent_required', missing: { tipo_alcance, alcance_id, categoria_dato } }`.
2. Cada handler que sirve data ESG a stakeholder DEBE llamar `checkStakeholderConsent({ stakeholder_id, tipo_alcance, alcance_id, categoria_dato })` antes de retornar.
3. **Audit trail bloqueante**: cada lectura exitosa registra una row en `audit.stakeholder_access_log` (tabla pendiente de crear, ver §"Acciones derivadas"). Sin la row, no se sirve data.
4. Revocación es **inmediata**: setear `revocado_en = now()` invalida cualquier request posterior a 1s (no hay caching del consent en backend más allá del request actual).

Este modelo cumple Ley 19.628 Chile + GDPR-compatible para reportes ESG cross-border.

### 5. Middleware chain (orden estricto)

`apps/api/src/server.ts` aplica los middlewares en este orden para rutas autenticadas:

```
firebaseAuthMiddleware  →  userContextMiddleware  →  routeHandler
       ↓                          ↓                       ↓
verifyIdToken              SELECT usuarios            handler usa
sets c.firebaseClaims      SELECT membresias          c.userContext
                           sets c.userContext
                           valida X-Empresa-Id
```

Si **firebaseAuth** falla → `401 { error: 'Invalid token' }`.
Si **userContext** no encuentra al user en DB → `404 { code: 'user_not_registered' }` (cliente redirige a `/onboarding`).
Si **userContext** no resuelve `X-Empresa-Id` → `403 { code: 'empresa_forbidden' }` o `400 { code: 'empresa_id_required' }`.

**Rutas públicas** (sin firebaseAuth, intencional):
- `GET /health`, `GET /ready` — observabilidad/load balancer.
- `POST /trip-requests` (legacy WhatsApp intake; ADR-006) — el bot crea trips anónimos que se bindean al user al primer login.
- `GET /trip-requests/:code` — rastreo público (shipper comparte el link con sus clientes).
- `GET /push/vapid-public-key` — clave pública para VAPID, by design pública (ADR-016 Web Push).

**Rutas service-to-service** (no Firebase, OAuth2 SA):
- `/admin/jobs/*` — autenticadas vía `cronAuthMiddleware` que valida tokens OIDC firmados por Google con `aud = api URL` y `email = ALLOWED_CALLER_SA`. Usado por Cloud Scheduler y otros services internos.

### 6. WhatsApp/SMS NO es autenticación

Es importante explicitarlo porque ADR-006 podría leerse al revés: WhatsApp es **canal de inbound de cargas**, no canal de identidad. Flujo:

1. Shipper manda mensaje al número de WhatsApp Booster: "necesito mover 500kg Stgo→Concepción mañana".
2. `whatsapp-bot` parsea con NLU (Gemini), crea `trip_request` con `created_via='whatsapp'` y `creator_phone_e164='+56...'`.
3. Booster responde con `tracking_code` y link público.
4. Cuando el shipper se registre formalmente (Firebase signup) y agregue su teléfono, el sistema **bindea** los trips anónimos previos a su user.

El bot **no autentica**. Cualquiera con el número puede crear trips. La validación financiera ocurre en la fase de aceptación / liquidación (ADR-027), no en la creación.

### 7. Logout: cliente, stateless, gap conocido

Logout = `signOut(firebaseAuth)` en cliente → limpia localStorage. **No hay endpoint backend `POST /logout`**. Implicación: si el ID token es robado del localStorage del cliente, sigue siendo válido hasta su expiración natural (~1h).

Mitigación a futuro (ver §"Riesgos"): activar `verifyIdToken(token, { checkRevoked: true })` y mantener una lista de `firebase_uid` revocados (Redis o tabla `usuarios_revocados`).

---

## Consecuencias

### Positivas

- **Cero infraestructura de auth propia**: Firebase es operacionalmente gratis (free tier hasta 50k MAU); no hay password storage, reset, etc.
- **Multi-empresa nativo**: empresas con varios operadores y operadores que trabajan en varias empresas funcionan sin hacks.
- **Stateless backend**: facilita autoscaling Cloud Run, fácil DR (sin session storage que migrar).
- **Stakeholder consent compliant**: alineado con Ley 19.628 + GDPR-compatible para ESG cross-border. Diferenciador comercial (ver `docs/market-research/001-competidores-chile-latam-2026-q2.md`).
- **Roles granulares cubren casos reales** sin overengineering (no hay matrix de 180 permisos).
- **Pública vs autenticada está explícita**: handler-by-handler decisión documentada en server.ts.

### Negativas / costos

- **Lock-in con Firebase / Google Auth**: migrar a otro IdP requiere reescribir middleware + flow signup + invalidar todos los tokens.
- **Token revocation gap**: usuario removido en BD sigue teniendo token válido hasta 1h. Aceptable para v1 (acceso a datos no críticos), bloqueante antes de cobrar comisión.
- **RLS application-enforced**: bug en handler puede leakear data de empresa A a user de empresa B. Mitigación en §"Acciones derivadas".
- **Sin 2FA en v1**: aceptable mientras dure piloto sin dinero real; bloqueante post-monetización (ADR-027 v2).
- **Stateless tiene costo por request**: `verifyIdToken` cada request agrega ~10-30ms (firebase-admin caches JWKS internamente). Mitigable con LRU cache de tokens válidos si se vuelve cuello de botella.
- **Permission-based discreto requeriría refactor mayor**: si un cliente grande lo pide, no es trivial convertir desde role-based.

### Riesgos conocidos y plan

| Riesgo | Severidad | Plan de mitigación |
|---|---|---|
| **IDOR potencial** en endpoints `/recurso/:id` | High | Auditoría sistemática (ver Acción §1); test de IDOR para cada endpoint con `:id` (ver Acción §2) |
| **RLS application-enforced** puede leakear cross-tenant | High | Linter custom que falla CI si una query SELECT/UPDATE no filtra por `empresaId`/`activeMembership` (ver Acción §3) |
| **Token revocation gap** (1h tras `usuarios.estado='inactivo'`) | Medium | Activar `checkRevoked: true` + tabla `usuarios_revocados` antes de v2 pricing (ver Acción §4) |
| **Privilege escalation via PATCH /memberships/:id** | Medium | Test matriz de quién-puede-cambiar-rol-de-quién (ver Acción §5) |
| **Sin 2FA** | Medium | Habilitable en Firebase con casi cero código; activar antes de v2 pricing (ver Acción §6) |
| **PII en logs** | Low | Pino redaction ya configurado en `packages/logger/src/redaction.ts` (Ley 19.628 compliant); auditar exhaustividad cada 6 meses |
| **`X-Empresa-Id` puede ser pasado por cliente que no debería** | Low | Middleware verifica membership activa antes de aceptar; covered con test en `me-profile.test.ts` |

### Acciones derivadas (orden estricto)

1. **Auditoría sistemática IDOR**: ejecutar `grep -rn 'GET\\|PATCH\\|DELETE.*\:.*Id' apps/api/src/routes/` y verificar que cada handler con `:id` valide ownership/scope antes de retornar. Output: lista de endpoints "OK" + "FIX". Estimado 4h.
2. **Tests IDOR sistemáticos**: para cada endpoint con `:id`, agregar test "user A no puede leer recurso de empresa B". Mín 1 test por endpoint. Estimado 1d.
3. **Linter custom RLS**: regla Biome o script bash que falle CI si una `db.select().from(table)` no incluye filter por `empresaId` salvo en allowlist documentada. Estimado 1d.
4. **Revocación de tokens**: implementar `checkRevoked: true` en `firebaseAuthMiddleware` + tabla `usuarios_revocados` (background job que sincroniza con `usuarios.estado='inactivo'`). Estimado 1d.
5. **Test matriz de privilege escalation**: tabla de "user con role X en empresa Y intenta cambiar role de user Z a W" — covered. Estimado 4h.
6. **Habilitar 2FA opcional en frontend**: modal de "activar 2FA" en `/me/security`. Firebase soporta phone SMS (gratis hasta 10k SMS/mes). Estimado 2d.
7. **Implementar endpoints stakeholder grant/revoke**: `POST /me/consents`, `PATCH /me/consents/:id/revoke`, `GET /me/consents` (lista de los que el user otorgó como dueño/admin). Tablas existen, APIs no. Estimado 2-3d.
8. **Crear tabla `audit.stakeholder_access_log`** + insertion en cada lectura ESG por stakeholder. Sink a BigQuery para análisis. Estimado 1d.
9. **SSO empresarial (SAML/OIDC)**: backlog hasta que el primer shipper enterprise (Walmart, Cencosud) lo pida. NO implementar antes.
10. **Service accounts especializados** para `apps/matching-engine`, `apps/notification-service` cuando se implementen — usar Google IAM SA + ADC, no API keys custom.

### Métricas a instrumentar

- `auth.firebase_verify_failures` (counter por reason: expired | invalid_signature | aud_mismatch)
- `auth.user_not_registered` (counter — gente que pasó Firebase pero no completó onboarding; señal de fricción UX)
- `auth.empresa_id_required` (counter — users con multi-empresa que no especifican tenant)
- `auth.consent_check_failures` (counter por stakeholder + categoria_dato; señal de stakeholders pidiendo lo que no tienen)
- `auth.privilege_escalation_attempts` (counter — intentos de cambiar role propio o ajeno detectados)

---

## Validación

- [x] Firebase ID token verification implementado (`apps/api/src/middleware/firebase-auth.ts`)
- [x] User context middleware con multi-empresa implementado (`apps/api/src/middleware/user-context.ts`)
- [x] Tablas `usuarios`, `empresas`, `membresias`, `stakeholders`, `consentimientos` en `apps/api/src/db/schema.ts`
- [x] Tests cubriendo Firebase auth happy/sad path, onboarding, multi-empresa, IDs propios
- [ ] Tests IDOR sistemáticos (ver Acción §2) — pendiente P0
- [ ] Linter RLS (ver Acción §3) — pendiente P0
- [ ] `checkRevoked: true` activo (ver Acción §4) — pendiente P1, bloquea ADR-027 v2
- [ ] 2FA opcional activable (ver Acción §6) — pendiente P1, bloquea ADR-027 v2
- [ ] Endpoints `/me/consents` (ver Acción §7) — pendiente P0 (stakeholder feature gates en F2)
- [ ] Tabla `audit.stakeholder_access_log` (ver Acción §8) — pendiente P0

### Bloqueadores explícitos para activación de cobro (ADR-027 v2)

ADR-027 declara que la activación de comisión real requiere ADR explícito + acciones contractuales. Adicionalmente, este ADR-028 declara estos bloqueadores técnicos de auth/RBAC:

- [ ] Acción §4 (token revocation) completada
- [ ] Acción §6 (2FA opcional) completada y comunicada a usuarios activos
- [ ] Acción §1 (auditoría IDOR) cerrada con fix de cualquier endpoint vulnerable encontrado
- [ ] Acción §8 (audit log de accesos ESG) operativo con sink BigQuery

---

## Notas

- Este ADR es **pre-monetización**. Antes de procesar dinero (ADR-027 v2), las "Acciones derivadas" P0 + P1 deben estar verde.
- Firebase fue elegido pragmáticamente y el lock-in es real. Si en algún momento se decide migrar (Supabase, Auth0, Cognito, propia), debe haber ADR superseding con análisis de costo de migración + ventana de coexistencia (ambos IdPs activos).
- Los stakeholders ESG son un **diferenciador comercial** vs competidores (BlackGPS, Mudafy, FlexMove, Tennders no tienen modelo similar). El consent-based access es lo que permite que un auditor externo o un mandante corporativo acceda a data privada de la cadena con grant explícito y trazable, sin abrir el RBAC general.
- El gap entre "rol = puerta" (v1) y "permission-based discreto" (futuro) es razonable. Cuando un cliente lo pida, no romperá el modelo: se introduce una tabla `permissions` + `role_permissions` y los handlers consultan `hasPermission(user, 'X')` en lugar de `user.role === 'admin'`. Refactor mecánico pero amplio.
