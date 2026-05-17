# PLAN-PHASE-0 — Reconciliación de schemas (bilingüe TS/SQL + ESG foundational)

> **Para ejecutar con `claude` (Claude Code) en terminal local.**
> Greenfield, sin clientes en producción todavía → strategy `drop & recreate` para la migration. Zero datos a preservar.
> El producto es la solución comercial definitiva (ver ADR-009). No es MVP. No tomar atajos.

---

## 0. Contexto y reglas no negociables

1. **Naming bilingüe permanente**:
   - **TypeScript (código)**: nombres en inglés camelCase. `users`, `trips`, `OfferRow`, `acceptOffer`, `isCarrier`.
   - **SQL (tablas y columnas)**: español snake_case sin tildes. `usuarios`, `viajes`, `ofertas`, `nombre_completo`, `creado_en`.
   - **Enum values**: español snake_case sin tildes. Excepto siglas internacionales (`GLEC_V3`, `GHG_PROTOCOL`, `ISO_14064`, `GRI`, `SASB`, `CDP`).
   - **UI labels**: español natural con tildes. Mapping en presentación.

2. **Toda tabla Drizzle DEBE coincidir con un schema canónico en `packages/shared-schemas/src/domain/`**. Si falta, agregar al domain primero y bajar a Drizzle. Prohibido crear tablas paralelas operacionales en `apps/api/src/db/schema.ts`.

3. **Lógica de algoritmos vive en `packages/`, NO en `apps/api/src/services/`**. Los services en api son orquestadores delgados que llaman packages.

4. **Carrier→Transportista, Shipper→GeneradorCarga**: renombrar en código, columnas SQL, enums, comentarios, ADRs subsecuentes. Mantener "Stakeholder" como anglicismo aceptado.

5. **Plan slug**: `gratis`, `estandar`, `pro`, `enterprise` (este último mantiene en inglés por convención B2B).

6. **Sin estimaciones de tiempo**. Trabajar hasta que esté correcto.

---

## 1. Mapeo completo de tablas

| TS const (export) | SQL tabla |
|---|---|
| plans | planes |
| empresas | empresas |
| users | usuarios |
| memberships | membresias |
| vehicles | vehiculos |
| zones | zonas |
| trips | viajes |
| offers | ofertas |
| assignments | asignaciones |
| tripEvents | eventos_viaje |
| whatsappIntakeDrafts | borradores_whatsapp |
| stakeholders | stakeholders |
| consents | consentimientos |
| tripMetrics | metricas_viaje |

---

## 2. Mapeo de columnas comunes

Sufijos de timestamp:
- `created_at` → `creado_en`
- `updated_at` → `actualizado_en`
- `expires_at` → `expira_en`
- `responded_at` → `respondido_en`
- `accepted_at` → `aceptado_en`
- `picked_up_at` → `recogido_en`
- `delivered_at` → `entregado_en`
- `cancelled_at` → `cancelado_en`
- `notified_at` → `notificado_en`
- `sent_at` → `enviado_en`
- `last_login_at` → `ultimo_login_en`
- `joined_at` → `unido_en`
- `invited_at` → `invitado_en`
- `removed_at` → `removido_en`
- `granted_at` → `otorgado_en`
- `revoked_at` → `revocado_en`
- `recorded_at` → `registrado_en`
- `last_inspection_at` → `ultima_inspeccion_en`
- `inspection_expires_at` → `inspeccion_expira_en`

FKs (`*_id` en español):
- `user_id` → `usuario_id`
- `empresa_id` → `empresa_id`
- `plan_id` → `plan_id`
- `trip_request_id` → `viaje_id`
- `vehicle_id` → `vehiculo_id`
- `driver_user_id` → `conductor_id`
- `offer_id` → `oferta_id`
- `assignment_id` → `asignacion_id`
- `invited_by_user_id` → `invitado_por_id`
- `recorded_by_user_id` → `registrado_por_id`
- `granted_by_user_id` → `otorgado_por_id`
- `stakeholder_id` → `stakeholder_id`
- `created_by_user_id` → `creado_por_id`
- `shipper_empresa_id` → `generador_carga_empresa_id`
- `promoted_to_trip_request_id` → `promovido_a_viaje_id`
- `suggested_vehicle_id` → `vehiculo_sugerido_id`

Otros campos comunes:
- `firebase_uid` → `firebase_uid` (mantener — campo técnico externo)
- `email` → `email`
- `full_name` → `nombre_completo`
- `phone` → `telefono`
- `whatsapp_e164` → `whatsapp_e164` (E.164 es estándar)
- `rut` → `rut`
- `is_platform_admin` → `es_admin_plataforma`
- `status` → `estado`
- `legal_name` → `razon_social`
- `contact_email` → `email_contacto`
- `contact_phone` → `telefono_contacto`
- `address_street` → `direccion_calle`
- `address_city` → `direccion_ciudad`
- `address_region` → `direccion_region`
- `address_postal_code` → `direccion_codigo_postal`
- `is_shipper` → `es_generador_carga`
- `is_carrier` → `es_transportista`
- `timezone` → `zona_horaria`
- `max_concurrent_offers_override` → `max_ofertas_concurrentes_override`
- `monthly_price_clp` → `precio_mensual_clp`
- `is_active` → `es_activo`
- `slug` → `slug`
- `name` → `nombre`
- `description` → `descripcion`
- `features` → `caracteristicas`
- `plate` → `patente`
- `vehicle_type` → `tipo_vehiculo`
- `capacity_kg` → `capacidad_kg`
- `capacity_m3` → `capacidad_m3`
- `year_manufactured` → `anio_fabricacion`
- `year` → `anio`
- `brand` → `marca`
- `model` → `modelo`
- `fuel_type` → `tipo_combustible`
- `curb_weight_kg` → `peso_vacio_kg`
- `consumption_l_per_100km_baseline` → `consumo_l_por_100km_base`
- `teltonika_imei` → `teltonika_imei`
- `region_code` → `codigo_region`
- `comuna_codes` → `codigos_comuna`
- `zone_type` → `tipo_zona`
- `tracking_code` → `codigo_seguimiento`
- `shipper_whatsapp` → `generador_carga_whatsapp`
- `origin_address_raw` → `origen_direccion_raw`
- `origin_region_code` → `origen_codigo_region`
- `origin_comuna_code` → `origen_codigo_comuna`
- `destination_address_raw` → `destino_direccion_raw`
- `destination_region_code` → `destino_codigo_region`
- `destination_comuna_code` → `destino_codigo_comuna`
- `cargo_type` → `tipo_carga`
- `cargo_weight_kg` → `carga_peso_kg`
- `cargo_volume_m3` → `carga_volumen_m3`
- `cargo_description` → `carga_descripcion`
- `pickup_date_raw` → `recogida_fecha_raw`
- `pickup_window_start` → `recogida_ventana_inicio`
- `pickup_window_end` → `recogida_ventana_fin`
- `proposed_price_clp` → `precio_propuesto_clp`
- `agreed_price_clp` → `precio_acordado_clp`
- `score` → `puntaje`
- `response_channel` → `canal_respuesta`
- `rejection_reason` → `razon_rechazo`
- `pickup_evidence_url` → `evidencia_recogida_url`
- `delivery_evidence_url` → `evidencia_entrega_url`
- `cancelled_by_actor` → `cancelado_por_actor`
- `cancellation_reason` → `razon_cancelacion`
- `event_type` → `tipo_evento`
- `payload` → `payload` (técnico, mantener)
- `source` → `origen`
- `role` → `rol`

