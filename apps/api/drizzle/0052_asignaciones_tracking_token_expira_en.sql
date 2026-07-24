-- Migration 0052 — asignaciones.tracking_token_expira_en: expiración/revocación
-- del token público de tracking (fix privacidad,
-- .specs/tracking-privacy-position-ttl/).
--
-- Motivo: GET /public/tracking/:token exponía la posición viva del vehículo sin
-- importar trip.status, y el tracking_token_publico NO expiraba ni se revocaba
-- → un link filtrado/viejo revelaba la ubicación ACTUAL del vehículo
-- indefinidamente, incluso en viajes futuros no relacionados. Además del corte
-- de posición por estado (en get-public-tracking.ts), esta columna da TTL:
-- override explícito de expiración. NULL = derivar en el servicio
-- (entregado/cancelado + N días, cap absoluto desde aceptado_en —
-- computeTokenExpiry); si se setea, gana (setearla a un instante pasado revoca
-- el token → 404 neutro).
--
-- Expand-only (ADR-066): solo ADD COLUMN nullable (Postgres materializa en
-- catálogo, sin reescritura bloqueante). default NULL = comportamiento derivado
-- (no requiere backfill). Rollback de código seguro (una revisión previa ignora
-- la columna). Reverse manual en
-- drizzle/down/0052_asignaciones_tracking_token_expira_en.down.sql.

ALTER TABLE asignaciones
  ADD COLUMN tracking_token_expira_en timestamptz;
--> statement-breakpoint

COMMENT ON COLUMN asignaciones.tracking_token_expira_en IS
  'Fix privacidad tracking publico: override de expiracion del tracking_token_publico. NULL = derivar en el servicio (entregado/cancelado + N dias, cap absoluto desde aceptado_en). Seteada a un instante pasado = revocacion manual del token (404 neutro).';
