-- ============================================================================
-- 0004_phase_zero_unified_schema_es
-- Drop & recreate de TODO el schema operacional con naming en español.
-- Greenfield: zero data preservation. Si hubiera datos, exportar antes.
-- ============================================================================

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

-- 3. Crear enums nuevos (todos en español, excepto siglas internacionales en estandar_reporte)
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

-- 5. Tabla empresas (con perfil ESG)
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
  "certificaciones_previas" jsonb NOT NULL DEFAULT '[]'::jsonb,
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

-- 8. Tabla vehiculos (con perfil energético)
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

-- 10. Tabla viajes (sin campos ESG; esos van a metricas_viaje)
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
  CONSTRAINT "consentimientos_categorias_datos_check" CHECK (array_length("categorias_datos", 1) >= 1)
);
CREATE INDEX "idx_consentimientos_stakeholder" ON "consentimientos"("stakeholder_id");
CREATE INDEX "idx_consentimientos_otorgado_por" ON "consentimientos"("otorgado_por_id");
CREATE INDEX "idx_consentimientos_activo" ON "consentimientos"("stakeholder_id","tipo_alcance","alcance_id")
  WHERE "revocado_en" IS NULL AND ("expira_en" IS NULL OR "expira_en" > now());

-- 17. Tabla borradores_whatsapp (legacy intake del bot)
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
('estandar','Estándar','Para empresas en operación regular. Transportistas con flota mediana, generadores de carga con cargas semanales.',49000,
  '{"max_active_trips":50,"max_vehicles":20,"max_concurrent_offers":15,"advanced_analytics":false,"auto_documents":true,"api_access":false,"matching_priority":30}'::jsonb,true),
('pro','Pro','Para operación profesional con flotas grandes o múltiples cargas diarias.',149000,
  '{"max_active_trips":null,"max_vehicles":100,"max_concurrent_offers":30,"advanced_analytics":true,"auto_documents":true,"api_access":true,"matching_priority":60}'::jsonb,true),
('enterprise','Enterprise','Solución a medida para grandes empresas y holdings. Precio negociado, SLA dedicado.',0,
  '{"max_active_trips":null,"max_vehicles":null,"max_concurrent_offers":100,"advanced_analytics":true,"auto_documents":true,"api_access":true,"matching_priority":90}'::jsonb,true)
ON CONFLICT ("slug") DO NOTHING;