Empresa perfil ESG nuevo:
- `carbon_reduction_target_pct` → `meta_reduccion_carbono_pct`
- `carbon_reduction_target_year` → `meta_reduccion_carbono_anio`
- `prior_certifications` → `certificaciones_previas`
- `required_reporting_standards` → `estandares_reporte_requeridos`

Métricas ESG (tabla nueva `metricas_viaje`):
- `trip_id` → `viaje_id`
- `distance_km_estimated` → `distancia_km_estimada`
- `distance_km_actual` → `distancia_km_real`
- `carbon_emissions_kgco2e_estimated` → `emisiones_kgco2e_estimadas`
- `carbon_emissions_kgco2e_actual` → `emisiones_kgco2e_reales`
- `fuel_consumed_l_estimated` → `combustible_consumido_l_estimado`
- `fuel_consumed_l_actual` → `combustible_consumido_l_real`
- `precision_method` → `metodo_precision`
- `glec_version` → `version_glec`
- `emission_factor_used` → `factor_emision_usado`
- `source` → `fuente_datos`
- `calculated_at` → `calculado_en`
- `certificate_pdf_url` → `certificado_pdf_url`
- `certificate_sha256` → `certificado_sha256`
- `certificate_kms_key_version` → `certificado_kms_version`
- `certificate_issued_at` → `certificado_emitido_en`

Stakeholder + consentimientos:
- `organization_name` → `organizacion_nombre`
- `organization_rut` → `organizacion_rut`
- `stakeholder_type` → `tipo_stakeholder`
- `reporting_standards` → `estandares_reporte`
- `report_cadence` → `cadencia_reporte`
- `scope_type` → `tipo_alcance`
- `scope_id` → `alcance_id`
- `data_categories` → `categorias_datos`
- `consent_document_url` → `documento_consentimiento_url`

---

## 3. Mapeo de enums

### `plan_slug`
`gratis, estandar, pro, enterprise`

### `estado_empresa` (`empresa_status`)
`pendiente_verificacion, activa, suspendida`

### `estado_usuario` (`user_status`)
`pendiente_verificacion, activo, suspendido, eliminado`

### `rol_membresia` (`membership_role`)
`dueno, admin, despachador, conductor, visualizador, stakeholder_sostenibilidad`

### `estado_membresia` (`membership_status`)
`pendiente_invitacion, activa, suspendida, removida`

### `tipo_vehiculo` (`vehicle_type`)
`camioneta, furgon_pequeno, furgon_mediano, camion_pequeno, camion_mediano, camion_pesado, semi_remolque, refrigerado, tanque`

### `tipo_combustible` (`fuel_type`) — nuevo
`diesel, gasolina, gas_glp, gas_gnc, electrico, hibrido_diesel, hibrido_gasolina, hidrogeno`

### `estado_vehiculo` (`vehicle_status`) — nuevo
`activo, mantenimiento, retirado`

### `tipo_zona` (`zone_type`)
`recogida, entrega, ambos`

### `tipo_carga` (`cargo_type`)
`carga_seca, perecible, refrigerada, congelada, fragil, peligrosa, liquida, construccion, agricola, ganado, otra`

### `estado_viaje` (`trip_request_status`)
`borrador, esperando_match, emparejando, ofertas_enviadas, asignado, en_proceso, entregado, cancelado, expirado`

### `estado_oferta` (`offer_status`)
`pendiente, aceptada, rechazada, expirada, reemplazada`

### `canal_respuesta_oferta` (`offer_response_channel`)
`web, whatsapp, api`

### `estado_asignacion` (`assignment_status`)
`asignado, recogido, entregado, cancelado`

### `actor_cancelacion` (`cancellation_actor`)
`transportista, generador_carga, admin_plataforma`

### `tipo_evento_viaje` (`trip_event_type`)
`intake_iniciado, intake_capturado, matching_iniciado, ofertas_enviadas, oferta_aceptada, oferta_rechazada, oferta_expirada, asignacion_creada, recogida_confirmada, entrega_confirmada, cancelado, carbono_calculado, certificado_emitido, telemetria_primera_recibida, telemetria_perdida, ruta_desviada, disputa_abierta`

### `origen_evento_viaje` (`trip_event_source`)
`web, whatsapp, api, sistema`

### `estado_intake_whatsapp` (`whatsapp_intake_status`)
`en_progreso, capturado, convertido, abandonado, cancelado`

### `metodo_precision` (`precision_method`) — nuevo
`exacto_canbus, modelado, por_defecto`

### `estandar_reporte` (`reporting_standard`) — nuevo, MAYÚSCULAS por ser nombres propios
`GLEC_V3, GHG_PROTOCOL, ISO_14064, GRI, SASB, CDP`

### `tipo_stakeholder` (`stakeholder_type`) — nuevo
`mandante_corporativo, sostenibilidad_interna, auditor, regulador, inversor`

### `cadencia_reporte` (`report_cadence`) — nuevo
`mensual, trimestral, anual, bajo_demanda`

### `tipo_alcance_consentimiento` (`consent_scope_type`) — nuevo
`generador_carga, transportista, portafolio_viajes, organizacion`

### `categoria_dato_consentimiento` (`consent_data_category`) — nuevo
`emisiones_carbono, rutas, distancias, combustibles, certificados, perfiles_vehiculos`

---

## 4. Migration SQL (`apps/api/drizzle/0004_phase_zero_unified_schema_es.sql`)

> **Estrategia drop & recreate**. Greenfield, sin datos. Antes de aplicar: backup logical de la DB de producción por las dudas (`pg_dump`). Tras aplicar, validar con `\dt` que las tablas viejas ya no están y las nuevas en español sí.

