-- =============================================================================
-- Reference queries SQL — stakeholders + consentimientos
-- =============================================================================
-- Queries comunes para operaciones manuales / audit / cleanup. Snippets
-- para el equipo, NO se ejecutan automático.
--
-- Convención: usar siempre `now()` en el SELECT en vez de hardcodear fechas.
-- Postgres lo materializa una vez por query, consistente.
--
-- Ver docs/pii-handling-stakeholders-consents.md para contexto.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- 1. CONSENTS ACTIVOS para un stakeholder
-- ---------------------------------------------------------------------------
-- Devuelve los consents que están vigentes (no revocados + no expirados)
-- para un stakeholder específico. Útil para mostrar al user qué tiene
-- acceso a sus datos.
SELECT
  c.id,
  c.tipo_alcance,
  c.alcance_id,
  c.categorias_datos,
  c.otorgado_en,
  c.expira_en,
  s.organizacion_nombre AS stakeholder_nombre,
  s.tipo_stakeholder
FROM consentimientos c
JOIN stakeholders s ON s.id = c.stakeholder_id
WHERE c.stakeholder_id = :stakeholder_id
  AND c.revocado_en IS NULL
  AND (c.expira_en IS NULL OR c.expira_en > now())
ORDER BY c.otorgado_en DESC;


-- ---------------------------------------------------------------------------
-- 2. CONSENTS EXPIRANDO en próximos 30 días
-- ---------------------------------------------------------------------------
-- Para que un job nocturno notifique al user "tu consent con X vence en
-- 30 días, ¿querés renovarlo?".
SELECT
  c.id,
  c.otorgado_por_id,
  c.expira_en,
  EXTRACT(DAY FROM (c.expira_en - now())) AS dias_restantes,
  s.organizacion_nombre,
  c.categorias_datos
FROM consentimientos c
JOIN stakeholders s ON s.id = c.stakeholder_id
WHERE c.revocado_en IS NULL
  AND c.expira_en IS NOT NULL
  AND c.expira_en > now()
  AND c.expira_en <= now() + INTERVAL '30 days'
ORDER BY c.expira_en ASC;


-- ---------------------------------------------------------------------------
-- 3. CONSENT CHECK — ¿este stakeholder tiene acceso a esta categoría
-- de datos para este recurso?
-- ---------------------------------------------------------------------------
-- Patrón canónico que el service `checkStakeholderConsent` debe usar.
-- Retorna 1 row si tiene acceso, 0 rows si no.
SELECT 1
FROM consentimientos c
WHERE c.stakeholder_id = :stakeholder_id
  AND c.tipo_alcance = :scope_type
  AND c.alcance_id = :scope_id
  AND :data_category::categoria_dato_consentimiento = ANY(c.categorias_datos)
  AND c.revocado_en IS NULL
  AND (c.expira_en IS NULL OR c.expira_en > now())
LIMIT 1;


-- ---------------------------------------------------------------------------
-- 4. REVOCACIONES recientes (audit, last 7 days)
-- ---------------------------------------------------------------------------
-- Para detectar patrones anormales de revocación (¿alguien revocó masivo?).
SELECT
  c.id,
  c.otorgado_por_id,
  c.stakeholder_id,
  c.revocado_en,
  c.tipo_alcance,
  c.categorias_datos,
  s.organizacion_nombre
FROM consentimientos c
JOIN stakeholders s ON s.id = c.stakeholder_id
WHERE c.revocado_en >= now() - INTERVAL '7 days'
ORDER BY c.revocado_en DESC;


-- ---------------------------------------------------------------------------
-- 5. CONSENTS HUÉRFANOS — scope_id apunta a empresa borrada / inexistente
-- ---------------------------------------------------------------------------
-- Para detectar consents que ya no pueden cumplirse (porque el recurso
-- fuente desapareció). El cron de cleanup debe revocarlos automáticamente.
SELECT c.id, c.tipo_alcance, c.alcance_id, c.otorgado_en
FROM consentimientos c
LEFT JOIN empresas e
  ON e.id = c.alcance_id
  AND c.tipo_alcance IN ('generador_carga', 'transportista', 'organizacion')
WHERE c.revocado_en IS NULL
  AND c.tipo_alcance IN ('generador_carga', 'transportista', 'organizacion')
  AND e.id IS NULL;


-- ---------------------------------------------------------------------------
-- 6. STAKEHOLDERS POR USER
-- ---------------------------------------------------------------------------
-- Cuántos stakeholders tiene cada user (útil para dashboards admin).
SELECT
  u.id AS user_id,
  u.email,
  COUNT(s.id) AS total_stakeholders,
  COUNT(s.id) FILTER (WHERE s.tipo_stakeholder = 'mandante_corporativo') AS mandantes,
  COUNT(s.id) FILTER (WHERE s.tipo_stakeholder = 'auditor') AS auditores,
  COUNT(s.id) FILTER (WHERE s.tipo_stakeholder = 'regulador') AS reguladores,
  COUNT(s.id) FILTER (WHERE s.tipo_stakeholder = 'inversor') AS inversores
FROM usuarios u
LEFT JOIN stakeholders s ON s.usuario_id = u.id
GROUP BY u.id, u.email
HAVING COUNT(s.id) > 0
ORDER BY total_stakeholders DESC;


-- ---------------------------------------------------------------------------
-- 7. REVOCACIÓN MASIVA — todos los consents de un user
-- ---------------------------------------------------------------------------
-- En caso de "right to be forgotten" parcial: el user pide revocar TODO
-- pero mantenemos rows (audit trail Ley 19.628 + retention SII).
-- Correr en transacción + verificar count antes de commit.
BEGIN;
  UPDATE consentimientos
  SET revocado_en = now()
  WHERE otorgado_por_id = :user_id
    AND revocado_en IS NULL;
  -- Verificar: SELECT count(*) FROM consentimientos WHERE otorgado_por_id = :user_id AND revocado_en IS NULL;
  -- Si es 0, COMMIT. Si no, investigar antes.
ROLLBACK; -- safety: cambiar a COMMIT cuando se valide


-- ---------------------------------------------------------------------------
-- 8. AUDIT TRAIL — historial completo de consents otorgados/revocados por user
-- ---------------------------------------------------------------------------
-- Para Ley 19.628 art. 6 (derecho a saber qué se hizo con tu data).
SELECT
  c.id,
  c.tipo_alcance,
  c.alcance_id,
  c.categorias_datos,
  c.otorgado_en,
  c.expira_en,
  c.revocado_en,
  CASE
    WHEN c.revocado_en IS NOT NULL THEN 'revocado'
    WHEN c.expira_en < now() THEN 'expirado'
    ELSE 'activo'
  END AS estado,
  s.organizacion_nombre,
  c.documento_consentimiento_url
FROM consentimientos c
JOIN stakeholders s ON s.id = c.stakeholder_id
WHERE c.otorgado_por_id = :user_id
ORDER BY c.otorgado_en DESC;
