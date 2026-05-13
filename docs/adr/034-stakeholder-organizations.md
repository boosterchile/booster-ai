# ADR-034 — Stakeholder Organizations: entidad separada de `empresas`

**Status**: Accepted
**Date**: 2026-05-12
**Decider**: Felipe Vicencio (Product Owner)
**Related**: [ADR-004 Uber-like model](./004-uber-like-model-and-roles.md), [ADR-008 PWA multirol](./008-pwa-multirole.md), [ADR-028 RBAC Firebase](./028-rbac-auth-firebase-multi-tenant-with-consent-grants.md), plan `docs/plans/2026-05-12-identidad-universal-y-dashboard-conductor.md` (Wave 3)

---

## Contexto

Hasta hoy el rol `stakeholder_sostenibilidad` se modela como un `role` más dentro de `membresias`, lo que implica que la entidad pertenece a una `empresa`. Eso es un error conceptual: un stakeholder NO es una empresa transportista ni un generador de carga. Es una organización de naturaleza distinta:

- **Reguladores estatales** (Subsecretaría de Transportes, Ministerio de Medio Ambiente, Superintendencia del Medio Ambiente).
- **Gremios y asociaciones** (ChileTransporte, Confederación Nacional de Dueños de Camiones, SOFOFA, CCS).
- **Observatorios académicos** (Centros UC, USACH, Universidad de Chile dedicados a logística sustentable).
- **ONGs ambientales** (Adapt-Chile, Fundación Terram).
- **Departamentos ESG de corporaciones** (mandantes corporativos que auditan a sus proveedores logísticos).

Tratarlos como `empresas` ensucia el modelo (`empresas` tiene `is_transportista`, `is_generador_carga`, `plan_slug` que no aplican a un stakeholder) y bloquea queries del estilo "lista de empresas reales del marketplace".

Adicionalmente, Felipe (2026-05-12) confirmó que los stakeholders:

1. Se dan de alta solo por **platform-admin** (no auto-signup).
2. Ven datos **agregados** (k-anonymity ≥ 5), nunca shippers/carriers individuales.
3. El alcance de datos lo determina la región/sector de la organización stakeholder, no por consents granulares por usuario.
4. La entidad de pertenencia organiza el acceso, no es la fuente del dato (los consents granulares de ADR-028 siguen siendo el mecanismo para datos individuales, pero esos son separados de la vista agregada).

---

## Decisión

Crear una entidad nueva `organizaciones_stakeholder` paralela (no hija) de `empresas`. Las memberships se extienden con un campo nullable `organizacion_stakeholder_id` que es **XOR** con `empresa_id`: una membership pertenece a una empresa O a una organización stakeholder, no a ambas.

### Schema

```sql
-- Migration 0030_organizaciones_stakeholder.sql
CREATE TYPE tipo_organizacion_stakeholder AS ENUM (
  'regulador',
  'gremio',
  'observatorio_academico',
  'ong',
  'corporativo_esg'
);

CREATE TABLE organizaciones_stakeholder (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre_legal    varchar(200) NOT NULL,
  tipo            tipo_organizacion_stakeholder NOT NULL,
  region_ambito   varchar(50),    -- ISO 3166-2:CL code o NULL = nacional
  sector_ambito   varchar(100),   -- ej. 'transporte-carga', 'manufactura', NULL = todos
  creado_por_admin_id uuid REFERENCES usuarios(id),
  creado_en       timestamp with time zone NOT NULL DEFAULT now(),
  actualizado_en  timestamp with time zone NOT NULL DEFAULT now(),
  eliminado_en    timestamp with time zone,
  CHECK (length(nombre_legal) >= 3)
);

CREATE INDEX idx_organizaciones_stakeholder_tipo
  ON organizaciones_stakeholder (tipo);
CREATE INDEX idx_organizaciones_stakeholder_region
  ON organizaciones_stakeholder (region_ambito);
```

```sql
-- Migration 0031_memberships_stakeholder_org.sql
ALTER TABLE membresias
  ADD COLUMN organizacion_stakeholder_id uuid
    REFERENCES organizaciones_stakeholder(id) ON DELETE RESTRICT;

-- XOR check: una membership pertenece a UNA fuente de configuración:
-- una empresa O una organización stakeholder, no ambas, no ninguna.
ALTER TABLE membresias
  ADD CONSTRAINT chk_membresia_empresa_xor_stakeholder
    CHECK (
      (empresa_id IS NOT NULL AND organizacion_stakeholder_id IS NULL)
      OR
      (empresa_id IS NULL AND organizacion_stakeholder_id IS NOT NULL)
    );

-- El UNIQUE (usuario_id, empresa_id) actual ya cubre el caso empresa.
-- Añadimos otro para el caso stakeholder.
CREATE UNIQUE INDEX uq_membresias_usuario_org_stakeholder
  ON membresias (usuario_id, organizacion_stakeholder_id)
  WHERE organizacion_stakeholder_id IS NOT NULL;
```

**Por qué `empresa_id NOT NULL` antes**: la migration NO modifica `empresa_id`. Hace nullable la columna existente y la cubre con el CHECK XOR. Como no hay stakeholders hoy en producción, ningún row existente queda en estado inválido.

