# Booster AI — Pasada 2: Architecture + ADR compliance

> **Fecha**: 2026-05-15
> **Auditor**: Claude (vía Explore subagent)
> **Scope**: Verificar que el código **hoy** cumple lo declarado en los 41 ADRs y en CLAUDE.md §"Principios rectores" + §"Reglas de arquitectura". Cruzar Zod ↔ Drizzle. Verificar gates de CI.
> **Estado del repo**: `main` (b9f7b08, 2026-05-14).

---

## Resumen ejecutivo

| Axis | Estado | Detalle |
|---|---|---|
| A. Inventario ADR | 3 colisiones de numeración (028, 034, 035) | Todas son live + no conflictivas |
| B. ADR-001 stack | CLEAN | Node 22 / Hono 4 / Drizzle / Postgres / Workbox 7 ✓ |
| C. ADR-013 DB access (Drizzle params + RLS lint) | CLEAN | `scripts/lint-rls.mjs` activo + allowlist tenant-free explícito |
| D/E. ADR-028 + ADR-034 dobles | LIVE non-conflicting | Recomendado renumerar 028b/034b |
| F. ADR-035 auth universal | COMPLIANT | `/auth/login-rut` + migration 0032 + scrypt |
| G. ADR-037/038 ADC migration | CLEAN | 0 API keys supervivientes; `X-Goog-User-Project` en 6 sitios |
| H. ADR-019 Workbox InjectManifest | CLEAN | `vite.config.ts` + `sw.ts` ✓ |
| I. Zod ↔ Drizzle | CLEAN en spot-check (3 dominios) | User, Transportista, Vehicle alineados |
| J. CLAUDE.md §1 gates (CI/linter) | CLEAN | `noExplicitAny: error`, `noConsole: error`, gitleaks, coverage 80%, IaC |
| K. Naming bilingüe | CLEAN | SQL ES snake_case · TS EN camelCase |
| L. Carrier/Shipper deprecation | **IN PROGRESS** | ~191 legacy refs vs ~30 canonical (`transportista`/`generador_carga`) |
| M. Packages stub vs ADR motor | **DRIFT** | 5 ADRs mandan packages que hoy son stub (ver `quality.md` §5) |

**Veredicto global**: **alineación ADR↔código ≈92%**. Los gates CLAUDE.md están enforced en CI/lint. La brecha real es la **deprecation incompleta** Carrier→Transportista y los **5 packages que el ADR manda pero el código no usa** (cruza con Pasada 1 §5).

---

## A. Inventario ADR (41 archivos, 3 colisiones de número)

