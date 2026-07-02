# consent-idor-y-modelo-19628-21719 — Spec (Frente F1)

**Frente del programa**: F1 de `.specs/pivote-documental-y-cierre-legal-2026-06/spec.md`
**Fecha**: 2026-06-17
**Status**: **Draft — pendiente aprobación PO** (no ejecutar Fase Act sin firma en §Approval)
**PO**: Felipe Vicencio — dev@boosterchile.com
**Cierra**: P0-B (IDOR en `portafolio_viajes`) + P1-B (IDOR cross-empresa en scopes de empresa) de la auditoría 2026-06-14.
**Relacionado**: ADR-028 (RBAC + consent grants), ADR-034 (organizaciones stakeholder). ADR-068 (nuevo) vincula el modelo legal al schema `consents`.

> Este es el spec de un frente, TDD-ready. La matriz de tests (§Test list) es lo primero a escribir; el código va red→green→refactor. Es dominio crítico (auth/consent) → TDD obligatorio (`booster-skills:tdd-dominio-critico`).

> **O-1b RESUELTA (decisión PO 2026-06-17)**: `portafolio_viajes` se **deniega siempre** (deny real). No hay tabla de portafolio, ni FK, ni call sites — no se infiere autoridad sobre una feature inexistente. `userCanGrantOnScope` devuelve `false` para todo grant `portafolio_viajes`, con `TODO`/backlink a la futura decisión de Producto (probablemente lista explícita de viajes, cuando exista la tabla). Esta decisión **reemplaza** el default "scope_id = empresa" que aparece en versiones previas de §7.1/§10/§11: donde el texto asuma ese default, prevalece el deny-always. No se toca ADR-053.

---

## 1. Objective

Cerrar la vulnerabilidad IDOR en el otorgamiento de consentimientos ESG y versionar en el repo el modelo legal de consentimiento conforme Ley 19.628 + Ley 21.719.

Hoy, en `apps/api/src/routes/me-consents.ts`, la función `userCanGrantOnScope` (líneas 80-107) **no valida** que el otorgante tenga autoridad sobre la empresa/portafolio concretos del `scope_id`:

- **P1-B (líneas 98-106)**: para scopes `organizacion` / `generador_carga` / `transportista`, la query carga las memberships del user **sin filtrar por `empresaId === scopeId`** y devuelve `true` si el user es `dueno`/`admin` de *cualquier* empresa. → un dueño de empresa A otorga grants ESG sobre la empresa B.
- **P0-B (líneas 85-95)**: para `portafolio_viajes`, basta tener *una* membership cualquiera (ni siquiera `dueno`/`admin`, ni siquiera `activa`) para que devuelva `true`. → cualquier miembro de cualquier empresa otorga acceso a un portafolio arbitrario.

El fix endurece `userCanGrantOnScope` para que valide ownership real contra la empresa específica del scope, y para `portafolio_viajes` contra las empresas dueñas de los trips. Adicionalmente versiona el modelo de consentimiento en `docs/legal/` y añade columnas de evidencia 21.719 al schema `consents` (O-1, default del PO: añadir columnas).

## 2. Why now

- La 21.719 entra en vigencia el **01-dic-2026** (~5.5 meses). El flujo de consentimiento debe ser conforme antes.
- El modelo legal conforme (`Modelo_Consentimiento_ESG_Booster.docx`, `Aviso_Privacidad_Corto_Booster.md`) ya existe — era el único bloqueo declarado de P0-B/P1-B.
- IDOR es severidad **High** en ADR-028 §"Riesgos conocidos" (acción derivada §1/§2, pendiente P0). Es un hallazgo de acceso real, no teórico: el endpoint `POST /me/consents` está vivo y montado.

## 3. Success criteria (measurable)