```sql
-- ============================================================================
-- 0004_phase_zero_unified_schema_es
-- Drop & recreate de TODO el schema operacional con naming en español.
-- Greenfield: zero data preservation. Si hubiera datos, exportar antes.
-- ============================================================================

BEGIN;

-- 1. Drop tablas viejas en orden (hijos primero por FKs)
DROP TABLE IF EXISTS "trip_events" CASCADE;
DROP TABLE IF EXISTS "assignments" CASCADE;
DROP TABLE IF EXISTS "offers" CASCADE;
DROP TABLE IF EXISTS "trip_requests" CASCADE;
DROP TABLE IF EXISTS "whatsapp_intake_drafts" CASCADE;
DROP TABLE IF EXISTS "vehicles" CASCADE;
DROP TABLE IF EXISTS "zones" CASCADE;
DROP TABLE IF EXISTS "memberships" CASCADE;
DROP TABLE IF EXISTS "users" CASCADE;
DROP TABLE IF EXISTS "empresas" CASCADE;
DROP TABLE IF EXISTS "plans" CASCADE;

-- 2. Drop enums viejos
DROP TYPE IF EXISTS "plan_slug" CASCADE;
DROP TYPE IF EXISTS "empresa_status" CASCADE;
DROP TYPE IF EXISTS "user_status" CASCADE;
DROP TYPE IF EXISTS "membership_role" CASCADE;
DROP TYPE IF EXISTS "membership_status" CASCADE;
DROP TYPE IF EXISTS "vehicle_type" CASCADE;
DROP TYPE IF EXISTS "zone_type" CASCADE;
DROP TYPE IF EXISTS "cargo_type" CASCADE;
DROP TYPE IF EXISTS "trip_request_status" CASCADE;
DROP TYPE IF EXISTS "offer_status" CASCADE;
DROP TYPE IF EXISTS "offer_response_channel" CASCADE;
DROP TYPE IF EXISTS "assignment_status" CASCADE;
DROP TYPE IF EXISTS "cancellation_actor" CASCADE;
DROP TYPE IF EXISTS "trip_event_type" CASCADE;
DROP TYPE IF EXISTS "trip_event_source" CASCADE;
DROP TYPE IF EXISTS "whatsapp_intake_status" CASCADE;

-- 3. Crear enums nuevos (todos en español, excepto reporting_standard)
CREATE TYPE "plan_slug" AS ENUM ('gratis','estandar','pro','enterprise');
CREATE TYPE "estado_empresa" AS ENUM ('pendiente_verificacion','activa','suspendida');
CREATE TYPE "estado_usuario" AS ENUM ('pendiente_verificacion','activo','suspendido','eliminado');
CREATE TYPE "rol_membresia" AS ENUM ('dueno','admin','despachador','conductor','visualizador','stakeholder_sostenibilidad');
CREATE TYPE "estado_membresia" AS ENUM ('pendiente_invitacion','activa','suspendida','removida');
CREATE TYPE "tipo_vehiculo" AS ENUM ('camioneta','furgon_pequeno','furgon_mediano','camion_pequeno','camion_mediano','camion_pesado','semi_remolque','refrigerado','tanque');
CREATE TYPE "tipo_combustible" AS ENUM ('diesel','gasolina','gas_glp','gas_gnc','electrico','hibrido_diesel','hibrido_gasolina','hidrogeno');
CREATE TYPE "estado_vehiculo" AS ENUM ('activo','mantenimiento','retirado');
CREATE TYPE "tipo_zona" AS ENUM ('recogida','entrega','ambos');
CREATE TYPE "tipo_carga" AS ENUM ('carga_seca','perecible','refrigerada','congelada','fragil','peligrosa','liquida','construccion','agricola','ganado','otra');
CREATE TYPE "estado_viaje" AS ENUM ('borrador','esperando_match','emparejando','ofertas_enviadas','asignado','en_proceso','entregado','cancelado','expirado');
CREATE TYPE "estado_oferta" AS ENUM ('pendiente','aceptada','rechazada','expirada','reemplazada');
CREATE TYPE "canal_respuesta_oferta" AS ENUM ('web','whatsapp','api');
CREATE TYPE "estado_asignacion" AS ENUM ('asignado','recogido','entregado','cancelado');
CREATE TYPE "actor_cancelacion" AS ENUM ('transportista','generador_carga','admin_plataforma');
CREATE TYPE "tipo_evento_viaje" AS ENUM ('intake_iniciado','intake_capturado','matching_iniciado','ofertas_enviadas','oferta_aceptada','oferta_rechazada','oferta_expirada','asignacion_creada','recogida_confirmada','entrega_confirmada','cancelado','carbono_calculado','certificado_emitido','telemetria_primera_recibida','telemetria_perdida','ruta_desviada','disputa_abierta');
CREATE TYPE "origen_evento_viaje" AS ENUM ('web','whatsapp','api','sistema');
CREATE TYPE "estado_intake_whatsapp" AS ENUM ('en_progreso','capturado','convertido','abandonado','cancelado');
CREATE TYPE "metodo_precision" AS ENUM ('exacto_canbus','modelado','por_defecto');
CREATE TYPE "estandar_reporte" AS ENUM ('GLEC_V3','GHG_PROTOCOL','ISO_14064','GRI','SASB','CDP');
CREATE TYPE "tipo_stakeholder" AS ENUM ('mandante_corporativo','sostenibilidad_interna','auditor','regulador','inversor');
CREATE TYPE "cadencia_reporte" AS ENUM ('mensual','trimestral','anual','bajo_demanda');
CREATE TYPE "tipo_alcance_consentimiento" AS ENUM ('generador_carga','transportista','portafolio_viajes','organizacion');
CREATE TYPE "categoria_dato_consentimiento" AS ENUM ('emisiones_carbono','rutas','distancias','combustibles','certificados','perfiles_vehiculos');

-- 4. Tabla planes
CREATE TABLE "planes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "slug" "plan_slug" NOT NULL UNIQUE,
  "nombre" varchar(100) NOT NULL,
  "descripcion" text NOT NULL,
  "precio_mensual_clp" integer NOT NULL,
  "caracteristicas" jsonb NOT NULL,
  "es_activo" boolean NOT NULL DEFAULT true,
  "creado_en" timestamptz NOT NULL DEFAULT now(),
  "actualizado_en" timestamptz NOT NULL DEFAULT now()
);

-- 5. Tabla empresas (con perfil ESG nuevo)
CREATE TABLE "empresas" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "razon_social" varchar(200) NOT NULL,
  "rut" varchar(20) NOT NULL UNIQUE,
  "email_contacto" varchar(255) NOT NULL,
  "telefono_contacto" varchar(20) NOT NULL,
  "direccion_calle" varchar(200) NOT NULL,
  "direccion_ciudad" varchar(100) NOT NULL,
  "direccion_region" varchar(4) NOT NULL,
  "direccion_codigo_postal" varchar(20),
  "es_generador_carga" boolean NOT NULL DEFAULT false,
  "es_transportista" boolean NOT NULL DEFAULT false,
  "plan_id" uuid NOT NULL REFERENCES "planes"("id"),
  "estado" "estado_empresa" NOT NULL DEFAULT 'pendiente_verificacion',
  "zona_horaria" varchar(50) NOT NULL DEFAULT 'America/Santiago',
  "max_ofertas_concurrentes_override" integer,
  "meta_reduccion_carbono_pct" numeric(5,2),
  "meta_reduccion_carbono_anio" integer,
  "certificaciones_previas" jsonb NOT NULL DEFAULT '[]',
  "estandares_reporte_requeridos" "estandar_reporte"[] NOT NULL DEFAULT '{}',
  "creado_en" timestamptz NOT NULL DEFAULT now(),
  "actualizado_en" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "idx_empresas_plan" ON "empresas"("plan_id");
CREATE INDEX "idx_empresas_estado" ON "empresas"("estado");
CREATE INDEX "idx_empresas_es_generador_carga" ON "empresas"("es_generador_carga");
CREATE INDEX "idx_empresas_es_transportista" ON "empresas"("es_transportista");

-- 6. Tabla usuarios
CREATE TABLE "usuarios" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "firebase_uid" varchar(128) NOT NULL UNIQUE,
  "email" varchar(255) NOT NULL UNIQUE,
  "nombre_completo" varchar(200) NOT NULL,
  "telefono" varchar(20),
  "whatsapp_e164" varchar(20),
  "rut" varchar(20),
  "estado" "estado_usuario" NOT NULL DEFAULT 'pendiente_verificacion',
  "es_admin_plataforma" boolean NOT NULL DEFAULT false,
  "creado_en" timestamptz NOT NULL DEFAULT now(),
  "actualizado_en" timestamptz NOT NULL DEFAULT now(),
  "ultimo_login_en" timestamptz
);
CREATE INDEX "idx_usuarios_firebase_uid" ON "usuarios"("firebase_uid");
CREATE INDEX "idx_usuarios_email" ON "usuarios"("email");
CREATE INDEX "idx_usuarios_estado" ON "usuarios"("estado");

-- 7. Tabla membresias
CREATE TABLE "membresias" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "usuario_id" uuid NOT NULL REFERENCES "usuarios"("id") ON DELETE RESTRICT,
  "empresa_id" uuid NOT NULL REFERENCES "empresas"("id") ON DELETE RESTRICT,
  "rol" "rol_membresia" NOT NULL,
  "estado" "estado_membresia" NOT NULL DEFAULT 'pendiente_invitacion',
  "invitado_por_id" uuid REFERENCES "usuarios"("id"),
  "invitado_en" timestamptz NOT NULL DEFAULT now(),
  "unido_en" timestamptz,
  "removido_en" timestamptz,
  "creado_en" timestamptz NOT NULL DEFAULT now(),
  "actualizado_en" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "uq_membresias_usuario_empresa" UNIQUE ("usuario_id", "empresa_id")
);
CREATE INDEX "idx_membresias_usuario" ON "membresias"("usuario_id");
CREATE INDEX "idx_membresias_empresa" ON "membresias"("empresa_id");
CREATE INDEX "idx_membresias_rol" ON "membresias"("rol");
CREATE INDEX "idx_membresias_estado" ON "membresias"("estado");

-- 8. Tabla vehiculos (con campos ESG nuevos)
CREATE TABLE "vehiculos" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "empresa_id" uuid NOT NULL REFERENCES "empresas"("id") ON DELETE RESTRICT,
  "patente" varchar(12) NOT NULL UNIQUE,
  "tipo_vehiculo" "tipo_vehiculo" NOT NULL,
  "capacidad_kg" integer NOT NULL,
  "capacidad_m3" integer,
  "anio" integer,
  "marca" varchar(50),
  "modelo" varchar(100),
  "tipo_combustible" "tipo_combustible",
  "peso_vacio_kg" integer,
  "consumo_l_por_100km_base" numeric(5,2),
  "teltonika_imei" varchar(20) UNIQUE,
  "ultima_inspeccion_en" timestamptz,
  "inspeccion_expira_en" timestamptz,
  "estado_vehiculo" "estado_vehiculo" NOT NULL DEFAULT 'activo',
  "creado_en" timestamptz NOT NULL DEFAULT now(),
  "actualizado_en" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "idx_vehiculos_empresa" ON "vehiculos"("empresa_id");
CREATE INDEX "idx_vehiculos_tipo" ON "vehiculos"("tipo_vehiculo");
CREATE INDEX "idx_vehiculos_estado" ON "vehiculos"("estado_vehiculo");
CREATE INDEX "idx_vehiculos_teltonika_imei" ON "vehiculos"("teltonika_imei");

-- 9. Tabla zonas
CREATE TABLE "zonas" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "empresa_id" uuid NOT NULL REFERENCES "empresas"("id") ON DELETE RESTRICT,
  "codigo_region" varchar(4) NOT NULL,
  "codigos_comuna" text[],
  "tipo_zona" "tipo_zona" NOT NULL,
  "es_activa" boolean NOT NULL DEFAULT true,
  "creado_en" timestamptz NOT NULL DEFAULT now(),
  "actualizado_en" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "idx_zonas_empresa" ON "zonas"("empresa_id");
CREATE INDEX "idx_zonas_region" ON "zonas"("codigo_region");
CREATE INDEX "idx_zonas_tipo" ON "zonas"("tipo_zona");

-- 10. Tabla viajes (antes trip_requests; SIN campos ESG, esos van a metricas_viaje)
CREATE TABLE "viajes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "codigo_seguimiento" varchar(12) NOT NULL UNIQUE,
  "generador_carga_empresa_id" uuid REFERENCES "empresas"("id"),
  "generador_carga_whatsapp" varchar(20),
  "creado_por_id" uuid REFERENCES "usuarios"("id"),
  "origen_direccion_raw" text NOT NULL,
  "origen_codigo_region" varchar(4),
  "origen_codigo_comuna" varchar(10),
  "destino_direccion_raw" text NOT NULL,
  "destino_codigo_region" varchar(4),
  "destino_codigo_comuna" varchar(10),
  "tipo_carga" "tipo_carga" NOT NULL,
  "carga_peso_kg" integer,
  "carga_volumen_m3" integer,
  "carga_descripcion" text,
  "recogida_fecha_raw" varchar(200) NOT NULL,
  "recogida_ventana_inicio" timestamptz,
  "recogida_ventana_fin" timestamptz,
  "precio_propuesto_clp" integer,
  "estado" "estado_viaje" NOT NULL DEFAULT 'esperando_match',
  "creado_en" timestamptz NOT NULL DEFAULT now(),
  "actualizado_en" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "idx_viajes_generador_carga_empresa" ON "viajes"("generador_carga_empresa_id");
CREATE INDEX "idx_viajes_generador_carga_whatsapp" ON "viajes"("generador_carga_whatsapp");
CREATE INDEX "idx_viajes_estado" ON "viajes"("estado");
CREATE INDEX "idx_viajes_origen_region" ON "viajes"("origen_codigo_region");
CREATE INDEX "idx_viajes_creado" ON "viajes"("creado_en");

-- 11. Tabla ofertas
CREATE TABLE "ofertas" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "viaje_id" uuid NOT NULL REFERENCES "viajes"("id") ON DELETE RESTRICT,
  "empresa_id" uuid NOT NULL REFERENCES "empresas"("id") ON DELETE RESTRICT,
  "vehiculo_sugerido_id" uuid REFERENCES "vehiculos"("id"),
  "puntaje" integer NOT NULL,
  "estado" "estado_oferta" NOT NULL DEFAULT 'pendiente',
  "canal_respuesta" "canal_respuesta_oferta",
  "razon_rechazo" text,
  "precio_propuesto_clp" integer NOT NULL,
  "enviado_en" timestamptz NOT NULL DEFAULT now(),
  "expira_en" timestamptz NOT NULL,
  "respondido_en" timestamptz,
  "notificado_en" timestamptz,
  "creado_en" timestamptz NOT NULL DEFAULT now(),
  "actualizado_en" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "uq_ofertas_viaje_empresa" UNIQUE ("viaje_id", "empresa_id")
);
CREATE INDEX "idx_ofertas_viaje" ON "ofertas"("viaje_id");
CREATE INDEX "idx_ofertas_empresa" ON "ofertas"("empresa_id");
CREATE INDEX "idx_ofertas_estado" ON "ofertas"("estado");
CREATE INDEX "idx_ofertas_expira" ON "ofertas"("expira_en");
CREATE INDEX "idx_ofertas_notificado" ON "ofertas"("notificado_en")
  WHERE "notificado_en" IS NULL AND "estado" = 'pendiente';

-- 12. Tabla asignaciones
CREATE TABLE "asignaciones" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "viaje_id" uuid NOT NULL UNIQUE REFERENCES "viajes"("id") ON DELETE RESTRICT,
  "oferta_id" uuid NOT NULL UNIQUE REFERENCES "ofertas"("id") ON DELETE RESTRICT,
  "empresa_id" uuid NOT NULL REFERENCES "empresas"("id") ON DELETE RESTRICT,
  "vehiculo_id" uuid NOT NULL REFERENCES "vehiculos"("id") ON DELETE RESTRICT,
  "conductor_id" uuid REFERENCES "usuarios"("id"),
  "estado" "estado_asignacion" NOT NULL DEFAULT 'asignado',
  "precio_acordado_clp" integer NOT NULL,
  "evidencia_recogida_url" text,
  "evidencia_entrega_url" text,
  "cancelado_por_actor" "actor_cancelacion",
  "razon_cancelacion" text,
  "aceptado_en" timestamptz NOT NULL DEFAULT now(),
  "recogido_en" timestamptz,
  "entregado_en" timestamptz,
  "cancelado_en" timestamptz,
  "creado_en" timestamptz NOT NULL DEFAULT now(),
  "actualizado_en" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "idx_asignaciones_empresa" ON "asignaciones"("empresa_id");
CREATE INDEX "idx_asignaciones_estado" ON "asignaciones"("estado");
CREATE INDEX "idx_asignaciones_conductor" ON "asignaciones"("conductor_id");

-- 13. Tabla eventos_viaje
CREATE TABLE "eventos_viaje" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "viaje_id" uuid NOT NULL REFERENCES "viajes"("id") ON DELETE RESTRICT,
  "asignacion_id" uuid REFERENCES "asignaciones"("id"),
  "tipo_evento" "tipo_evento_viaje" NOT NULL,
  "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "origen" "origen_evento_viaje" NOT NULL,
  "registrado_por_id" uuid REFERENCES "usuarios"("id"),
  "registrado_en" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "idx_eventos_viaje_viaje" ON "eventos_viaje"("viaje_id");
CREATE INDEX "idx_eventos_viaje_asignacion" ON "eventos_viaje"("asignacion_id");
CREATE INDEX "idx_eventos_viaje_tipo" ON "eventos_viaje"("tipo_evento");
CREATE INDEX "idx_eventos_viaje_registrado" ON "eventos_viaje"("registrado_en");

-- 14. Tabla metricas_viaje (NUEVA — moat ESG, 1:1 con viajes)
CREATE TABLE "metricas_viaje" (
  "viaje_id" uuid PRIMARY KEY REFERENCES "viajes"("id") ON DELETE RESTRICT,
  "distancia_km_estimada" numeric(10,2),
  "distancia_km_real" numeric(10,2),
  "emisiones_kgco2e_estimadas" numeric(10,3),
  "emisiones_kgco2e_reales" numeric(10,3),
  "combustible_consumido_l_estimado" numeric(10,2),
  "combustible_consumido_l_real" numeric(10,2),
  "metodo_precision" "metodo_precision",
  "version_glec" varchar(10),
  "factor_emision_usado" numeric(8,5),
  "fuente_datos" varchar(20),
  "calculado_en" timestamptz,
  "certificado_pdf_url" text,
  "certificado_sha256" char(64),
  "certificado_kms_version" varchar(50),
  "certificado_emitido_en" timestamptz,
  "creado_en" timestamptz NOT NULL DEFAULT now(),
  "actualizado_en" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "idx_metricas_viaje_metodo_precision" ON "metricas_viaje"("metodo_precision");
CREATE INDEX "idx_metricas_viaje_calculado" ON "metricas_viaje"("calculado_en");

-- 15. Tabla stakeholders (sustainability stakeholders)
CREATE TABLE "stakeholders" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "usuario_id" uuid NOT NULL REFERENCES "usuarios"("id"),
  "organizacion_nombre" varchar(200) NOT NULL,
  "organizacion_rut" varchar(20),
  "tipo_stakeholder" "tipo_stakeholder" NOT NULL,
  "estandares_reporte" "estandar_reporte"[] NOT NULL DEFAULT '{}',
  "cadencia_reporte" "cadencia_reporte" NOT NULL DEFAULT 'bajo_demanda',
  "creado_en" timestamptz NOT NULL DEFAULT now(),
  "actualizado_en" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "idx_stakeholders_usuario" ON "stakeholders"("usuario_id");
CREATE INDEX "idx_stakeholders_tipo" ON "stakeholders"("tipo_stakeholder");

-- 16. Tabla consentimientos
CREATE TABLE "consentimientos" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "otorgado_por_id" uuid NOT NULL REFERENCES "usuarios"("id"),
  "stakeholder_id" uuid NOT NULL REFERENCES "stakeholders"("id"),
  "tipo_alcance" "tipo_alcance_consentimiento" NOT NULL,
  "alcance_id" uuid NOT NULL,
  "categorias_datos" "categoria_dato_consentimiento"[] NOT NULL,
  "otorgado_en" timestamptz NOT NULL DEFAULT now(),
  "expira_en" timestamptz,
  "revocado_en" timestamptz,
  "documento_consentimiento_url" text NOT NULL,
  CHECK (array_length("categorias_datos", 1) >= 1)
);
CREATE INDEX "idx_consentimientos_stakeholder" ON "consentimientos"("stakeholder_id");
CREATE INDEX "idx_consentimientos_otorgado_por" ON "consentimientos"("otorgado_por_id");
CREATE INDEX "idx_consentimientos_activo" ON "consentimientos"("stakeholder_id","tipo_alcance","alcance_id")
  WHERE "revocado_en" IS NULL AND ("expira_en" IS NULL OR "expira_en" > now());

-- 17. Tabla borradores_whatsapp (legacy intake del bot — mantener mientras se migra)
CREATE TABLE "borradores_whatsapp" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "codigo_seguimiento" varchar(10) NOT NULL UNIQUE,
  "generador_carga_whatsapp" varchar(20) NOT NULL,
  "origen_direccion_raw" text NOT NULL,
  "destino_direccion_raw" text NOT NULL,
  "tipo_carga" "tipo_carga" NOT NULL,
  "recogida_fecha_raw" varchar(200) NOT NULL,
  "estado" "estado_intake_whatsapp" NOT NULL DEFAULT 'capturado',
  "promovido_a_viaje_id" uuid REFERENCES "viajes"("id"),
  "creado_en" timestamptz NOT NULL DEFAULT now(),
  "actualizado_en" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "idx_borradores_whatsapp_generador_carga" ON "borradores_whatsapp"("generador_carga_whatsapp");
CREATE INDEX "idx_borradores_whatsapp_estado" ON "borradores_whatsapp"("estado");
CREATE INDEX "idx_borradores_whatsapp_creado" ON "borradores_whatsapp"("creado_en");

-- 18. Re-seed de planes
INSERT INTO "planes" ("slug","nombre","descripcion","precio_mensual_clp","caracteristicas","es_activo") VALUES
('gratis','Gratis','Plan gratis para arrancar. Hasta 5 cargas activas y 3 vehículos.',0,
  '{"max_active_trips":5,"max_vehicles":3,"max_concurrent_offers":5,"advanced_analytics":false,"auto_documents":false,"api_access":false,"matching_priority":10}'::jsonb,true),
('estandar','Estándar','Para empresas en operación regular. Carriers con flota mediana, shippers con cargas semanales.',49000,
  '{"max_active_trips":50,"max_vehicles":20,"max_concurrent_offers":15,"advanced_analytics":false,"auto_documents":true,"api_access":false,"matching_priority":30}'::jsonb,true),
('pro','Pro','Para operación profesional con flotas grandes o múltiples cargas diarias.',149000,
  '{"max_active_trips":null,"max_vehicles":100,"max_concurrent_offers":30,"advanced_analytics":true,"auto_documents":true,"api_access":true,"matching_priority":60}'::jsonb,true),
('enterprise','Enterprise','Solución a medida para grandes empresas y holdings. Precio negociado, SLA dedicado.',0,
  '{"max_active_trips":null,"max_vehicles":null,"max_concurrent_offers":100,"advanced_analytics":true,"auto_documents":true,"api_access":true,"matching_priority":90}'::jsonb,true)
ON CONFLICT ("slug") DO NOTHING;

COMMIT;
```

