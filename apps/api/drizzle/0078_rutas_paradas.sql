-- Migration 0078 — Ruta, parada y evento de ruta (ADR-088, spec
-- ruta-parada-servicio, parte 2).
--
-- Hoy una carga es un viaje y un viaje es un camión: `asignaciones.viaje_id`
-- es único y el vehículo vive en la asignación. La ruta separa el recorrido
-- del camión de cada carga: un camión, un conductor, N paradas.
--
-- Desde esta migración, aceptar una oferta crea una ruta `planificada` de dos
-- paradas y deja `asignaciones.ruta_id` apuntando a ella. Las asignaciones
-- anteriores quedan con `ruta_id` NULL hasta el relleno (parte 3). Vehículo,
-- arrastre y conductor se siguen leyendo de `asignaciones` hasta la parte 4.
--
-- Expand-only (ADR-066): tipos, tablas y una columna opcional. No toca filas
-- existentes. Rollback de la revisión Cloud Run seguro: una versión previa no
-- lee las tablas ni la columna.
--
-- `uq_paradas_ruta_orden` es DEFERRABLE INITIALLY DEFERRED: reordenar paradas
-- cambia varios `orden` en una transacción y la unicidad se comprueba al
-- cerrarla.

CREATE TYPE "estado_ruta" AS ENUM ('planificada', 'en_curso', 'cerrada', 'cancelada');
--> statement-breakpoint
CREATE TYPE "tipo_parada" AS ENUM ('recogida', 'entrega');
--> statement-breakpoint
CREATE TABLE "rutas" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "empresa_id" uuid NOT NULL,
  "vehiculo_id" uuid,
  "unidad_arrastre_id" uuid,
  "conductor_id" uuid,
  "estado" "estado_ruta" DEFAULT 'planificada' NOT NULL,
  "polilinea_planificada" text,
  "iniciada_en" timestamp with time zone,
  "cerrada_en" timestamp with time zone,
  "cancelada_en" timestamp with time zone,
  "creado_en" timestamp with time zone DEFAULT now() NOT NULL,
  "actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "rutas_empresa_id_empresas_id_fk"
    FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT,
  CONSTRAINT "rutas_vehiculo_id_vehiculos_id_fk"
    FOREIGN KEY ("vehiculo_id") REFERENCES "vehiculos"("id") ON DELETE RESTRICT,
  CONSTRAINT "rutas_unidad_arrastre_id_vehiculos_id_fk"
    FOREIGN KEY ("unidad_arrastre_id") REFERENCES "vehiculos"("id") ON DELETE RESTRICT,
  CONSTRAINT "rutas_conductor_id_usuarios_id_fk"
    FOREIGN KEY ("conductor_id") REFERENCES "usuarios"("id")
);
--> statement-breakpoint
CREATE INDEX "idx_rutas_empresa_estado" ON "rutas" ("empresa_id", "estado");
--> statement-breakpoint
CREATE INDEX "idx_rutas_vehiculo" ON "rutas" ("vehiculo_id");
--> statement-breakpoint
CREATE INDEX "idx_rutas_conductor" ON "rutas" ("conductor_id");
--> statement-breakpoint
CREATE TABLE "paradas_ruta" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "ruta_id" uuid NOT NULL,
  "orden" integer NOT NULL,
  "tipo" "tipo_parada" NOT NULL,
  "viaje_id" uuid NOT NULL,
  "resuelta_en" timestamp with time zone,
  "creado_en" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "paradas_ruta_ruta_id_rutas_id_fk"
    FOREIGN KEY ("ruta_id") REFERENCES "rutas"("id") ON DELETE RESTRICT,
  CONSTRAINT "paradas_ruta_viaje_id_viajes_id_fk"
    FOREIGN KEY ("viaje_id") REFERENCES "viajes"("id") ON DELETE RESTRICT,
  CONSTRAINT "uq_paradas_ruta_orden"
    UNIQUE ("ruta_id", "orden") DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT "uq_paradas_ruta_servicio_tipo" UNIQUE ("ruta_id", "viaje_id", "tipo"),
  CONSTRAINT "ck_paradas_ruta_orden" CHECK ("orden" >= 0)
);
--> statement-breakpoint
CREATE INDEX "idx_paradas_ruta_viaje" ON "paradas_ruta" ("viaje_id");
--> statement-breakpoint
CREATE TABLE "eventos_ruta" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "ruta_id" uuid NOT NULL,
  "tipo_evento" varchar(40) NOT NULL,
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "registrado_por_id" uuid,
  "creado_en" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "eventos_ruta_ruta_id_rutas_id_fk"
    FOREIGN KEY ("ruta_id") REFERENCES "rutas"("id") ON DELETE RESTRICT,
  CONSTRAINT "eventos_ruta_registrado_por_id_usuarios_id_fk"
    FOREIGN KEY ("registrado_por_id") REFERENCES "usuarios"("id"),
  CONSTRAINT "ck_eventos_ruta_tipo"
    CHECK ("tipo_evento" IN ('ruta_creada', 'servicio_agregado', 'servicio_quitado',
      'paradas_reordenadas', 'configuracion_declarada', 'estado_cambiado'))
);
--> statement-breakpoint
CREATE INDEX "idx_eventos_ruta_ruta" ON "eventos_ruta" ("ruta_id", "creado_en");
--> statement-breakpoint
ALTER TABLE "asignaciones" ADD COLUMN "ruta_id" uuid;
--> statement-breakpoint
ALTER TABLE "asignaciones" ADD CONSTRAINT "asignaciones_ruta_id_rutas_id_fk"
  FOREIGN KEY ("ruta_id") REFERENCES "rutas"("id") ON DELETE RESTRICT;
--> statement-breakpoint
CREATE INDEX "idx_asignaciones_ruta" ON "asignaciones" ("ruta_id");
