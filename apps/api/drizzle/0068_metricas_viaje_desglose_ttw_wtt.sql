-- HC-003 T1 — desglose TTW / WTT e intensidad en metricas_viaje.
-- El calculador ya devuelve los tres valores; hasta ahora se descartaban y el
-- certificado los mostraba vacíos. Aditiva y nullable: SIN backfill (las filas
-- existentes quedan NULL hasta su próximo recálculo).
-- Corresponden al MISMO cálculo que respalda el WTW vigente del certificado:
-- el real si existe, si no el estimado.
ALTER TABLE metricas_viaje ADD COLUMN IF NOT EXISTS emisiones_kgco2e_ttw numeric(10, 3);
ALTER TABLE metricas_viaje ADD COLUMN IF NOT EXISTS emisiones_kgco2e_wtt numeric(10, 3);
ALTER TABLE metricas_viaje ADD COLUMN IF NOT EXISTS intensidad_gco2e_por_tkm numeric(12, 3);
-- Fuente de los factores usados en ESE cálculo (la plantilla la lee de aquí, no de una constante).
ALTER TABLE metricas_viaje ADD COLUMN IF NOT EXISTS factores_fuente text;
-- Referencia HuellaChile 2025 (MMA), solo para mostrar (HC-004 ux.md §14):
-- factores por litro de diésel guardados en la emisión; NULL si no es diésel.
-- kg_ref = litros × (ttw_ref + wtt_ref).
ALTER TABLE metricas_viaje ADD COLUMN IF NOT EXISTS ttw_ref numeric(6, 3);
ALTER TABLE metricas_viaje ADD COLUMN IF NOT EXISTS wtt_ref numeric(6, 3);
ALTER TABLE metricas_viaje ADD COLUMN IF NOT EXISTS fuente_ref text;