Después actualizar `apps/api/drizzle/meta/_journal.json` agregando:
```json
{
  "idx": 4,
  "version": "7",
  "when": 1777996800001,
  "tag": "0004_phase_zero_unified_schema_es",
  "breakpoints": true
}
```

---

## 5. Reescritura de `apps/api/src/db/schema.ts`

Convención: `pgTable('nombre_tabla_es', { campoTsCamel: tipo('columna_es') })`. Reescribir el archivo entero con el mapping de §1, §2, §3.

Los exports mantienen camelCase TS:
- `plans`, `empresas`, `users`, `memberships`, `vehicles`, `zones`, `trips`, `offers`, `assignments`, `tripEvents`, `whatsappIntakeDrafts`, `stakeholders`, `consents`, `tripMetrics`.

Los types siguen el mismo patrón:
- `PlanRow`, `EmpresaRow`, `UserRow`, `MembershipRow`, `VehicleRow`, `ZoneRow`, `TripRow`, `OfferRow`, `AssignmentRow`, `TripEventRow`, `WhatsappIntakeRow`, `StakeholderRow`, `ConsentRow`, `TripMetricsRow`.

Los enums Drizzle reciben el nombre SQL del enum como primer arg:
- `pgEnum('tipo_vehiculo', [...])` con valores en español.

