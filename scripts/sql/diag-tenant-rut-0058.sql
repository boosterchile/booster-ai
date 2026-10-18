-- Diagnóstico de solo lectura antes de desplegar la migración 0058 (uq_usuarios_rut).
-- Uso: scripts/db/agent-query.sh -f scripts/sql/diag-tenant-rut-0058.sql
-- Solo SELECT. No modifica nada. Ver .specs/aislamiento-hallazgos-tenant/plan.md §2.A.

SELECT '=== 1. RUTs duplicados (crudo) ===' AS paso;
SELECT rut, count(*) FROM usuarios WHERE rut IS NOT NULL GROUP BY rut HAVING count(*) > 1;

SELECT '=== 2. RUTs duplicados tras normalizar (sin puntos, K mayúscula) ===' AS paso;
SELECT upper(replace(rut, '.', '')) AS rut_norm, count(*)
FROM usuarios WHERE rut IS NOT NULL GROUP BY 1 HAVING count(*) > 1;

SELECT '=== 3. RUTs no canónicos / formato raro / nulos / total ===' AS paso;
SELECT count(*) FILTER (WHERE rut IS NOT NULL AND rut <> upper(replace(rut, '.', ''))) AS no_canonicos,
       count(*) FILTER (WHERE rut IS NOT NULL AND rut !~ '^[0-9]{7,8}-[0-9K]$') AS formato_raro,
       count(*) FILTER (WHERE rut IS NULL) AS rut_null,
       count(*) AS total
FROM usuarios;

SELECT '=== 4. Índices actuales sobre usuarios.rut (post-deploy debe existir uq_usuarios_rut) ===' AS paso;
SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'usuarios' AND indexdef ILIKE '%(rut)%';

SELECT '=== 5. Migraciones aplicadas ===' AS paso;
SELECT count(*) AS aplicadas, max(created_at) AS ultima_created_at FROM drizzle.__drizzle_migrations;

SELECT '=== 6. Empresas ===' AS paso;
SELECT count(*) AS total,
       count(*) FILTER (WHERE es_demo) AS demo,
       count(*) FILTER (WHERE es_usuario_prueba) AS prueba
FROM empresas;

SELECT '=== 7. Altas desde el panel admin (criterio de frentes-vivos.md; línea base 0 filas al 2026-09-23) ===' AS paso;
SELECT e.razon_social, e.creado_en::date, m.estado AS membresia_dueno,
       u.clave_numerica_hash IS NOT NULL AS dueno_con_clave, m.unido_en::date, u.ultimo_login_en::date
FROM empresas e
JOIN membresias m ON m.empresa_id = e.id AND m.rol = 'dueno'
JOIN usuarios u ON u.id = m.usuario_id
WHERE m.invitado_por_id IS NOT NULL
ORDER BY e.creado_en DESC LIMIT 5;

SELECT '=== 8. Usuarios con membresía activa en más de una empresa (relevante para la caché del cliente) ===' AS paso;
SELECT count(*) AS usuarios_multi_empresa FROM (
  SELECT usuario_id FROM membresias
  WHERE estado = 'activa' AND empresa_id IS NOT NULL
  GROUP BY usuario_id HAVING count(DISTINCT empresa_id) > 1
) t;

SELECT '=== 9. Columnas de dispositivos_pendientes ===' AS paso;
SELECT string_agg(column_name, ', ' ORDER BY ordinal_position)
FROM information_schema.columns WHERE table_name = 'dispositivos_pendientes';