- [ ] `pnpm --filter @booster-ai/api test` verde con la nueva matriz IDOR (§Test list) cubriendo P0-B y P1-B.
- [ ] `pnpm --filter @booster-ai/api lint` 0 errores, `typecheck` 0 errores.
- [ ] Coverage ≥80% en `me-consents.ts` (líneas/branches/funciones) sobre código nuevo.
- [ ] `userCanGrantOnScope` para scopes de empresa filtra por `eq(memberships.empresaId, scopeId)` **AND** `eq(memberships.userId, userId)` **AND** `eq(memberships.status, 'activa')` **AND** `inArray(memberships.role, ['dueno','admin'])`.
- [ ] `userCanGrantOnScope` para `portafolio_viajes` **deniega siempre** (deny real, O-1b): cualquier grant de ese scope → `403`, independiente de la membership del otorgante.
- [ ] El error en denegación sigue siendo `403 { error: 'forbidden_scope_authority', code: 'forbidden_scope_authority' }` (string verificado en `me-consents.ts:138`).
- [ ] Modelo de consentimiento versionado en `docs/legal/modelo-consentimiento-esg-v1.md` + `docs/legal/aviso-privacidad-corto-v1.md`, ambos con marca de borrador (campos `[ ]` + sign-off de abogado pendientes — O-6, dependencia externa).
- [ ] Migración Drizzle nueva (siguiente número libre) añade a `consentimientos` las columnas de evidencia 21.719: `version_aviso`, `ip_otorgamiento`, `user_agent_otorgamiento` (todas nullable, sin default), y `grantConsent` las persiste.
- [ ] ADR-068 mergeado vinculando modelo legal ↔ schema `consents` (lo escribe F1; este spec no lo redacta, solo lo referencia).

## 4. User-visible behaviour

| Actor | Antes | Después |
|---|---|---|
| Otorgante de consent ESG (dueño/admin de empresa A) | Puede crear grants sobre **cualquier** empresa si es dueño/admin de *alguna* | Solo sobre la empresa A (scope que matchea su membership); empresa B → `403 forbidden_scope_authority` |
| Otorgante sobre `portafolio_viajes` | Basta *cualquier* membership (incluso `conductor`, incluso no-activa) | **Siempre `403`** — scope deshabilitado hasta que Producto defina el modelo (O-1b) |
| Otorgante legítimo (dueño de la empresa correcta) | `201` | `201` (sin regresión) |
| Revocador de consent ajeno | `403 forbidden_not_grantor` (ya correcto, no cambia) | `403 forbidden_not_grantor` (no regresión) |
| Otorgante (evidencia) | Solo se guarda `consentDocumentUrl` | Se guarda además versión del aviso, IP confiable y user-agent del otorgamiento |

No cambia el contrato HTTP público (mismos códigos, mismos `code` strings, mismo body de request). El único endurecimiento es de autorización: requests que **antes pasaban indebidamente** ahora devuelven `403`. Esto es deliberado y es el fix.

## 5. Out of scope

- **F1b — flujo de captura de consentimiento en signup** (`apps/web` casillas sin premarcar + backend de evidencia del flujo de registro): se dimensiona en §"Sub-fase F1b" y se decide **PR separado**. No entra en este PR.
- **Completar los campos `[ ]` del modelo/aviso y el sign-off de abogado**: responsabilidad PO/legal (O-6, dependencia externa). El versionado se hace con marca de borrador.
- **Consumidores de `checkStakeholderConsent`**: hoy no existe ningún handler que sirva data ESG a stakeholders (grep confirma: solo el servicio, la ruta y el schema referencian el consent). El fix es del **otorgamiento** (`POST /me/consents`), no del consumo. La superficie de lectura ESG es F2 del roadmap de stakeholder, fuera de este frente.
- **Refactor del modelo de `portafolio_viajes`** (crear una tabla de portafolio real): ver O-1b. Este spec valida sobre el modelo existente sin introducir tabla nueva, salvo que el PO resuelva O-1b en sentido contrario.
- **DROP de columnas**: la migración solo añade columnas nullable (expand-only, compatible con el guard CI expand/contract de P1-H).

## 6. Constraints