Cuidado especial:
- Campo `vehiculos.tipo_vehiculo` colisiona con el enum `tipo_vehiculo`. Drizzle maneja esto con namespaces, pero hay que verificar al escribir.
- `consentimientos.categorias_datos` es array de enum: `categoriaDatoConsentimientoEnum.array()`.
- `empresas.estandares_reporte_requeridos` igual array de enum.
- `stakeholders.estandares_reporte` igual.

---

## 6. Cambios en `packages/shared-schemas/src/domain/`

### `vehicle.ts` — extender
Agregar al `vehicleSchema`:
```ts
curb_weight_kg: z.number().int().positive(),
consumption_l_per_100km_baseline: z.number().positive().nullable(),
```
Mantener todo lo demás.

### `empresa.ts` — extender con perfil ESG
Agregar:
```ts
import { reportingStandardSchema } from './stakeholder.js';

// dentro de empresaSchema:
carbon_reduction_target_pct: z.number().min(0).max(100).nullable(),
carbon_reduction_target_year: z.number().int().nullable(),
prior_certifications: z.array(z.string()).default([]),
required_reporting_standards: z.array(reportingStandardSchema).default([]),
```

Renombrar `is_shipper` → `is_generador_carga`, `is_carrier` → `is_transportista` en el schema canónico. Mantener compat exportando aliases si hace falta para no romper tests del bot:
```ts
export const empresaSchema = z.object({
  // ...
  is_generador_carga: z.boolean(),
  is_transportista: z.boolean(),
  // ...
});
// Aliases legacy temporales (deprecate gradualmente):
export type EmpresaLegacyShape = Omit<Empresa, 'is_generador_carga' | 'is_transportista'> & {
  is_shipper: boolean;
  is_carrier: boolean;
};
```

