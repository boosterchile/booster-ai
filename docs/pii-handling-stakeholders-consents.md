# PII Handling — Stakeholders y Consentimientos

**Snapshot**: 2026-05-04
**Owner**: Felipe Vicencio (PO) + cualquier dev
**Marco regulatorio**: Ley 19.628 Chile (Protección de la vida privada) + GDPR-like best practices

---

## Contexto

Booster AI gestiona datos sensibles de empresas y usuarios:
- RUT (identificador tributario, considerado PII en Chile bajo Ley 19.628)
- Nombre completo, email, teléfono
- Patentes y datos de vehículos
- Datos de viajes (origen, destino, carga, frecuencia → revela patrones de operación)
- Métricas ESG (consumo combustible, emisiones, eficiencia)

Los **stakeholders** (mandante corporativo, sostenibilidad interna, auditor, regulador, inversor) reciben acceso a algunos de estos datos via **consentimientos explícitos** del usuario que los origina.

---

## Modelo de datos (ya implementado)

### Tabla `stakeholders` (`apps/api/src/db/schema.ts:695`)

| Columna | Tipo | Notas |
|---------|------|-------|
| `id` | UUID | PK |
| `usuario_id` | UUID FK → `usuarios` | Quien creó el stakeholder |
| `organizacion_nombre` | varchar(200) | "Cliente Mandante SA" |
| `organizacion_rut` | varchar(20) | RUT opcional |
| `tipo_stakeholder` | enum | `mandante_corporativo \| sostenibilidad_interna \| auditor \| regulador \| inversor` |
| `estandares_reporte` | enum[] | `GLEC_V3 \| GHG_PROTOCOL \| ISO_14064 \| GRI \| SASB \| CDP` |
| `cadencia_reporte` | enum | `mensual \| trimestral \| anual \| bajo_demanda` |
| `creado_en` / `actualizado_en` | timestamptz | |

### Tabla `consentimientos` (`apps/api/src/db/schema.ts:719`)

| Columna | Tipo | Notas |
|---------|------|-------|
| `id` | UUID | PK |
| `otorgado_por_id` | UUID FK → `usuarios` | Sujeto del consentimiento |
| `stakeholder_id` | UUID FK → `stakeholders` | Receptor |
| `tipo_alcance` | enum | `generador_carga \| transportista \| portafolio_viajes \| organizacion` |
| `alcance_id` | UUID | ID del recurso scopeado (empresaId, tripId, etc.) |
| `categorias_datos` | enum[] | Qué se comparte (mín 1 item, CHECK constraint) |
| `otorgado_en` | timestamptz | Default `now()` |
| `expira_en` | timestamptz | Nullable — `NULL` = sin vencimiento |
| `revocado_en` | timestamptz | Nullable — `NULL` = activo |
| `documento_consentimiento_url` | text | URL al PDF firmado del legal (audit trail) |

### Categorías de datos (`consentDataCategoryEnum`)

```
emisiones_carbono   → tCO2eq agregado por viaje, scope 1/2/3
rutas               → origen + destino (sin metadata de carga)
distancias          → km totales, retornos vacíos
combustibles        → litros consumidos, tipos
certificados        → PDFs ESG firmados
perfiles_vehiculos  → patentes + capacidades + euro standard
```

### Tipos de alcance (`consentScopeTypeEnum`)

| Tipo | `alcance_id` apunta a | Caso de uso |
|------|----------------------|-------------|
| `generador_carga` | `empresas.id` (con `es_generador_carga=true`) | Shipper consiente compartir todos sus viajes con un mandante corporativo |
| `transportista` | `empresas.id` (con `es_transportista=true`) | Carrier consiente compartir métricas con un auditor |
| `portafolio_viajes` | UUID artificial (lista de tripIds en otro modelo, futuro) | Portafolio curado para inversor |
| `organizacion` | `empresas.id` | Sostenibilidad interna ve toda la org |

---

## Reglas operativas

### 1. Cada lectura de datos PII por un stakeholder DEBE validarse contra consent

Patrón canónico en services (a implementar):

```ts
async function checkStakeholderConsent(
  stakeholderId: string,
  scopeType: ConsentScopeType,
  scopeId: string,
  dataCategory: ConsentDataCategory,
): Promise<boolean> {
  const now = new Date();
  const result = await db
    .select({ id: consents.id })
    .from(consents)
    .where(
      and(
        eq(consents.stakeholderId, stakeholderId),
        eq(consents.scopeType, scopeType),
        eq(consents.scopeId, scopeId),
        // dataCategories es array; usar `arrayContains` de Drizzle
        sql`${dataCategory}::categoria_dato_consentimiento = ANY(${consents.dataCategories})`,
        isNull(consents.revokedAt),
        or(isNull(consents.expiresAt), gt(consents.expiresAt, now)),
      ),
    )
    .limit(1);
  return result.length > 0;
}
```

Si retorna `false` → HTTP 403 con `error: 'consent_required'` + metadata indicando qué falta.

### 2. Audit log de cada acceso

Cada vez que un stakeholder lee data PII vía endpoint, registrar en BigQuery `audit.stakeholder_access_log`:

```sql
INSERT INTO audit.stakeholder_access_log VALUES (
  uuid_generate_v4(),
  now(),
  $stakeholder_id,
  $consent_id,    -- el consent que autorizó
  $scope_type,
  $scope_id,
  $data_category,
  $resource_id,   -- tripId, empresaId, etc.
  $http_method,
  $http_path,
  $ip_address,
  $user_agent
);
```

Necesario para auditorías Ley 19.628 art. 6 ("derecho a saber qué se hizo con tu data").

### 3. Revocación inmediata

