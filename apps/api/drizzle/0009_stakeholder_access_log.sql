-- Migration 0009 — Audit log de accesos de stakeholders a data PII/ESG
--
-- Cierra ADR-028 §"Acciones derivadas §8" (audit log bloqueante para
-- accesos stakeholder). Cada handler que sirve data ESG a un stakeholder
-- llama `checkStakeholderConsent()` y luego `recordStakeholderAccess()`
-- (apps/api/src/services/consent.ts). Si la insertion en este tabla
-- falla, el handler debe abortar y NO retornar data (audit bloqueante).
--
-- Diseño:
--   - Append-only. Nunca se hace UPDATE/DELETE en estas filas.
--   - Particionable por mes en el futuro si volumen lo requiere
--     (CREATE TABLE ... PARTITION BY RANGE (accedido_en)). Por ahora
--     1 tabla simple.
--   - bigserial id para garantizar orden de insertion (timestamp puede
--     colisionar en alta concurrencia).
--   - Indices por accedido_en, stakeholder_id, consentimiento_id para
--     queries típicas de audit (¿quién accedió a qué cuándo?).
--
-- Riesgo de despliegue: bajo. CREATE TABLE nuevo, no afecta tablas
-- existentes. Idempotente: la app no escribe hasta que el deploy del
-- backend con consent.ts esté activo.
--
-- Right-to-be-forgotten Ley 19.628: en proceso separado a los 5 años de
-- retención, los `actor_firebase_uid` y `target_alcance_id` pueden
-- anonymizarse (hash o NULL) sin perder la auditabilidad temporal.
-- Diseño legal pendiente.

CREATE TABLE log_acceso_stakeholder (
  id bigserial PRIMARY KEY,
  accedido_en timestamptz NOT NULL DEFAULT now(),
  stakeholder_id uuid NOT NULL REFERENCES stakeholders (id),
  consentimiento_id uuid NOT NULL REFERENCES consentimientos (id),
  tipo_alcance tipo_alcance_consentimiento NOT NULL,
  alcance_id uuid NOT NULL,
  categoria_dato categoria_dato_consentimiento NOT NULL,
  http_path varchar(500) NOT NULL,
  actor_firebase_uid varchar(128) NOT NULL,
  bytes_servidos integer NOT NULL DEFAULT 0
);

CREATE INDEX idx_log_acceso_stakeholder_accedido_en
  ON log_acceso_stakeholder (accedido_en);

CREATE INDEX idx_log_acceso_stakeholder_stakeholder
  ON log_acceso_stakeholder (stakeholder_id);

CREATE INDEX idx_log_acceso_stakeholder_consentimiento
  ON log_acceso_stakeholder (consentimiento_id);