Espera — actually `empresa_id` está `NOT NULL` hoy. Necesitamos ALTER para hacerla nullable:

```sql
ALTER TABLE membresias ALTER COLUMN empresa_id DROP NOT NULL;
-- (Esto es seguro: el CHECK XOR garantiza que si stakeholder_id es NULL
--  entonces empresa_id NOT NULL.)
```

### Auth de stakeholder

- Pre-Wave 4 (este PR): stakeholder se autentica con email/password **manual** (mismo flow que cualquier user actual). El alta del email + password lo hace el platform-admin desde su UI.
- Post-Wave 4 (auth universal RUT + clave numérica): el stakeholder pasa al mismo flow universal con RUT + clave. Como un stakeholder podría no tener RUT chileno (mandante corporativo internacional), se permite `usuarios.rut = NULL` SOLO para usuarios con membresía de tipo stakeholder (constraint reforzado a nivel servicio, no DB, para no romper el modelo general).

### Datos accesibles por el stakeholder

- Surface única `/app/stakeholder/zonas` (ya existe en skeleton — D11).
- Filtros aplicados automáticamente por backend:
  - `organizacion_stakeholder.region_ambito` (si está set) → scope geográfico.
  - `organizacion_stakeholder.sector_ambito` (si está set) → scope sectorial.
- k-anonymity ≥ 5: las queries agregadas devuelven solo bins con ≥ 5 viajes/empresas únicas. Si no, devuelven "datos insuficientes" UI.

### Quién crea stakeholders

Solo platform-admin (allowlist `BOOSTER_PLATFORM_ADMIN_EMAILS`). UI nueva en `/app/platform-admin`:

- Listar organizaciones stakeholder (tabla con tipo, región, fecha creación).
- Crear nueva (form con nombre_legal, tipo, region_ambito opcional, sector_ambito opcional).
- Invitar miembro: form con RUT + email + nombre → backend genera usuario placeholder + membresía pending.
- Soft-delete (`eliminado_en`).

Eventos auditados en `eventos` (mismo patrón que cobra-hoy):

- `org_stakeholder.created`
- `org_stakeholder.member_invited`
- `org_stakeholder.member_activated`
- `org_stakeholder.soft_deleted`

---

## Alternativas consideradas

### Alt 1 — Reusar `empresas` con un flag `is_stakeholder_organization`

**Rechazada**. Ensucia `empresas` con flags y campos que no aplican (planes de billing, sucursales, vehículos). Empuja la lógica de "tipo de entidad" a múltiples lugares en vez de centralizarla en el schema.

### Alt 2 — Stakeholders como usuarios sin entidad de pertenencia

**Rechazada**. Felipe quiere modelar organizaciones (no solo personas individuales): un observatorio académico tiene varios investigadores que necesitan acceso pero pertenecen a la misma organización. Sin entidad, no podemos representar "todos los miembros del Centro UC de Movilidad ven X".

### Alt 3 — Tabla separada `stakeholders` simple (sin tipo, sin scope)

**Rechazada**. Pierde la información estructural que necesitamos para el routing de datos (un regulador nacional ve todo el país; un observatorio regional ve solo su región). Sin `tipo` + `region_ambito` + `sector_ambito` desde el día 1, vamos a tener que migrar.

---

## Consecuencias

### Positivas

- Modelo `empresas` queda limpio y refleja solo entidades comerciales del marketplace.
- Stakeholder onboarding queda controlado (alta por admin), reduciendo riesgo de mal uso.
- Scope geográfico/sectorial declarado en la entidad → backend puede aplicar filtros sin lógica ad-hoc.
- Camino claro hacia Wave 4: extender `usuarios.rut` para casos sin RUT chileno (stakeholders internacionales) sin tocar el modelo general.

### Negativas

- Una migration con CHECK XOR aumenta complejidad. Mitigado: la migration corre en deploy automático con tests previos.
- Memberships ahora pueden tener `empresa_id` o `organizacion_stakeholder_id` → todas las queries deben usar JOIN apropiado. Mitigado: extender `me.ts` para popular el campo correcto en `active_membership` y agregar test de integración que cubra ambos casos.
- Si en el futuro queremos "una persona es miembro de empresa Y de organización stakeholder", el CHECK XOR lo prohíbe. Mitigado: el caso es 1 user con 2 memberships separadas (igual que hoy soportamos dueño + conductor con 2 memberships diferentes).

### Acciones derivadas

- Migration 0030 + 0031 (Wave 3 PR 1).
- Endpoints CRUD admin (Wave 3 PR 2).
- UI platform-admin (Wave 3 PR 2).
- `me.ts` populate `active_membership.organizacion_stakeholder` (Wave 3 PR 2).
- `stakeholder-zonas.tsx` lee `region_ambito` (Wave 3 PR 2).
- Seed-demo: crea un stakeholder demo "Observatorio Logístico UC" tipo `observatorio_academico` (Wave 3 PR 2).
- Tests integración: alta admin → invitación → activación → login → ve zonas filtradas.

### Migrabilidad futura

Cuando Wave 4 termine y el flow RUT+clave esté activo:
- Stakeholders extranjeros pueden tener `usuarios.rut = NULL` con allowlist por dominio de email.
- Membresía sigue siendo el mismo modelo.
