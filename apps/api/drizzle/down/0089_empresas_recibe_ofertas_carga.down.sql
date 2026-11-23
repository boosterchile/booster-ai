-- REVERSE-SQL MANUAL — 0089_empresas_recibe_ofertas_carga
-- Expand-only: tres columnas nuevas en empresas. Bajarlas pierde qué
-- empresas tenían apagadas las ofertas de carga; todas vuelven a recibirlas.

ALTER TABLE empresas
  DROP COLUMN IF EXISTS recibe_ofertas_carga_cambiado_por,
  DROP COLUMN IF EXISTS recibe_ofertas_carga_cambiado_en,
  DROP COLUMN IF EXISTS recibe_ofertas_carga;
