-- Migration 0006 — chat shipper↔transportista por assignment (P3.a)
--
-- Diseño:
--   - 1 chat = 1 assignment. Sin tabla "chat" intermedia — los mensajes se
--     agrupan por asignacion_id directamente.
--   - Cada mensaje es 1 de 3 tipos (texto / foto / ubicacion). El campo
--     correspondiente al tipo es notNull, los demás null. CHECK constraint
--     hace cumplir esta invariante a nivel DB (defense in depth — el
--     endpoint POST también valida).
--   - read_at lo setea el OTRO lado al ver el mensaje. Permite contar
--     no-leidos por (assignment, role) con un count(*) WHERE read_at IS NULL
--     AND sender_role <> :rol.
--   - whatsapp_notif_enviado_en lo usa el cron de fallback (P3.d) para no
--     mandar el WhatsApp dos veces.
--
-- Audit: mensajes inmutables (no edit, no soft-delete por ahora).

-- 1. Enums.
CREATE TYPE "tipo_mensaje_chat" AS ENUM ('texto', 'foto', 'ubicacion');
CREATE TYPE "rol_remitente_chat" AS ENUM ('transportista', 'generador_carga');

-- 2. Tabla mensajes_chat.
CREATE TABLE "mensajes_chat" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "asignacion_id" uuid NOT NULL REFERENCES "asignaciones"("id") ON DELETE RESTRICT,
  "remitente_empresa_id" uuid NOT NULL REFERENCES "empresas"("id") ON DELETE RESTRICT,
  "remitente_usuario_id" uuid NOT NULL REFERENCES "usuarios"("id") ON DELETE RESTRICT,
  "rol_remitente" "rol_remitente_chat" NOT NULL,
  "tipo_mensaje" "tipo_mensaje_chat" NOT NULL,
  "texto" text,
  "foto_gcs_uri" text,
  "ubicacion_lat" numeric(9, 6),
  "ubicacion_lng" numeric(9, 6),
  "leido_en" timestamptz,
  "whatsapp_notif_enviado_en" timestamptz,
  "creado_en" timestamptz NOT NULL DEFAULT now(),

  -- El campo correspondiente al tipo debe estar populado, los otros null.
  CONSTRAINT "tipo_contenido_check" CHECK (
    (tipo_mensaje = 'texto' AND texto IS NOT NULL
      AND foto_gcs_uri IS NULL
      AND ubicacion_lat IS NULL AND ubicacion_lng IS NULL)
    OR
    (tipo_mensaje = 'foto' AND foto_gcs_uri IS NOT NULL
      AND texto IS NULL
      AND ubicacion_lat IS NULL AND ubicacion_lng IS NULL)
    OR
    (tipo_mensaje = 'ubicacion'
      AND ubicacion_lat IS NOT NULL AND ubicacion_lng IS NOT NULL
      AND texto IS NULL
      AND foto_gcs_uri IS NULL)
  ),
  -- Texto entre 1 y 4000 chars cuando aplica.
  CONSTRAINT "texto_length_check" CHECK (
    texto IS NULL OR (length(texto) BETWEEN 1 AND 4000)
  ),
  -- Lat/lng en rangos WGS84 cuando aplican.
  CONSTRAINT "ubicacion_rango_check" CHECK (
    (ubicacion_lat IS NULL AND ubicacion_lng IS NULL)
    OR (ubicacion_lat BETWEEN -90 AND 90 AND ubicacion_lng BETWEEN -180 AND 180)
  )
);

-- 3. Indexes.
-- Principal: traer mensajes de un chat ordenados desc para paginación
-- (cursor-based GET /:id/messages?cursor=).
CREATE INDEX "idx_mensajes_chat_asignacion_creado"
  ON "mensajes_chat"("asignacion_id", "creado_en");

-- Para el query del cron WhatsApp (P3.d): mensajes no leídos viejos sin
-- notif enviada.
CREATE INDEX "idx_mensajes_chat_no_leidos_viejos"
  ON "mensajes_chat"("leido_en", "whatsapp_notif_enviado_en", "creado_en");