Cuando `consentimientos.revocado_en` se setea, **todas las queries futuras del stakeholder fallan**. NO hay grace period — la revocación es efectiva al commit.

Si el stakeholder está en medio de generar un reporte cuando se revoca, el reporte se trunca. Mensaje al user: "consentimiento revocado durante generación".

### 4. Expiración pasiva

`expira_en` se setea al firmar — típicamente `granted_at + 1 año`. Cuando vence:
- El consent NO se borra (audit trail).
- Las queries lo filtran out porque `expires_at < now()`.
- Se puede "renovar" creando un nuevo consent (otro row con nuevo `granted_at`) — el stakeholder pide al user re-firmar.

### 5. Documento de consentimiento (`documento_consentimiento_url`)

Cada consent **debe** apuntar a un PDF firmado que el user vio y aceptó. El PDF contiene:
- Identidad del stakeholder
- Scope exacto (qué empresa, qué viajes, etc.)
- Categorías de datos compartidos
- Plazo (si aplica)
- Firma digital del user (KMS-firmada al momento del grant)

El URL es público (signed URL al GCS bucket de documentos) por lo que el user siempre puede verificar qué firmó. Mantener 6+ años (mismo retention que documentos legales — ADR-007).

### 6. Default deny

**Toda data PII está negada por default**. Solo se autoriza con consent explícito. El stakeholder NO ve nada de un user/empresa hasta que ese user/empresa firme un consent específico.

Esto es lo opposite de "todo abierto, opt-out" — Ley 19.628 + GDPR-like exigen opt-in explícito.

### 7. PII redaction en logs

Cuando un endpoint del api retorna data PII (via consent), los logs Pino redactan automáticamente:

```ts
// apps/api/src/server.ts (ya configurado)
import pino from 'pino';
const logger = pino({
  redact: {
    paths: [
      'request.body.rut',
      'response.body.rut',
      '*.email',
      '*.telefono',
      // ...
    ],
    censor: '[REDACTED]',
  },
});
```

Los logs estructurados van a Cloud Logging. Si un dev necesita ver el RUT real, queda en BD/BigQuery — los logs son intencionalmente ciegos.

---

## Endpoints (a implementar — gap actual)

Aunque las tablas existen, **NO HAY endpoints HTTP para gestionar consents**. Backlog explícito:

```
POST   /me/stakeholders                     # crear stakeholder asociado al user
GET    /me/stakeholders                     # listar stakeholders del user
DELETE /me/stakeholders/:id                 # archivar stakeholder

POST   /me/consents                          # otorgar consent
GET    /me/consents                          # listar mis consents otorgados
PATCH  /me/consents/:id/revoke              # revocar consent
GET    /me/consents/audit                    # mis logs de acceso (Ley 19.628 art. 6)

GET    /stakeholders/:id/data/emissions     # consume consent (auditor lee tCO2eq)
GET    /stakeholders/:id/data/certificates  # consume consent (lista PDFs)
# cada uno valida consent activo + registra audit log
```

Cada endpoint público debe:
1. Validar Firebase Auth.
2. Llamar `checkStakeholderConsent()`.
3. Loggear access.
4. Retornar data minimal-needed.

---

## Reference queries SQL

Ver `scripts/sql/consent-reference.sql` para queries comunes:
- Consents activos para un stakeholder
- Consents expirando en próximos 30 días
- Audit de revocaciones recientes
- Detección de consents huérfanos (stakeholder borrado, scope no existe)

---

## Compliance checklist Ley 19.628

- [x] Datos PII identificados y catalogados (este doc).
- [x] Tablas con scoping explícito (`stakeholders` + `consentimientos`).
- [x] Default deny — sin consent activo no hay acceso.
- [x] Revocación inmediata (sin grace period).
- [ ] Endpoints HTTP grant/revoke (pendiente).
- [ ] Audit log per-access en BigQuery (pendiente — tabla no creada).
- [ ] Documento de consentimiento firmado y archivado per-grant (pendiente — flujo PDF).
- [ ] UI de "mis consents" en `apps/web` (pendiente).
- [ ] Endpoint "darte de baja completamente" (right to be forgotten) — pendiente, complejo por retention SII 6 años.
- [ ] Pino redact configurado para todos los campos PII (verificar exhaustividad).

---

## Riesgos abiertos

- **Right to be forgotten vs SII retention**: si un user pide borrado, no podemos eliminar las DTEs históricos por obligación legal (6 años SII). Mitigación: anonimizar el row del user pero mantener referencias en DTE como string opaco. Diseño pendiente.
- **Cross-tenant data leak**: una query mal escrita en un service podría leakear data de empresa A al stakeholder de empresa B. Mitigación: tests E2E + linter custom que detecte queries sin filtro `scopeId`. Pendiente.
- **Consent versioning**: cuando el legal text cambie, todos los consents existentes tienen `documento_consentimiento_url` apuntando a la versión vieja. Si la versión nueva amplía scope, requerimos re-grant. Si solo aclara, no. Política: nuevo `consent_version` enum cuando el cambio sea material.

---

## Referencias

- [`apps/api/src/db/schema.ts:215-244`](../apps/api/src/db/schema.ts) — enums
- [`apps/api/src/db/schema.ts:695-745`](../apps/api/src/db/schema.ts) — tablas
- [`apps/api/drizzle/0004_phase_zero_unified_schema_es.sql`](../apps/api/drizzle/0004_phase_zero_unified_schema_es.sql) — migration
- [ADR-004 — Uber-like model and roles](./adr/004-uber-like-model-and-roles.md) — define stakeholder
- Ley 19.628 — [Protección de la vida privada](https://bcn.cl/2f70w)