### `trip-event.ts` — extender
Agregar al `tripEventTypeSchema`:
```ts
'carbono_calculado',
'certificado_emitido',
'telemetria_primera_recibida',
'telemetria_perdida',
'ruta_desviada',
'disputa_abierta',
```
Y renombrar los existentes a versión española:
```ts
'intake_iniciado','intake_capturado','matching_iniciado','ofertas_enviadas',
'oferta_aceptada','oferta_rechazada','oferta_expirada','asignacion_creada',
'recogida_confirmada','entrega_confirmada','cancelado',
```

`tripEventSourceSchema`:
```ts
z.enum(['web','whatsapp','api','sistema']);
```

### `trip-metrics.ts` — NUEVO archivo
```ts
import { z } from 'zod';
import { tripIdSchema } from '../primitives/ids.js';

export const precisionMethodSchema = z.enum(['exacto_canbus','modelado','por_defecto']);
export type PrecisionMethod = z.infer<typeof precisionMethodSchema>;

export const tripMetricsSchema = z.object({
  trip_id: tripIdSchema,
  distance_km_estimated: z.number().nonnegative().nullable(),
  distance_km_actual: z.number().nonnegative().nullable(),
  carbon_emissions_kgco2e_estimated: z.number().nonnegative().nullable(),
  carbon_emissions_kgco2e_actual: z.number().nonnegative().nullable(),
  fuel_consumed_l_estimated: z.number().nonnegative().nullable(),
  fuel_consumed_l_actual: z.number().nonnegative().nullable(),
  precision_method: precisionMethodSchema.nullable(),
  glec_version: z.string().nullable(),
  emission_factor_used: z.number().nonnegative().nullable(),
  source: z.enum(['modeled','canbus','driver_app']).nullable(),
  calculated_at: z.string().datetime().nullable(),
  certificate_pdf_url: z.string().url().nullable(),
  certificate_sha256: z.string().length(64).nullable(),
  certificate_kms_key_version: z.string().nullable(),
  certificate_issued_at: z.string().datetime().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export type TripMetrics = z.infer<typeof tripMetricsSchema>;
```

