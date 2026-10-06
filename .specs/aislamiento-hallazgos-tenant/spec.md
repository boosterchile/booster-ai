# Spec: cerrar fugas de aislamiento que el censo dejó abiertas

- Author: agente, por pedido de cerrar los hallazgos de la revisión multi-tenant
- Date: 2026-10-05
- Status: Draft
- Linked: ADR-028, ADR-034, ADR-035, ADR-041, ADR-042, `.specs/censo-multi-tenant-2026-07-14/rls-viabilidad.md`, `.specs/hito-2-corfo-mes-8/decisiones.md` (D2b), `.specs/aislamiento-vinculo-persona/spec.md`

## 1. Objective

Que una empresa no vea ni opere dispositivos de otras, que una zona stakeholder solo agregue viajes de empresas que consintieron, y que un RUT identifique a una sola persona.

## 2. Why now

La revisión de alta de empresas dejó cuatro hallazgos. El de la clave al vincular un RUT ya está cerrado. Estos tres siguen abiertos, y el cuarto (Postgres RLS) ya tiene decisión: no implementarlo.

## 3. Success criteria

- [x] SC1 — `GET /admin/dispositivos-pendientes` exige `imei` de 15 dígitos. Devuelve 0 o 1 fila y no incluye la IP de origen. Sin `imei`, o con un IMEI mal formado, responde 400.
- [x] SC2 — `POST /admin/dispositivos-pendientes/:id/rechazar` responde 403 `platform_admin_required` a un dueño o admin de empresa. El panel de la empresa no lista la bandeja ni ofrece Rechazar: se busca el IMEI que está impreso en el equipo. `POST /:id/asociar` sigue exigiendo que el vehículo sea de la empresa activa. El listado de plataforma (`/admin/plataforma/dispositivos`) no cambia.
- [x] SC3 — `GET /me/stakeholder/zonas/:slug/agregaciones` niega por defecto. Sin fila en `stakeholders` o sin un consent vigente de `emisiones_carbono` con alcance `generador_carga` o `transportista`, responde 403 `consent_required`. Los viajes se filtran por esas empresas (generador o transportista de la asignación). Un `inArray` vacío no entra en el `WHERE`.
- [x] SC4 — Si la organización tiene `region_ambito`, la zona tiene que tener el mismo `region_code`. Si no coincide, 403 `fuera_de_ambito`. `region_ambito` NULL sigue siendo ámbito nacional. Si `sector_ambito` está puesto, 403 `ambito_sectorial_no_disponible`: no hay columna de sector en viajes ni en empresas, y no se sirve un agregado que el ámbito no puede filtrar.
- [x] SC5 — Antes de responder (también con `insufficient_data`) se inserta `log_acceso_stakeholder` por cada consent usado. Si el insert falla, 500 y no sale el agregado.
- [x] SC6 — `usuarios.rut` tiene índice único `uq_usuarios_rut`. Varios NULL siguen permitidos. La migración no borra filas: si hay duplicados, el `CREATE UNIQUE INDEX` falla y el diagnóstico queda en el SQL. Una carrera de alta que choque con ese índice responde 409 `rut_already_registered`.

## 4. Postgres RLS

No se agregan políticas. `.specs/censo-multi-tenant-2026-07-14/rls-viabilidad.md` ya eligió no hacerlo: un solo rol (`booster_app`) es dueño de las tablas, así que RLS sin `FORCE` y sin roles nuevos es un no-op, y el núcleo del marketplace es cross-tenant a propósito (matching, viajes bilaterales, chat, telemetría, jobs). El control es `pnpm lint:rls`.

## 5. Relación con D2b

D2b dejó el rechazo global como deuda porque cualquier empresa podía rechazar un pending ajeno. Este spec cierra esa deuda: la empresa no lista ni rechaza. El override de dos pasos del `PATCH /vehiculos/:id/dispositivo` sigue vigente para filas que ya estén en `rechazado`.

## 6. Out of scope

- Alta de un endpoint de rechazo para el admin de plataforma.
- Inventar un `scopeType` de zona o una columna de sector.
- Deduplicar RUTs que ya existan en producción.
- Claves de React Query, cursor de chat y el E2E de alta de empresa.