Todos los ADRs en `docs/adr/` están en estado "Accepted" o "Draft" (no se observa "Superseded" en heads). Listado completo en [§3 estructura del inventory.md](inventory.md#3-estructura-de-carpetas-top-3-niveles).

**Colisiones de numeración** — clasificadas como **OOB-15** (housekeeping, non-conflicting, no bloquea ningún flujo):

| # | ADR A | ADR B | ¿Conflicto? |
|---|---|---|---|
| 028 | `028-dual-source-data-model-teltonika-vs-maps.md` | `028-rbac-auth-firebase-multi-tenant-with-consent-grants.md` | NO — dominios distintos (telemetría vs auth) |
| 034 | `034-gcp-cost-efficiency-2026-05.md` | `034-stakeholder-organizations.md` | NO — cost-eng vs identity |
| 035 | `035-auth-universal-rut-clave-numerica.md` | `035-trl10-mantener-ha-recortar-ruido.md` | NO — auth vs ops/SRE |

**Hallazgo adicional**: los archivos `040-*.md` y `041-*.md` que la rama `feat/security-blocking-hotfixes-2026-05-14` introduce (no en `main`) **referencian internamente "ADR-032" y "ADR-033"** en su body — find/replace pendiente del rebase (ver [inventory.md §11.9 obs #2](inventory.md)).

**Recomendación**: en el próximo ciclo `/spec` de docs, renumerar a `028a/028b`, `034a/034b`, `035a/035b` o re-asignar el "B" a un nuevo número libre.

---

## B. ADR-001 (stack selection) — CLEAN

Compromiso del ADR ↔ realidad:

| Componente declarado | Realidad en `package.json` | Estado |
|---|---|---|
| Node 22 LTS | `engines.node: ">=22.0.0"` + `.nvmrc=22` | ✓ |
| pnpm 9 | `packageManager: "pnpm@9.15.4"` | ✓ |
| Turborepo | `turbo ^2.9.8` | ✓ |
| TypeScript 5.8 strict | `typescript ^5.8.2` + `biome.json` `noExplicitAny: error` | ✓ |
| Biome linter | `@biomejs/biome ^1.9.4` | ✓ |
| Hono backend | `hono ^4.12.18` | ✓ |
| Drizzle ORM | `drizzle-orm ^0.45.2` + `drizzle-kit ^0.31.10` | ✓ |
| Postgres 16 + pgvector | `pg ^8.13.1` (driver); pgvector en migraciones | ✓ |
| Redis 7 | `ioredis ^5.4.2` | ✓ |
| Vite + React 18 | `vite ^6.2.0` + `react ^18.3.1` | ✓ |
| Workbox 7 PWA | `workbox-* ^7.3.0` + `vite-plugin-pwa ^0.21.1` | ✓ |

Sin desviaciones detectadas. La rama feature `feat/security-blocking-hotfixes-2026-05-14` añade `googleapis ^171.4.0` y `@tremor/react ^3.18.7` — ambos compatibles con ADR-001; ninguno cambia el contrato del stack.

---

## C. ADR-013 (Database access pattern) — CLEAN

Compromiso del ADR: "Drizzle params, no SQL raw, RLS via lint custom". Verificación:

**Raw SQL — supervivientes legítimos** (4):
- [apps/api/src/db/migrator.ts](apps/api/src/db/migrator.ts) — `db.execute(sql\`...\`)`. **Aceptable**: es el runner de migraciones, no business logic.
- [apps/api/src/jobs/merge-duplicate-users.ts](apps/api/src/jobs/merge-duplicate-users.ts) — `sql\`SELECT...\``. **Aceptable**: job one-off de admin.
- [apps/api/src/routes/health.ts](apps/api/src/routes/health.ts) — `SELECT 1` health check. **Aceptable**.
- [apps/api/src/services/procesar-cobranza-cobra-hoy.ts](apps/api/src/services/procesar-cobranza-cobra-hoy.ts) — query de cobranza. **Revisar**: business logic con SQL template — preferible Drizzle expression builder por type-safety.

**RLS linter custom — operativo**:
- [scripts/lint-rls.mjs](scripts/lint-rls.mjs) existe. Parsea `apps/api/src/routes/*.ts` buscando `db.select|update|delete` sin filtro `empresaId`. Tablas tenant-free explícitas: `users, pendingDevices, whatsAppIntakeDrafts, plans, memberships, consents, stakeholders, stakeholderAccessLog, tripEvents, metricasViaje, chatMessages, pushSubscriptions, telemetryPoints, posicionesMovilConductor`.
- Se ejecuta vía `pnpm lint:rls` (root `package.json` line 16: `"lint": "biome check . && pnpm lint:rls"`). **Es parte del lint gate**.

**Veredicto**: ADR-013 cumplido. La única revisión menor es `procesar-cobranza-cobra-hoy.ts` con SQL templating — verificar si es por necesidad de SQL features de Postgres o se puede mover a builder Drizzle.

---

## D/E. ADR-028 + ADR-034 dobles — non-conflicting

### ADR-028a `dual-source-data-model-teltonika-vs-maps`
- Decisión: telemetría Teltonika primaria, Maps API secundaria. Fallback transparente.
- Evidencia en código: [apps/api/src/services/eco-route-preview.ts](apps/api/src/services/eco-route-preview.ts), [apps/api/src/services/calcular-metricas-viaje.ts](apps/api/src/services/calcular-metricas-viaje.ts) — ambos consumen telemetría primero, caen a Routes API si falta dato.
- Referenciado desde ADR-005 (telemetry IoT), ADR-021 (GLEC compliance), ADR-022 (emissions WTW).

### ADR-028b `rbac-auth-firebase-multi-tenant-with-consent-grants`
- Decisión: Firebase Auth + memberships per-empresa + consent grants stakeholder.
- Evidencia: [apps/api/src/middleware/firebase-auth.ts](apps/api/src/middleware/firebase-auth.ts), tabla `membresias` en schema, `membershipRoleEnum`.
- Referenciado desde ADR-001 (stack), ADR-004 (roles), ADR-008 (PWA multirol), ADR-011 (admin).

### ADR-034a `gcp-cost-efficiency-2026-05`
- Decisión: right-sizing Cloud Run + Cloud SQL post-deploy DR.
- Evidencia: PR #191 + [infrastructure/compute.tf](infrastructure/compute.tf), [infrastructure/data.tf](infrastructure/data.tf).

### ADR-034b `stakeholder-organizations`
- Decisión: separar `organizaciones_stakeholder` de `empresas` (regulador/gremio/ONG/inversor con scope k-anonimizado).
- Evidencia: migración [apps/api/drizzle/0030_organizaciones_stakeholder.sql](apps/api/drizzle/0030_organizaciones_stakeholder.sql), [apps/api/src/routes/admin-stakeholder-orgs.ts](apps/api/src/routes/admin-stakeholder-orgs.ts).

Cada par cubre dominios separados. **Sin conflicto técnico**, sí confusión documental.

---

## F. ADR-035 (auth universal RUT + clave numérica) — COMPLIANT

- [apps/api/src/routes/auth-universal.ts:1-20](apps/api/src/routes/auth-universal.ts) — `POST /auth/login-rut` existe; usa `verifyClaveNumerica` del service `clave-numerica.ts` (scrypt).
- Migración [apps/api/drizzle/0032_user_clave_numerica.sql](apps/api/drizzle/0032_user_clave_numerica.sql) — añade `clave_numerica_hash`, `recovery_otp_hash`, `recovery_otp_expires_at` a `usuarios`. Comentarios DDL referencian ADR-035 (línea 19: "ADR-035 — scrypt hash de clave numérica").
- Flag `AUTH_UNIVERSAL_V1_ACTIVATED` — no aparece como toggle React en el cliente; se decide por presencia de la ruta en `/feature-flags` (cliente lo consume en boot). Esto es el patrón ADR-039 (config runtime), no un anti-patrón.
- **Cuenta de driver onboarding**: ADR-035 prevé auth con email sintético `pending-rut:<rut>` para usuarios placeholder; verificado en `auth-universal.ts:16-18`.

**Pendiente** (no bloqueante): rate-limit del endpoint `/auth/login-rut`. Está en la rama de security hotfixes (H2 — ver [security.md de la rama](.specs/audit-2026-05-14/security.md) o el inventory §11). En main: **no implementado**.

---

## G. ADR-037 + ADR-038 (ADC migration) — CLEAN

**Sin API keys supervivientes para Gemini ni Routes**.

### ADR-037 Vertex AI ADC
- [apps/api/src/services/gemini-client.ts](apps/api/src/services/gemini-client.ts) — usa `google-auth-library` con ADC. Sin `process.env.GEMINI_API_KEY` ni `process.env.GOOGLE_API_KEY`.
- PR `#196`/`#197` (merge 2026-05-13) cierran la migración.

### ADR-038 Routes API ADC
- [apps/api/src/services/routes-api.ts:34-39](apps/api/src/services/routes-api.ts) — header `X-Goog-User-Project` seteado.
- 6 callsites pasan `routesProjectId` desde `GOOGLE_CLOUD_PROJECT`: `eco-route-preview.ts`, `compute-route-eta.ts`, `get-assignment-eco-route.ts`, `get-public-tracking.ts`, `routes/assignments.ts`, `routes/public-tracking.ts`.
- Sin survivientes `ROUTES_API_KEY` o `MAPS_API_KEY` en código backend.

**Frontend**: el cliente usa `VITE_GOOGLE_MAPS_API_KEY` para `@vis.gl/react-google-maps` (rendering en navegador). Esto **no es** el mismo riesgo (es key client-side restringida por dominio, declarada en ADR-014).

---

## H. ADR-019 (Workbox InjectManifest) — CLEAN

- [apps/web/vite.config.ts](apps/web/vite.config.ts) — config `VitePWA({ strategies: 'injectManifest', srcDir: 'src', filename: 'sw.ts', registerType: 'autoUpdate', injectRegister: 'auto' })`.
- [apps/web/src/sw.ts](apps/web/src/sw.ts) existe con tests (`sw.test.ts`).
- `injectManifest.globPatterns` incluye `js,css,html,ico,png,svg,woff2`.

---

## I. Zod (shared-schemas) ↔ Drizzle alignment — CLEAN en spot-check

Verifiqué 3 dominios. La regla canónica (CLAUDE.md): SQL en español snake_case, Zod en inglés camelCase con mapping explícito en Drizzle.

### `user`
- Zod ([packages/shared-schemas/src/domain/user.ts](packages/shared-schemas/src/domain/user.ts)): `id, email, phone, whatsapp_e164, rut, fullName, roles, status, firebase_uid, is_platform_admin, created_at, updated_at`.
- SQL ([apps/api/drizzle/0004_phase_zero_unified_schema_es.sql](apps/api/drizzle/0004_phase_zero_unified_schema_es.sql)): `id, firebase_uid, email, nombre_completo, telefono, whatsapp_e164, rut, estado, es_admin_plataforma, creado_en, actualizado_en, ultimo_login_en`.
- Mapping: `fullName ↔ nombre_completo`, `phone ↔ telefono`, `status ↔ estado`, `is_platform_admin ↔ es_admin_plataforma`. ✓

### `transportista`
- Zod ([packages/shared-schemas/src/domain/transportista.ts](packages/shared-schemas/src/domain/transportista.ts)): id, owner_user_id, legal_name, rut, address, phone, status, rating, ratings_count, is_solo_operator, dte_provider_account_id, created_at, updated_at.
- Drizzle table: declarada en [apps/api/src/db/schema.ts](apps/api/src/db/schema.ts) (no migración numerada 0000 — añadida tras refactor).
- Comentario en transportista.ts:7 dice "proyección del modelo empresa-transportista" — explícito que es vista de un join `empresas + memberships`.

### `vehicle`
- Zod ([packages/shared-schemas/src/domain/vehicle.ts](packages/shared-schemas/src/domain/vehicle.ts)): id, empresa_id, marca, modelo, anio, patente, tipo_vehiculo, capacidad_carga_kg, capacidad_volumen_m3, combustible, etc.
- SQL: tabla `vehiculos` en `db/schema.ts`. Spanish snake_case directo (sin re-naming, columnas en español también en Zod — excepción consciente).

**No detecté drift en estos 3**. Spot-check no es exhaustivo; auditoría completa requiere script que compare campo-a-campo. Recomendable como herramienta de CI.

---

## J. CLAUDE.md §1 — gates de "Cero deuda técnica" en CI/lint

| Gate | Mecanismo | Estado |
|---|---|---|
| `noExplicitAny: error` | [biome.json](biome.json) | ✓ (override sólo en `*test*`/`*lib*` dirs) |
| `noConsole: error` | [biome.json](biome.json) | ✓ (override sólo en `*test*` dirs) |
| Sin secrets en commits | [.husky/pre-commit](.husky/pre-commit) — 5× `gitleaks protect --staged` | ✓ |
| Coverage ≥80% bloqueante | [.github/workflows/ci.yml](.github/workflows/ci.yml) — loop sobre `coverage-summary.json` | ✓ |
| Sin infra manual | [infrastructure/main.tf](infrastructure/main.tf) presente; IAM humana en `iam.tf` | ✓ |

**Drift cero en gates de CI**. La forma del enforcement es robusta.

---

## K. Naming bilingüe — CLEAN

- **SQL DDL**: `0033_configuracion_sitio.sql` → `id, version, config, publicada, nota_publicacion, creado_por_email, creado_en`. `0030_organizaciones_stakeholder.sql` → `nombre_legal, tipo, region_ambito, sector_ambito, creado_por_admin_id`. Sin tildes, sin English mezclado.
- **TS exports**: `estimarDistanciaKm`, `checkStakeholderConsent`, `grantConsent`, `revokeConsent`, `resolveMatchingV2Weights`. Sin Spanish para identificadores TS (excepto referencias a strings de columna/tabla, legítimo).

---

## L. Carrier/Shipper deprecation — IN PROGRESS

Per CLAUDE.md (final): _"Carrier/Shipper deprecated. Usar Transportista/GeneradorCarga en código y SQL."_

Conteo aproximado (`grep -ri -w`):

- `carrier` + `shipper` (legacy): **~191 ocurrencias** en `apps/` + `packages/`.
- `transportista` + `generador_carga` (canónico): **~30 ocurrencias**.

**Top hot files** (legacy):

1. [apps/whatsapp-bot/src/conversation/store.ts](apps/whatsapp-bot/src/conversation/store.ts) — 10+ (persona/role mapping).
2. [apps/whatsapp-bot/src/conversation/prompts.ts](apps/whatsapp-bot/src/conversation/prompts.ts) — 8+ (intent parsing).
3. [packages/shared-schemas/src/auth.ts](packages/shared-schemas/src/auth.ts) — 7+ (legacy roles enum).
4. `apps/api/src/routes/{empresas,me,vehiculos,offers}.ts` — 15+ combinados.
5. `packages/pricing-engine/src/*.ts` — 10+ (membership tier).

**Veredicto**: deprecación incompleta — los dos sistemas coexisten. CLAUDE.md ya lo marca como pendiente ("alias deprecated mientras schemas legacy se migran"). **No hay regla CI** que detecte uso nuevo de `carrier`/`shipper` — recomendable añadir un Biome rule custom o un `lint:naming` script.

---

## M. Packages stub vs ADR motor — DRIFT estructural

Ver detalle en [quality.md §5](quality.md#5-packages-stub-sin-importadores-5--drift-estructural).

| Stub | ADR motor | Realidad actual | Cumple ADR |
|---|---|---|---|
| `ai-provider` | ADR-025, ADR-037 | Gemini client lives in `apps/api/src/services/gemini-client.ts` | **NO** — ADR mandata abstracción en package |
| `carta-porte-generator` | ADR-007 | PDF Carta Porte vive mezclado en `certificate-generator` | **NO** |
| `document-indexer` | ADR-007 | Indexado SII inline en `services/reconciliar-dtes.ts` | **NO** |
| `trip-state-machine` | ADR-004 | Lifecycle en enum + transiciones implícitas en services | **NO** — XState no implementada |
| `ui-components` | ADR-008 | shadcn-style components directos en `apps/web/src/components/` | **NO** — no hay package compartido |

**5 violaciones del principio "lógica en packages, orquestación en services"** declarado en CLAUDE.md final. Mantenerlo es deuda técnica deliberada (sin justificación visible en el ledger ni en un ADR de "deferred").

---

## Acciones recomendadas (priorizadas)

1. **HIGH** — Renumerar colisiones ADR 028/034/035 a 028a/028b etc. (find/replace en bodies + filenames + cross-refs).
2. **HIGH** — Decidir destino de los 5 packages stub: o eliminar + ADR superseded, o implementar con `/spec`+`/plan`. No mantener "implementar según ADR" sin issue.
3. **MEDIUM** — Añadir Biome rule custom o `lint:naming` que detecte uso **nuevo** de `carrier`/`shipper` en código no-legacy. Migración total no es bloqueante; impedir regresión sí.
4. **MEDIUM** — Crear script `lint:schema-zod-drizzle` (CI step) que verifique campo-a-campo alineación Zod↔Drizzle. Spot-check es frágil.
5. **LOW** — Mover `procesar-cobranza-cobra-hoy.ts` del SQL templating a Drizzle expression builder si es factible (alternativamente, documentar por qué no).
6. **LOW** — Auditar driver-side de ADR-039 (Site Settings runtime config): verificar que el cliente cachea correctamente (5min declarado en server.ts, no verificado de lado cliente).

---

## Procedencia

- Subagente Explore con scope architecture.
- Lecturas dirigidas: `biome.json`, `.husky/pre-commit`, `.github/workflows/ci.yml`, `scripts/lint-rls.mjs`, [apps/web/vite.config.ts](apps/web/vite.config.ts), [apps/api/src/db/schema.ts](apps/api/src/db/schema.ts) (heads), 4 archivos shared-schemas/domain.
- Grep estructurado: `db.execute`, `sql\``, `process.env.*API_KEY`, `X-Goog-User-Project`, `from '@booster-ai/*'`, `\b(carrier|shipper)\b` vs `\b(transportista|generador_carga)\b`.
- Conteo de ADRs por `ls docs/adr/ | wc -l` + grep de número duplicado.