### `trip.ts` — REMOVER campos ESG
Esos campos ahora viven en `tripMetricsSchema`. Limpiar `tripSchema`:
```ts
// REMOVER del schema:
// carbon_emissions_kgco2e
// distance_km
// fuel_consumed_l
// precision_method
```

### `stakeholder.ts` — ya está OK, solo asegurar export del index
### `index.ts` — exportar `consentGrantSchema`, `sustainabilityStakeholderSchema`, `tripMetricsSchema`, `precisionMethodSchema`.

### `carrier.ts` → renombrar a `transportista.ts`. Renombrar tipos `Carrier` → `Transportista`, `carrierSchema` → `transportistaSchema`. Update imports en todo el repo.

### Buscar y reemplazar referencias en domain/:
- `Carrier` → `Transportista` (cuidado con anglicismos en comentarios — mantener si tienen sentido)
- `Shipper` → `GeneradorCarga`
- `shipper_id` → `generador_carga_id`
- `carrier_id` → `transportista_id`
- `is_shipper` → `is_generador_carga`
- `is_carrier` → `is_transportista`

---

## 7. Refactor de `apps/api/src/services/`

### `onboarding.ts`
- Imports: `users`, `empresas`, `memberships`, `plans` siguen igual (camelCase TS).
- Campos: `whatsappE164`, `nombreCompleto`, `razonSocial`, `emailContacto`, `telefonoContacto`, `direccionCalle`, `direccionCiudad`, `direccionRegion`, `direccionCodigoPostal`, `esGeneradorCarga`, `esTransportista`, `planId`, `estado`, `zonaHoraria`, `unidoEn`, `creadoEn`, `actualizadoEn`, `esAdminPlataforma`, `metaReduccionCarbonoPct`, etc.
- Strings de enum: `'pendiente_verificacion'`, `'activo'`, `'activa'`, `'dueno'`.
- Errores: mantener nombres en inglés (`UserAlreadyExistsError`, etc.).

### `offer-actions.ts`
- `tripRequests` → `trips`. Imports actualizan.
- Campos snake_case TS: `tripRequestId` → `viajeId`, `empresaId`, `respondedAt` → `respondidoEn`, `responseChannel` → `canalRespuesta`, `rejectionReason` → `razonRechazo`, `expiresAt` → `expiraEn`, `proposedPriceClp` → `precioPropuestoClp`, `agreedPriceClp` → `precioAcordadoClp`, `acceptedAt` → `aceptadoEn`, `vehicleId` → `vehiculoId`, `suggestedVehicleId` → `vehiculoSugeridoId`.
- Strings de enum: `'pendiente'`, `'aceptada'`, `'rechazada'`, `'reemplazada'`, `'asignado'`, `'web'`, `'asignacion_creada'`, `'oferta_aceptada'`, `'oferta_rechazada'`.

### `matching.ts`
- Migrar 100% a `packages/matching-algorithm/`. El `services/matching.ts` debe quedar como un wrapper trivial que llama al package (o eliminarse y que `routes/trip-requests-v2.ts` llame al package directamente).
- Renombrar `runMatching` y mover a `packages/matching-algorithm/src/index.ts`.
- Strings de enum y campos en español.

### `notify-offer.ts`
- Migrar 100% a `packages/notification-fan-out/`. Wrapper trivial en `services/`.
- O directamente que `runMatching` use el package.
- Strings de enum y campos en español.

### `user-context.ts`
- Imports y campos en camelCase TS. Strings de enum: `'activa'`, `'activo'`.

### `firebase.ts`
- Sin cambios (es de auth, no toca DB).

### Crear `services/calcular-metricas-viaje.ts` (nuevo)
- Wrapper que llama `packages/carbon-calculator/` con datos del trip (vehicle, distance, fuel_type) y persiste en `trip_metrics`.
- Hook al final del lifecycle: pickup confirmado → cálculo `_estimated`. Delivered → cálculo `_actual` con telemetría.

---

## 8. Refactor de `apps/api/src/routes/`

### `empresas.ts`
- Mapeo del input zod (que viene en inglés desde el form web) a campos español del INSERT. Por ejemplo:
  - input `legal_name` → `razonSocial`
  - input `is_carrier` → `esTransportista`
  - input `is_shipper` → `esGeneradorCarga`

### `me.ts`
- Mismo mapeo. Output al cliente queda en inglés (porque el form web no se cambia).

### `offers.ts`
- Imports `tripRequests` → `trips`. Campos español.

### `trip-requests.ts` (legacy bot)
- `tripRequests` → `trips`. Campos español. Mantener path URL `/trip-requests` por compat.

### `trip-requests-v2.ts`
- Igual. Mantener URL `/trip-requests-v2` o renombrar a `/viajes` (decisión: mantener URL en inglés para no romper bot, internamente usar `trips`/`viajes`).

---

## 9. Refactor de tests

`apps/api/test/unit/*.test.ts`:
- Reemplazar `tripRequests` → `trips`.
- Reemplazar campos `tripRequestId` → `viajeId`, etc.
- Reemplazar strings de enum: `'pending'` → `'pendiente'`, `'active'` → `'activa'`, etc.
- Si los tests usaban `is_carrier`/`is_shipper` directamente, cambiar a `is_transportista`/`is_generador_carga` en los inputs.

---

## 10. Refactor de `apps/web/`

`apps/web/src/hooks/use-onboarding-mutation.ts`, `use-me.ts`, `use-offers.ts`:
- Tipos respuesta del api siguen en inglés (TS convention).
- Si la API ahora devuelve `is_transportista`/`is_generador_carga`, actualizar tipos.
- Mantener compat: el form web sigue mandando `is_carrier`/`is_shipper`; el endpoint los traduce internamente.

`apps/web/src/components/onboarding/OnboardingForm.tsx`:
- Si decidimos cambiar el contrato del input también: actualizar campos del form. Si no, dejar como está y traducir en el endpoint.

`apps/web/src/components/offers/OfferCard.tsx`:
- Mapping `truck_dry → 'Carga seca'` cambia a `carga_seca → 'Carga seca'`. Update.

`apps/web/src/routes/ofertas.tsx`, `app.tsx`, `perfil.tsx`:
- Si las strings de enum llegan del api en español, los mappings UI ya las reciben en español. Update.

---

## 11. Refactor de `apps/whatsapp-bot/`

`apps/whatsapp-bot/src/services/api-client.ts`:
- Si el bot llamaba `POST /trip-requests` con campos en inglés, mantener o migrar. Decisión: el `WhatsAppIntakeCreateInput` que define el contrato sigue en inglés (zod); el endpoint mapea internamente al schema español.

---

## 12. CLAUDE.md actualizado

Agregar al final:

