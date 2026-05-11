-- ADR-024 sprint X+1 → wire — DTE provider metadata en facturas_booster_clp.
--
-- Agrega 3 columnas para:
--   - `dte_provider`: tag del adapter que emitió ('sovos'|'mock'|'bsale'|...).
--     Permite reconciliar histórico cuando rotamos provider.
--   - `dte_provider_track_id`: id opaco del provider para soporte/auditoría.
--   - `dte_status`: status SII canónico mapeado (`aceptado|rechazado|reparable|
--     en_proceso|anulado`). El cron de reconciliación lee este campo.
--
-- Index parcial por `dte_status` para el cron de reconciliación que
-- busca rows con DTE emitido pero status pendiente.

ALTER TABLE facturas_booster_clp ADD COLUMN dte_provider text;
ALTER TABLE facturas_booster_clp ADD COLUMN dte_provider_track_id text;
ALTER TABLE facturas_booster_clp ADD COLUMN dte_status text;

CREATE INDEX idx_facturas_dte_status
  ON facturas_booster_clp (dte_status)
  WHERE dte_status IS NOT NULL;
