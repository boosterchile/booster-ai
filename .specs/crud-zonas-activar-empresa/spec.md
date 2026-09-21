# CRUD de zonas de matching + activar empresa sin SQL

**Estado**: aceptada · **Fecha**: 2026-09-21 · **Decidido por**: PO (Felipe Vicencio)

## Autorización del PO (excepción explícita)

**Quién**: Felipe Vicencio (`dev@boosterchile.com`)
**Cuándo**: 2026-09-21
**Qué**: excepción al freeze de `docs/frentes-vivos.md` (máximo tres slots vivos; este trabajo no es Slot 1, 2 ni 3) para cerrar el hueco operativo post-0→1: sin API/UI para activar una empresa ni para escribir zonas, el matching produce 0 candidatos y ops cae a SQL.
**Patrón**: el mismo que PR #689 (posición en vivo) y PR #690 (chat in-app) — slot atado a operaciones de transportista / oficina.
**Qué NO se toca**: `docs/frentes-vivos.md` no se modifica. Esta spec no reabre onboarding como frente de construcción.

## 1. El problema, medido

El matching (`apps/api/src/services/matching.ts`) exige **las dos** condiciones:

1. Carrier con `empresas.estado = 'activa'` y `es_transportista = true`.
2. Fila activa en `zonas` con `codigo_region` **exactamente igual** al `origen_codigo_region` del viaje (numerales romanos: `XIII`, no `13`) y `tipo_zona IN ('recogida','ambos')` y `es_activa = true`.

Hoy:

- Las zonas solo se insertan por seed SQL (`.specs/t2-piso-sembrado-0-1.md` / `scripts/sql/t2-piso-sembrado.sql`). **Cero escrituras API** a `zonas`.
- Onboarding / `signup-approve` dejan la empresa en `pendiente_verificacion`. **No hay camino `UPDATE empresas.estado` en el API.** Ops activa con SQL.
- Resultado: matching silencioso con 0 candidatos.

El schema ya existe (`packages/shared-schemas/src/domain/zone.ts` + `regionCodeSchema` romano; tabla `zonas` en `apps/api/src/db/schema.ts`). Falta el camino de producto.

## 2. Entradas

- `GET /admin/empresas` ya lista empresas (platform-admin, `requirePlatformAdmin`). No filtra por `estado` y no muta.
- `empresaStatusSchema`: `pendiente_verificacion | activa | suspendida`.
- `zoneSchema` + `regionCodeSchema` (I–XVI, romano).
- `requirePlatformAdmin` en `apps/api/src/middleware/require-platform-admin.ts` (allowlist `BOOSTER_PLATFORM_ADMIN_EMAILS`).
- Matching lee `zonas` en cada corrida (sin cache de zonas) → una fila nueva entra al próximo matching **sin redeploy**.

## 3. Salidas

### A) Activar empresa (platform admin)

- `GET /admin/empresas?estado=` — filtro opcional por `estado`. Sin query = todas (el listado actual se conserva).
- `PATCH /admin/empresas/:id` — body `{ estado }` ∈ {`activa`,`suspendida`,`pendiente_verificacion`}.
- Gate: `requirePlatformAdmin`. No-admin → 403 `forbidden_platform_admin`. Sin sesión → 401.
- Idempotente: mismo `estado` que ya tiene → 200, sin write extra más que el log `unchanged`.
- 404 si la empresa no existe.
- Audit: logger estructurado con `empresaId`, `estadoAnterior`, `estadoNuevo`, `adminEmail`, `actorUserId`. Sin PII extra.
- Span OTel `empresa.cambiar_estado` + métrica `empresa_estado_cambios_total`.
- Web: superficie en `/app/platform-admin` — listado de pendientes + botones **Activar** / **Suspender** (copy en vos).

#### Transiciones

No hay transiciones ilegales entre los tres valores del enum. Cualquiera puede ir a cualquiera (ops puede reactivar una suspendida, o devolver a `pendiente_verificacion` si el alta quedó mal). Lo único que se rechaza es un valor fuera del enum (400 Zod).

### B) CRUD zonas (carrier dueño/admin)

Rutas tenant-scoped bajo `/me/zonas`. El `empresa_id` **nunca** viene del cliente: sale de `userContext.activeMembership`.

- `GET    /me/zonas`        — lista (incluye inactivas, para reactivar).
- `POST   /me/zonas`        — crea `{ region_code, zone_type, comuna_codes?, is_active? }`.
- `PATCH  /me/zonas/:id`    — actualiza `zone_type` / `is_active` / `comuna_codes`. No cambia `region_code` (se crea otra zona).
- `DELETE /me/zonas/:id`    — soft-deactivate (`es_activa = false`). Sin hard delete (la tabla no tiene FKs hijas, pero matching y ops necesitan historial).

Authz:

- 401 sin `userContext`.
- 403 `no_active_empresa` sin membresía activa.
- 403 `not_a_carrier` si la empresa no es transportista.
- 403 `admin_required` si el rol no es `dueno|admin` en escrituras. GET también exige `dueno|admin` (esta pantalla es de configuración, no de despacho).
- Zona de otra empresa (id ajeno): **404** `zona_not_found` (no filtramos existencia). El aislamiento real es el `WHERE empresa_id = membresía activa`.

Validación:

- `region_code` con `regionCodeSchema`. `13`, `RM`, `CL-RM` → 400.
- `comuna_codes` opcional; `null` / omitido = toda la región (0→1).
- Duplicado `(empresa, region_code, zone_type)` → 409 `zona_duplicada` (aunque la existente esté inactiva: se reactiva con PATCH, no se crea otra fila).

Web: `/app/zonas` para transportista dueño/admin — lista región + tipo + toggle activa + alta. Select de regiones con códigos romanos (mismo catálogo que OnboardingForm). Copy en vos.

## 4. Criterios de aceptación

1. Un platform-admin pasa una empresa de `pendiente_verificacion` → `activa` por UI/API. Cero SQL.
2. Un dueño/admin transportista crea zona `XIII` / `ambos` (o `recogida`) y la activa/desactiva por UI/API. Cero SQL.
3. Con empresa `activa` + zona compatible, matching incluye al carrier para origen `XIII` (evidencia unitaria).
4. Código de región arábigo (`13`) se rechaza en el boundary de escritura.
5. Tests + typecheck + biome en archivos tocados. PR a `main` con evidencia.
6. Fuera de alcance intacto: stakeholder-zonas, Fleet, return load, docs, chat, tracking, `es_demo`, UI de comunas más allá de null = región completa, `docs/frentes-vivos.md`.

## 5. Fuera de alcance

- Zonas stakeholder (geo k-anon / ADR-041).
- Fleet, carga de retorno, documentos, chat, tracking.
- Limpieza de `es_demo`.
- Selector de comunas (el filtro queda `null` = toda la región).
- Migración / unique constraint nuevo en BD (unicidad a nivel de aplicación).
- Onboarding como frente: no se cambia el alta; solo el estado posterior.