```markdown
## Reglas de naming bilingüe (Booster AI)

- **TypeScript code**: identifiers en inglés camelCase. `users`, `trips`, `OfferRow`, `acceptOffer`.
- **SQL DDL**: tablas y columnas en español snake_case sin tildes. `usuarios`, `viajes`, `nombre_completo`, `creado_en`.
- **Enum values**: español snake_case sin tildes. Excepto siglas (`GLEC_V3`, `GHG_PROTOCOL`, `ISO_14064`).
- **UI labels**: español natural con tildes. Mapping en presentación.
- **Drizzle pattern**: `export const users = pgTable('usuarios', { fullName: varchar('nombre_completo', ...) })`.

## Reglas de arquitectura (no negociables)

- **Domain canónico vive en `packages/shared-schemas/src/domain/`**. Toda tabla Drizzle debe coincidir con un schema del domain.
- **Algoritmos viven en `packages/`**. `apps/api/src/services/` solo orquesta. Prohibido escribir `runMatching` o `calculateCarbon` en services.
- **Carrier/Shipper deprecated**. Usar `Transportista`/`GeneradorCarga` en código y SQL.
- **Stakeholder se mantiene como término** (anglicismo aceptado en español de negocios).
```

---

## 13. Checklist de ejecución (en orden)

1. [ ] Crear branch `phase-zero-bilingual-schema`
2. [ ] Update `packages/shared-schemas/src/domain/`:
   - Renombrar `carrier.ts` → `transportista.ts`. Update tipos.
   - Renombrar refs `Carrier`/`Shipper`/`shipper_id`/`carrier_id` en todo `domain/`
   - Update `vehicle.ts` (curb_weight_kg, consumption_baseline)
   - Update `empresa.ts` (perfil ESG: meta_reduccion, certificaciones, estandares)
   - Update `trip-event.ts` (nuevos tipos en español)
   - Update `trip.ts` (remover campos ESG)
   - Crear `trip-metrics.ts`
   - Update `index.ts` (exports completos)
3. [ ] Crear `apps/api/drizzle/0004_phase_zero_unified_schema_es.sql`
4. [ ] Update `apps/api/drizzle/meta/_journal.json` con entry 0004
5. [ ] Reescribir `apps/api/src/db/schema.ts` entero
6. [ ] Migrar `services/matching.ts` → `packages/matching-algorithm/src/index.ts`
7. [ ] Migrar `services/notify-offer.ts` → `packages/notification-fan-out/src/index.ts`
8. [ ] Update `services/onboarding.ts` con campos español
9. [ ] Update `services/offer-actions.ts` con campos español
10. [ ] Update `services/user-context.ts` con campos español
11. [ ] Crear `services/calcular-metricas-viaje.ts` (placeholder, llama carbon-calculator que sigue placeholder)
12. [ ] Update `routes/empresas.ts`, `me.ts`, `offers.ts`, `trip-requests.ts`, `trip-requests-v2.ts`
13. [ ] Update tests `test/unit/*.test.ts`
14. [ ] Update `apps/web/src/hooks/use-me.ts`, `use-offers.ts` (tipos)
15. [ ] Update `apps/web/src/components/offers/OfferCard.tsx` (mappings UI)
16. [ ] Update `apps/web/src/components/onboarding/OnboardingForm.tsx` (compat)
17. [ ] Update `apps/whatsapp-bot/` si afecta
18. [ ] Update `CLAUDE.md` con reglas
19. [ ] `pnpm install` (resolver simboles)
20. [ ] `pnpm -r typecheck` — todo verde
21. [ ] `pnpm -r test` — todo verde
22. [ ] `pnpm -r build` — todo verde
23. [ ] Aplicar migration en DB de dev: `pnpm --filter @booster-ai/api db:migrate` (o restart del api en Cloud Run que corre migrations al startup)
24. [ ] Verificar `\dt` muestra tablas en español
25. [ ] Commit + push (o multiple commits coherentes: domain, schema, services, routes, tests, web, docs)
26. [ ] Smoke test E2E: signup → onboarding → carga vía bot → ver oferta → accept

---

## 14. Archivos esperados a tocar

Aproximado, generar con `git diff --stat` al final:

```
packages/shared-schemas/src/domain/transportista.ts (renamed from carrier.ts)
packages/shared-schemas/src/domain/vehicle.ts                  (extendido)
packages/shared-schemas/src/domain/empresa.ts                  (extendido + rename fields)
packages/shared-schemas/src/domain/trip.ts                     (remover ESG fields)
packages/shared-schemas/src/domain/trip-event.ts               (nuevos tipos)
packages/shared-schemas/src/domain/trip-metrics.ts             (NUEVO)
packages/shared-schemas/src/index.ts                           (exports)
packages/shared-schemas/src/onboarding.ts                      (rename fields)
packages/shared-schemas/src/profile.ts                         (sin cambio)
packages/shared-schemas/src/trip-request-create.ts             (rename fields)
packages/shared-schemas/src/whatsapp.ts                        (revisar)

apps/api/drizzle/0004_phase_zero_unified_schema_es.sql         (NUEVO)
apps/api/drizzle/meta/_journal.json                            (entry 0004)
apps/api/src/db/schema.ts                                      (REESCRITO)
apps/api/src/services/onboarding.ts                            (refactor)
apps/api/src/services/offer-actions.ts                         (refactor)
apps/api/src/services/user-context.ts                          (refactor)
apps/api/src/services/matching.ts                              (migrate to package)
apps/api/src/services/notify-offer.ts                          (migrate to package)
apps/api/src/services/calcular-metricas-viaje.ts               (NUEVO placeholder)
apps/api/src/routes/empresas.ts                                (refactor)
apps/api/src/routes/me.ts                                      (refactor)
apps/api/src/routes/offers.ts                                  (refactor)
apps/api/src/routes/trip-requests.ts                           (refactor)
apps/api/src/routes/trip-requests-v2.ts                        (refactor)
apps/api/test/unit/*.test.ts                                   (refactor)

packages/matching-algorithm/src/index.ts                       (de placeholder a impl real)
packages/notification-fan-out/src/index.ts                     (de placeholder a impl real)

apps/web/src/hooks/use-me.ts                                   (tipos)
apps/web/src/hooks/use-offers.ts                               (tipos)
apps/web/src/components/offers/OfferCard.tsx                   (mappings UI)
apps/web/src/components/onboarding/OnboardingForm.tsx          (compat)

CLAUDE.md                                                      (reglas)
```

---

## 15. Notas operacionales

- **Bot WhatsApp ya en producción**. Si el bot llama al api con campos viejos (`is_shipper`, `is_carrier`), el endpoint debe traducir. O el bot también necesita actualizarse. Decidir antes de aplicar la migration en producción real.
- **Template Twilio `offer_new_v1` ya submitted a Meta**. El template no menciona campos del schema, sigue válido.
- **Cloud Run del api** tiene migrator on startup. Aplicar migration significa: deploy de nuevo image con la migration en `drizzle/`, el api al startup la corre automáticamente.

---

**FIN DEL PLAN.**

Para ejecutar con `claude` en local:
```bash
cd /Users/felipevicencio/Desktop/Booster-AI && \
  claude "Lee PLAN-PHASE-0.md y ejecútalo paso por paso, marcando cada checkbox de la sección 13 a medida que avanzás. Confirmá conmigo solo si encontrás ambigüedad. Al final típechek + tests + build + commit."
```
