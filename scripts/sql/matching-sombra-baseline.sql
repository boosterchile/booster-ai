-- =============================================================================
-- Baseline flota + viajes para contrastar matching vigente vs elegibilidad
-- =============================================================================
-- Solo SELECT. Uso:
--   scripts/db/agent-query.sh -f scripts/sql/matching-sombra-baseline.sql
--   # o: scripts/db/connect.sh -f scripts/sql/matching-sombra-baseline.sql
--
-- No decide ofertas; alimenta el handoff de evidencia sombra → activa.
-- Identificadores de empresa/viaje se omiten o se acotan; no pegar PII en chats.
-- =============================================================================

-- 1) Flota activa: carrocería, categoría, capacidades
SELECT
  categoria_unidad,
  tipo_unidad,
  carroceria IS NULL AS sin_carroceria,
  carroceria,
  count(*) AS n,
  count(*) FILTER (WHERE capacidad_m3 IS NOT NULL) AS con_volumen,
  round(avg(capacidad_kg)::numeric, 0) AS kg_promedio
FROM vehiculos
WHERE estado_vehiculo = 'activo'
GROUP BY 1, 2, 3, 4
ORDER BY n DESC, categoria_unidad, tipo_unidad;

-- 2) Conteo de carrocerías vacías (gate de riesgo al pasar a activa)
SELECT
  count(*) AS activos,
  count(*) FILTER (WHERE carroceria IS NULL) AS sin_carroceria,
  count(*) FILTER (WHERE categoria_unidad = 'arrastre') AS arrastres
FROM vehiculos
WHERE estado_vehiculo = 'activo';

-- 3) Viajes recientes por tipo de carga (90 d)
SELECT
  tipo_carga,
  count(*) AS n,
  count(*) FILTER (WHERE carga_volumen_m3 IS NOT NULL) AS con_volumen,
  round(avg(carga_peso_kg)::numeric, 0) AS kg_promedio
FROM viajes
WHERE creado_en > now() - interval '90 days'
GROUP BY 1
ORDER BY n DESC;

-- 4) Matching recientes: ofertas creadas (proxy de tráfico matching)
SELECT
  date_trunc('day', o.creado_en) AS dia,
  count(*) AS ofertas,
  count(DISTINCT o.viaje_id) AS viajes
FROM ofertas o
WHERE o.creado_en > now() - interval '90 days'
GROUP BY 1
ORDER BY 1 DESC
LIMIT 30;

-- 5) Últimos viajes con peso (muestra acotada, sin razón social)
SELECT
  v.codigo_seguimiento,
  v.tipo_carga,
  v.carga_peso_kg,
  v.carga_volumen_m3,
  v.estado,
  v.creado_en
FROM viajes v
ORDER BY v.creado_en DESC
LIMIT 20;