- **Stack Booster no-negociable** (CLAUDE.md): zero `any`, Zod en boundaries, `@booster-ai/logger`, OTel + `trace_id`, coverage ≥80%, Conventional Commits con scope, sección `## Evidencia` en el PR.
- **Naming bilingüe**: columnas SQL en español snake_case sin tildes (`version_aviso`, `ip_otorgamiento`, `user_agent_otorgamiento`); identifiers TS en inglés camelCase (`noticeVersion`, `grantIp`, `grantUserAgent`). La tabla canónica de orden de transporte es `viajes`.
- **Domain canónico** en `packages/shared-schemas/src/domain/`; DDL Drizzle canónico en `apps/api/src/db/schema.ts`. La tabla `consents` ya existe; el cambio es aditivo.
- **TDD obligatorio** (`tdd-dominio-critico`): auth/consent es dominio crítico → red-green-refactor. La matriz de tests va antes del fix.
- **Migración expand-only**: solo `ADD COLUMN ... NULL` (sin default, sin NOT NULL, sin DROP). Compatible con el guard CI expand/contract (P1-H, #491) y con la estrategia de rollback de migraciones.
- **Numeración de migración**: el plan maestro reserva 0043 a PR #428 abierto. **Tomar el siguiente número libre al ejecutar** (verificar `apps/api/drizzle/meta/_journal.json`; el último aplicado es 0042). No fijar el número en este spec.
- **No tocar** `firebase-auth.ts` ni la cadena de middlewares: el fix es local a `userCanGrantOnScope`.
- **ADRs antes de implementar**: ADR-068 se redacta en F1; no se edita ADR-028/034, se complementan.

## 7. Approach

### 7.1 Fix IDOR (TDD-first) — `apps/api/src/routes/me-consents.ts`

La función `userCanGrantOnScope` (líneas 80-107) se reescribe. Imports a añadir desde `drizzle-orm`: `and`, `inArray` (hoy solo importa `eq` — `me-consents.ts:3`). **No** se importa `trips`: P0-B (`portafolio_viajes`) deniega sin consultar la BD (O-1b); P1-B solo usa `memberships` (ya importado vía `../db/schema.js`).

#### P1-B — scopes de empresa (`organizacion` / `generador_carga` / `transportista`)

El `scope_id` apunta a `empresas.id`. La validación correcta filtra la membership por la empresa específica del scope:

```ts
// reemplaza me-consents.ts:98-106
const rows = await opts.db
  .select({ id: memberships.id })
  .from(memberships)
  .where(
    and(
      eq(memberships.userId, opts2.userId),
      eq(memberships.empresaId, opts2.scopeId),
      eq(memberships.status, 'activa'),
      inArray(memberships.role, ['dueno', 'admin']),
    ),
  )
  .limit(1);

return rows.length > 0;
```

Nombres de columna verificados contra el schema:
- `memberships.userId` → `usuario_id` (schema.ts:708).
- `memberships.empresaId` → `empresa_id` (schema.ts:716, nullable por XOR con `organizacion_stakeholder_id`).
- `memberships.status` → `estado`, enum `estado_membresia` con valor `'activa'` (schema.ts:80-85, 727).
- `memberships.role` → `rol`, enum `rol_membresia` con valores `'dueno'`/`'admin'` entre 6 (schema.ts:71-78, 726).

Nota: como `empresaId` es nullable (memberships de stakeholder tienen `empresaId = NULL`, `organizacion_stakeholder_id` set), `eq(memberships.empresaId, scopeId)` excluye correctamente las memberships de organización stakeholder (NULL nunca matchea un UUID). Eso es lo deseado: un stakeholder no otorga grants sobre empresas.

#### P0-B — `portafolio_viajes` (deny real — decisión PO O-1b, 2026-06-17)

El `scope_id` para `portafolio_viajes` es un UUID **sin FK** (`consents.scopeId` → `alcance_id uuid NOT NULL`, schema.ts:1439; sin `references()`). **No existe tabla de portafolio** en el código (grep de `portafolio` solo encuentra el enum, los comentarios, el schema Zod del body y la lógica laxa), ni call sites reales que creen grants de este tipo.

**Decisión del PO (O-1b, 2026-06-17): denegar siempre.** No se infiere semántica de autorización sobre una feature que no está construida. `userCanGrantOnScope` devuelve `false` para todo grant `portafolio_viajes` (deny real, no default de config), hasta que Producto defina el modelo — probablemente lista explícita de viajes (Opción 2 de O-1b) cuando exista la tabla. Es la forma más segura de cerrar el IDOR P0-B: superficie cero.

```ts
// reemplaza me-consents.ts:85-95
if (opts2.scopeType === 'portafolio_viajes') {
  // O-1b (decisión PO 2026-06-17): el modelo de portafolio NO está construido
  // (sin tabla, sin FK, sin call sites). No se infiere autoridad sobre una
  // feature inexistente → se deniega TODO grant de este scope hasta que
  // Producto defina el modelo.
  // TODO(O-1b): al crear la tabla de portafolio (lista explícita de viajes),
  // validar que TODAS las empresas dueñas de los viajes estén entre las
  // memberships dueno/admin activas del otorgante (join viajes→memberships).
  // Ref: .specs/consent-idor-y-modelo-19628-21719/spec.md §7.1 P0-B.
  return false;
}
```

Bajo esta decisión, el fix de P0-B **no** consulta `viajes` ni `empresas`, por lo que **se elimina** el cambio "añadir `trips` al import de schema" de la lista de cambios clave. Solo `and` e `inArray` (para P1-B) se añaden al import de `drizzle-orm`. La matriz de tests verifica que **cualquier** grant `portafolio_viajes` → `403 forbidden_scope_authority`, independiente de la membership del otorgante.

### 7.2 Gap modelo↔schema (O-1) — columnas de evidencia 21.719

La 21.719 exige **evidencia verificable** de cada aceptación: identidad del titular, finalidades marcadas, fecha/hora, **versión del aviso**, e **IP/dispositivo** (`Aviso_Privacidad_Corto_Booster.md:39`). Estado actual de `consentimientos` (schema.ts:1428-1454):

| Requisito 21.719 | Cubierto hoy | Cómo |
|---|---|---|
| Identidad del titular | Sí | `grantedByUserId` → `otorgado_por_id` (FK usuarios) + `stakeholderId` |
| Finalidades marcadas (granular) | Sí | `dataCategories` array (enum `categoria_dato_consentimiento`, ≥1 por CHECK) |
| Fecha/hora | Sí | `grantedAt` → `otorgado_en` (default now) |
| **Versión del aviso** | **No** | — |
| **IP / dispositivo** | **No** | — |
| Documento firmado | Sí | `consentDocumentUrl` → `documento_consentimiento_url` |
| Revocación | Sí | `revokedAt` → `revocado_en` |

**Decisión (default del PO en O-1): añadir columnas.** Hay precedente exacto en el repo: `carrier_memberships` ya guarda evidencia de consentimiento Ley 19.628 con `consent_terms_v2_ip` (text), `consent_terms_v2_user_agent` (text), capturados con `extractClientIp(c.req.header('x-forwarded-for'))` + `c.req.header('user-agent')` (me.ts:567-583, schema.ts:1896-1898). Se replica el patrón en `consentimientos`.

Migración Drizzle (siguiente número libre, expand-only):

```sql
-- ADD COLUMNs de evidencia 21.719 a consentimientos. Nullable, sin default:
-- los consents existentes (si los hubiera) no tienen esta evidencia y no se
-- backfillean (no se puede inventar evidencia retroactiva). Expand-only,
-- compatible con guard expand/contract (P1-H).
ALTER TABLE "consentimientos" ADD COLUMN "version_aviso" varchar(20);
ALTER TABLE "consentimientos" ADD COLUMN "ip_otorgamiento" text;
ALTER TABLE "consentimientos" ADD COLUMN "user_agent_otorgamiento" text;
```

Cambio en `schema.ts` (tabla `consents`, tras `consentDocumentUrl` línea 1444):

```ts
noticeVersion: varchar('version_aviso', { length: 20 }),
grantIp: text('ip_otorgamiento'),
grantUserAgent: text('user_agent_otorgamiento'),
```

Cableado:
- `grantBodySchema` (me-consents.ts:31) añade `notice_version: z.string().min(1).max(20).optional()` (la versión del aviso que el cliente vio; opcional mientras el flujo F1b no esté vivo).
- El handler `POST /me/consents` captura `grantIp = extractClientIp(c.req.header('x-forwarded-for'))` (null si `'unknown'`) y `grantUserAgent = c.req.header('user-agent') ?? null`, replicando me.ts:571-573.
- `GrantOpts` (consent.ts:139) y `grantConsent` (consent.ts:162) reciben y persisten `noticeVersion`, `grantIp`, `grantUserAgent` en el INSERT (consent.ts:170-181).

Las 6 finalidades granulares (una casilla por finalidad) ya están modeladas como `dataCategories` (array de `categoria_dato_consentimiento`: `emisiones_carbono`, `rutas`, `distancias`, `combustibles`, `certificados`, `perfiles_vehiculos` — schema.ts:382-389). **No se requiere columna nueva para finalidades**; el CHECK `array_length >= 1` ya impide grant sin finalidad. El versionado del documento legal (cada cambio de finalidades reinforma) se ata vía `noticeVersion` + el doc versionado en `docs/legal/`.

### 7.3 Versionado del modelo legal en `docs/legal/`

Copiar (convirtiendo el `.docx` a Markdown con `textutil -convert txt` o `anthropic-skills:docx`) los dos documentos a `docs/legal/`, siguiendo la convención de versionado del directorio (`*-v1.md`, `*-v2.md` ya presentes: `terminos-de-servicio-v2.md`, `adendum-cobra-hoy-v1.md`):

- `docs/legal/modelo-consentimiento-esg-v1.md` (de `Modelo_Consentimiento_ESG_Booster.docx`).
- `docs/legal/aviso-privacidad-corto-v1.md` (de `Aviso_Privacidad_Corto_Booster.md`).

Ambos llevan al inicio una marca de estado (el aviso ya la trae en su línea 3):

```markdown
> **BORRADOR LEGAL** — los campos entre corchetes `[ ]` y el sign-off de
> abogado habilitado están **pendientes** (O-6, dependencia externa PO/legal).
> No publicar ni invocar como texto final hasta completar. La `version_aviso`
> registrada en `consentimientos` debe coincidir con la versión vigente de
> este archivo.
```

El campo `noticeVersion`/`version_aviso` se setea con el slug de versión del archivo vigente (ej. `"esg-v1"`).

### 7.4 ADR-068 (lo redacta F1, fuera del detalle de este spec)

ADR-068: "Modelo de consentimiento ESG conforme Ley 19.628 + Ley 21.719". Vincula el texto legal versionado (`docs/legal/`) al schema `consents`: finalidades = `dataCategories`; evidencia = `grantedByUserId`/`grantedAt`/`noticeVersion`/`grantIp`/`grantUserAgent`/`consentDocumentUrl`; revocación = `revokedAt`. Complementa ADR-028 §4 y ADR-034; no los edita.

## 8. Sub-fase F1b — flujo de captura en signup (dimensionamiento + decisión)

**Qué es**: el flujo de registro (`apps/web`) que presenta las casillas de consentimiento sin premarcar (acción afirmativa, finalidades granulares, prohibición de tácito) y el backend que persiste la evidencia de esa aceptación de registro.

**Alcance estimado**:
- `apps/web`: componente de registro con 1 casilla obligatoria + ≥2 opcionales separadas (`Aviso_Privacidad_Corto_Booster.md:23-31`), todas `defaultChecked={false}`, validación que bloquea submit si la obligatoria no está marcada, enlace a la Política completa.
- Backend: endpoint/columnas para registrar la evidencia de la aceptación de registro (distinta del grant ESG a stakeholder — es el consentimiento del titular sobre el tratamiento de sus propios datos). Probablemente una tabla/columnas nuevas (no `consentimientos`, que es para grants a terceros), reusando el patrón de `carrier_memberships` (ip/user-agent/version/timestamp). Requiere su propio modelo de datos y ADR.

**Decisión: PR separado, NO en este PR.** Justificación:
1. **Superficie distinta**: F1b toca `apps/web` (UI) + un modelo de datos nuevo (consentimiento del titular en registro), ortogonal al fix IDOR (autorización de grants a terceros en `consentimientos`). Mezclarlos infla el diff y el riesgo de regresión auth (R-1).
2. **El fix IDOR no depende de F1b**: P0-B/P1-B se cierran solo con el endurecimiento de `userCanGrantOnScope` + las columnas de evidencia en `consentimientos`. F1b es el flujo *de registro*, no el de *otorgamiento de grants*.
3. **Dependencia legal externa (O-6)**: el copy exacto de las casillas y la Política completa dependen del sign-off de abogado, aún pendiente. Versionar el borrador (este PR) desbloquea, pero cablear la UI con texto no-final sería trabajo a rehacer.
4. **El PO puede aprobar frentes selectivamente** (plan maestro §12). F1b se levanta como `.specs/<slug>/` propio cuando O-6 esté resuelto.

Este PR deja **preparado** el lado de evidencia en `consentimientos` (columnas + captura ip/ua/version en `grantConsent`) para que F1b no tenga que migrar de nuevo esa tabla; F1b agrega su propio modelo para el consentimiento de registro.

## 9. Risks

| ID | Riesgo | L | I | Mitigación |
|---|---|---|---|---|
| R-1 | El fix rompe otorgamientos legítimos (regresión auth) | M | H | Matriz IDOR TDD-first con happy path explícito (dueño de la empresa correcta → 201); el test `happy path` existente (me-consents.test.ts:175-189) debe seguir verde tras adaptar su stub al nuevo shape de query |
| R-2 | El stub de DB de los tests (`makeDbStub`, me-consents.test.ts:36-75) no refleja el nuevo `where(and(...))` y da falsos verdes | M | M | Los tests consumen las queues `selects` por orden de llamada, no inspeccionan el `where`; reescribir los casos para alinear el número/orden de SELECTs del nuevo flujo (P1-B = 2 selects: resolveUser + membership; portafolio = 2-3) |
| R-3 | Modelo de `portafolio_viajes` ambiguo → fix valida sobre interpretación equivocada | — | — | **Eliminado por O-1b**: deny-always no infiere modelo; cuando Producto lo defina, el `TODO`/backlink guía la implementación segura |
| R-4 | Modelo legal es borrador (campos `[ ]`, sin sign-off) → versionar algo no-final | M | M | Marca de borrador explícita en ambos docs; el fix de código es independiente del texto (O-6) |
| R-5 | Columnas nuevas sin backfill dejan consents existentes sin evidencia | L | L | Nullable sin default por diseño (no se inventa evidencia retroactiva); no hay consents en prod hoy (endpoint recién montado) — verificar antes de migrar |
| R-6 | Migración no expand-safe rompe guard CI (P1-H) | L | M | Solo `ADD COLUMN ... NULL`; sin DROP/NOT NULL/default; verificar contra el guard expand/contract |

## 10. Alternatives considered (rejected)

- **Validar autoridad en el service `grantConsent` en vez del handler**: rechazado. El patrón del repo (consent.ts:155-161, me-consents.ts:124-139) pone la validación de autoridad en el handler para mejor error messaging; el service confía en el caller. Mantener la convención.
- **No añadir columnas, usar solo `consentDocumentUrl`**: rechazado por el PO (O-1 default = añadir columnas). La 21.719 exige IP/dispositivo + versión como evidencia verificable; un PDF externo no es consultable/auditable en BD ni garantiza esos campos.
- **Modelar `portafolio_viajes` con tabla explícita ahora**: rechazado para este PR (alcance). Se deja como O-1b; el default `scope_id=empresa` cierra el IDOR sin tabla nueva.
- **Backfill de evidencia en consents existentes**: rechazado. No se puede inventar IP/versión retroactiva; nullable es lo correcto.
- **Meter F1b (UI signup) en este PR**: rechazado (§8): infla diff, depende de O-6, mezcla dos modelos de consentimiento distintos.

## 11. Test list (TDD — escribir PRIMERO)

Archivo: `apps/api/test/unit/me-consents.test.ts` (extender la suite existente; reusar `makeDbStub` y `buildApp`). Casos rojo→verde. Códigos de error verificados contra `me-consents.ts`.

**P1-B — IDOR cross-empresa (scopes de empresa):**

1. **dueño de empresa A otorga sobre empresa B → 403 `forbidden_scope_authority`**. Stub: `resolveUserId`→`[{id: USER_ID}]`; query de membership filtrada por `empresaId=scopeId` (empresa B) devuelve `[]` (el user no tiene membership en B). Espera `403`, `code === 'forbidden_scope_authority'`.
2. **admin de la empresa del scope → 201**. Stub: membership query devuelve `[{id: 'm1'}]`; insert devuelve `[{id: 'new-consent-uuid'}]`. Espera `201`, `consent_id` presente.
3. **dueño pero membership `suspendida`/`removida` (no `activa`) sobre la empresa correcta → 403**. Bajo el nuevo `where`, la query filtra `status='activa'` → devuelve `[]`. Espera `403 forbidden_scope_authority`. (Caso nuevo: el código viejo no filtraba status correctamente en el branch de empresa.)
4. **conductor / visualizador de la empresa del scope → 403**. La query filtra `role IN ('dueno','admin')` → `[]`. Espera `403`. (Refina el test existente me-consents.test.ts:144-160 que solo cubría "ninguna empresa".)

**P0-B — IDOR `portafolio_viajes`:**

5. **portafolio_viajes con otorgante dueño/admin de la empresa `scope_id` → 403** (deny real). Aunque el user sea `dueno`/`admin` activo de `scope_id`, el branch deniega siempre (O-1b). Espera `403 forbidden_scope_authority`. (Caso clave: prueba que el deny es real, no condicional a la membership.)
6. **portafolio_viajes con `scope_id` arbitrario / sin membership → 403**. Espera `403 forbidden_scope_authority`.
7. **portafolio_viajes deniega ANTES de tocar la BD**. Verificar (vía el stub `makeDbStub`) que el branch portafolio **no consume** ningún SELECT extra (no consulta `viajes` ni `memberships`). Regresión de la decisión O-1b: deny temprano, superficie cero.
8. _(reservado para O-1b futura)_ — cuando Producto adopte "lista explícita de viajes" y exista la tabla `portafolios_viajes`, reactivar: portafolio con un viaje de empresa ajena → `403`; portafolio con todos los viajes de empresas propias → `201`.

**No-regresión (ya cubiertos, deben seguir verdes tras adaptar stubs):**

9. request sin claims → 500 (me-consents.test.ts:120-129).
10. user no registrado → 404 `user_not_registered` (me-consents.test.ts:131-142).
11. `expires_at` en el pasado → 400 `expires_at_must_be_future` (me-consents.test.ts:162-173). Adaptar el stub de membership al nuevo shape.
12. `data_categories` vacío → 400 (zod) (me-consents.test.ts:191-200).
13. `consent_document_url` no-HTTPS → 400 (zod refine) (me-consents.test.ts:202-211).
14. **revoke de consent ajeno → 403 `forbidden_not_grantor`** (me-consents.test.ts:242-254). No cambia, pero se mantiene como guardia de no-regresión (P0-B/P1-B son de otorgamiento, no de revocación).
15. revoke happy path → 200 `{revoked:true}` (me-consents.test.ts:256-269); idempotente → 200 `{already_revoked:true}` (me-consents.test.ts:271-288).

**Evidencia 21.719 (columnas nuevas):**

16. **grant exitoso persiste `noticeVersion`/`grantIp`/`grantUserAgent`**. Request con header `x-forwarded-for: '1.1.1.1, 2.2.2.2'` y `user-agent`, body con `notice_version: 'esg-v1'`. Verificar (vía spy en el stub de `insert().values()`) que se pasan `grantIp='1.1.1.1'` (penúltima entry, `extractClientIp`), `grantUserAgent`, `noticeVersion='esg-v1'`. (Nuevo.)
17. **grant sin XFF / sin user-agent persiste nulls** (no rompe). `grantIp=null`, `grantUserAgent=null`, `noticeVersion` ausente → null. Espera `201`. (Nuevo.)

Tests de `consent.ts` (service): si no existe `apps/api/test/unit/consent.test.ts`, añadir cobertura de `grantConsent` persistiendo los 3 campos nuevos; si existe, extender.

## 12. Open questions

- **O-1 (resuelta por default PO)**: ¿añadir columnas de evidencia a `consents`? → **Sí**, `version_aviso` / `ip_otorgamiento` / `user_agent_otorgamiento` nullable (este spec las especifica).
- **O-1b (RESUELTA — PO 2026-06-17)**: `portafolio_viajes` se **deniega siempre** (deny real). No hay tabla de portafolio ni call sites; no se infiere autoridad sobre una feature inexistente. `TODO`/backlink dejado en el código para la futura decisión de Producto (probablemente lista explícita de viajes cuando exista la tabla `portafolios_viajes`). No se toca ADR-053.
- **O-6 (legal, dependencia externa)**: ¿quién completa los campos `[ ]` del modelo/aviso y da el sign-off de abogado, y cuándo? Bloquea el "final" del texto en `docs/legal/`, no el fix de código. F1b (UI signup) espera esta resolución.
- **¿`noticeVersion` debe ser obligatorio en el body una vez F1b esté vivo?** Hoy opcional (el flujo de otorgamiento de grant a stakeholder no necesariamente expone una versión de aviso al otorgante). Revisar al cablear F1b.

## 13. Approval

- [ ] **PO aprueba el spec F1** (chat o comentario sobre este archivo).
- [x] PO resolvió **O-1b** (2026-06-17): denegar siempre `portafolio_viajes` hasta que Producto defina el modelo.
- [ ] PO confirma que **no hay consents en producción** que requieran backfill (verificación previa a migrar).
- [ ] PO confirma que **F1b va en PR separado** (recomendado en §8).

**Pendiente de firma — fecha:** ____________
