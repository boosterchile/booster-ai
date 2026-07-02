# ADR-068 — Modelo de consentimiento ESG conforme Ley 19.628 + Ley 21.719

**Estado**: Accepted
**Fecha**: 2026-06-17
**Decider**: Felipe Vicencio (Product Owner)
**Related**: [ADR-028](./028-rbac-auth-firebase-multi-tenant-with-consent-grants.md) (RBAC + consent grants), [ADR-034](./034-stakeholder-organizations.md) (organizaciones stakeholder), `docs/legal/modelo-consentimiento-esg-v1.md`, `docs/legal/aviso-privacidad-corto-v1.md`, `apps/api/src/db/schema.ts` (tabla `consents`), `apps/api/drizzle/0043_consent_evidencia_21719.sql`, `.specs/consent-idor-y-modelo-19628-21719/spec.md` (Frente F1)

---

## Contexto

La Ley N° 21.719 entra en vigencia el **1 de diciembre de 2026** y refunde/reemplaza el régimen de la Ley N° 19.628. Exige **evidencia verificable** de cada aceptación de consentimiento: identidad del titular, finalidades marcadas de forma granular, fecha/hora, **versión del aviso** mostrado e **IP/dispositivo** del otorgamiento; prohíbe casillas premarcadas y el consentimiento tácito; y obliga a versionar el documento (cada cambio relevante de finalidades reinforma).

Hasta este frente, el modelo de consentimiento ESG de Booster existía solo como artefactos legales externos (`Modelo_Consentimiento_ESG_Booster.docx`, `Aviso_Privacidad_Corto_Booster.md`), **no versionados en el repo** y **no vinculados al schema** que materializa el consentimiento. La tabla `consents` (`consentimientos`, ADR-028 §4) modelaba identidad, finalidades, fecha y documento, pero **no la versión del aviso ni la IP/UA** — dos campos que la 21.719 exige como evidencia.

Además, la auditoría 2026-06-14 marcó dos IDOR de severidad alta en el **otorgamiento** de grants (`POST /me/consents`): P1-B (un dueño de empresa A podía otorgar sobre empresa B) y P0-B (`portafolio_viajes` aceptaba cualquier membership). El cierre de esos IDOR (Frente F1) y el cierre del gap modelo↔schema son la misma pieza de compliance y se documentan juntos.

ADR-028 y ADR-034 siguen vigentes: este ADR **los complementa**, no los reemplaza ni los edita.

## Decisión

Se adopta un **modelo de consentimiento ESG conforme dual (19.628 + 21.719)** con tres componentes vinculados entre sí:

### 1. Texto legal versionado en `docs/legal/`

El modelo de consentimiento y el aviso de privacidad corto se versionan en el repo con la convención `*-vN.md` del directorio:

- `docs/legal/modelo-consentimiento-esg-v1.md`
- `docs/legal/aviso-privacidad-corto-v1.md`

Ambos llevan una marca de **BORRADOR LEGAL**: los campos entre corchetes `[ ]` (razón social, RUT, plazos, responsable de datos, canal de derechos) y el sign-off de un abogado habilitado quedan **pendientes** (O-6, dependencia externa PO/legal). El versionado desbloquea el resto del frente sin esperar el texto final.

El slug de versión del archivo vigente (ej. `esg-v1`) es el valor canónico que se registra en `consents.noticeVersion`.

### 2. Evidencia 21.719 en el schema `consents`

Se añaden a `consentimientos` tres columnas de evidencia, **nullable, sin default** (migración 0043, expand-only):

| Columna SQL | Identifier TS | Tipo |
|---|---|---|
| `version_aviso` | `noticeVersion` | `varchar(20)` |
| `ip_otorgamiento` | `grantIp` | `text` |
| `user_agent_otorgamiento` | `grantUserAgent` | `text` |

Se captura la IP confiable vía `extractClientIp(x-forwarded-for)` (penúltima entry bajo GCLB; `'unknown'` → `null`) y el `user-agent`, replicando el patrón ya usado en `carrier_memberships` para evidencia de consentimiento Ley 19.628. Son nullable porque no se inventa evidencia retroactiva para consents previos y porque el flujo de captura (F1b) que expone la `version_aviso` al otorgante aún no está vivo.

### 3. Mapeo modelo legal ↔ schema

El consentimiento legal y la fila en `consents` quedan vinculados así:

| Requisito legal (19.628 / 21.719) | Campo en `consents` |
|---|---|
| Identidad del titular / otorgante | `grantedByUserId` (`otorgado_por_id`) + `stakeholderId` |
| Finalidades marcadas (granular, una casilla por finalidad) | `dataCategories` (`categorias_datos`, enum, CHECK `array_length >= 1`) |
| Fecha y hora | `grantedAt` (`otorgado_en`) |
| Versión del aviso | `noticeVersion` (`version_aviso`) → slug del doc en `docs/legal/` |
| IP / dispositivo | `grantIp` (`ip_otorgamiento`) + `grantUserAgent` (`user_agent_otorgamiento`) |
| Documento firmado | `consentDocumentUrl` (`documento_consentimiento_url`) |
| Revocación (hacia el futuro, sin afectar lo previo) | `revokedAt` (`revocado_en`) |

Las 6 finalidades granulares del modelo (§14) se materializan como los valores del enum `categoria_dato_consentimiento` (`emisiones_carbono`, `rutas`, `distancias`, `combustibles`, `certificados`, `perfiles_vehiculos`): una casilla por finalidad, sin agrupar. **No se requiere columna nueva para finalidades.**

## Consecuencias

**Positivas**:
- El consentimiento ESG es ahora **auditable desde la BD** (no solo desde un PDF externo): identidad, finalidades, fecha, versión del aviso e IP/UA quedan consultables, como exige la 21.719.
- El texto legal queda **versionado y vinculado al código** (`noticeVersion`); cada cambio de finalidades obliga a una nueva versión del doc y un nuevo slug.
- El cierre conjunto con el fix IDOR (Frente F1) deja el **otorgamiento** de grants tanto autorizado correctamente (sin IDOR) como evidenciado conforme.

**Negativas / trade-offs aceptados**:
- El texto legal queda en **borrador** hasta el sign-off de abogado (O-6); la marca de borrador lo hace explícito. El fix de código es independiente del texto final.
- `noticeVersion` es **opcional en el body** mientras F1b (flujo de captura en signup) no esté vivo; se revisará al cablear F1b si pasa a obligatorio.

## Alternativas descartadas

- **No añadir columnas, evidenciar solo con `consentDocumentUrl`**: descartada (default PO O-1). Un PDF externo no es consultable/auditable en BD ni garantiza versión + IP/dispositivo como evidencia verificable.
- **Editar ADR-028 para incorporar la evidencia**: descartada. Los ADRs son decisiones cerradas; se complementa con un ADR nuevo (ADR-068), no se edita el viejo.
- **Backfill de evidencia en consents existentes**: descartada. No se puede inventar IP/versión retroactiva; nullable sin default es lo correcto.

## Criterios de validación

1. `pnpm --filter @booster-ai/api test` verde con la matriz IDOR + evidencia 21.719 (`test/unit/me-consents.test.ts`, `test/unit/consent.test.ts`).
2. La migración 0043 pasa el guard expand/contract (`scripts/repo-checks/check-migration-safety.mjs`, exit 0): solo `ADD COLUMN ... NULL`.
3. `consents.noticeVersion` se persiste con el slug del doc vigente en `docs/legal/`; `grantIp`/`grantUserAgent` con la IP confiable y el user-agent del otorgamiento.
