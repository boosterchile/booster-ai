-- =============================================================================
-- Merge manual de 2 users con email = 'fvicencio@gmail.com'
-- =============================================================================
-- Contexto: Firebase Auth está configurado para crear cuentas separadas por
-- provider (default). Felipe se registró con email/password y luego se logueó
-- con Google del mismo email → 2 firebase_uids → 2 rows en `users`.
--
-- Plan:
--   1. Diagnóstico — ver ambos users + cualquier dato relacionado
--   2. Decidir qué firebase_uid mantener (el de Google es el actual / activo)
--   3. UPDATE el user que tiene memberships con el firebase_uid del nuevo
--   4. DELETE el user duplicado
--
-- Después de ejecutar esto:
--   - El commit ff47aa2 + el siguiente con el fix de account linking
--     evitarán que vuelva a pasar.
--   - Activar "One account per email" en Firebase Auth Settings.
-- =============================================================================

-- (1) DIAGNÓSTICO — leer ambos users
SELECT id, firebase_uid, email, full_name, status, creado_en
FROM usuarios
WHERE email = 'fvicencio@gmail.com'
ORDER BY creado_en;

-- (1b) ¿Qué memberships tiene cada uno?
SELECT u.id AS user_id, u.firebase_uid, m.id AS membership_id, m.role, m.status, e.legal_name
FROM usuarios u
LEFT JOIN memberships m ON m.user_id = u.id
LEFT JOIN empresas e ON e.id = m.empresa_id
WHERE u.email = 'fvicencio@gmail.com'
ORDER BY u.creado_en;

-- =============================================================================
-- (2) MERGE — REVISAR antes de ejecutar
-- =============================================================================
-- ⚠ Esto asume:
--   - El user VIEJO (con membership) se llama "user_old"
--   - El user NUEVO (sin membership, creado por Google) se llama "user_new"
--   - Mantenemos el user_old (tiene relaciones) y le actualizamos
--     el firebase_uid al del user_new (Google) para que el siguiente
--     login con Google encuentre el user.
--   - Borramos el user_new.
--
-- Reemplazá los UUIDs después de revisar el output de (1).

BEGIN;

-- (2a) Actualizar firebase_uid del user_old al del user_new
UPDATE usuarios
SET firebase_uid = '<FIREBASE_UID_GOOGLE_NEW>',
    actualizado_en = now()
WHERE id = '<USER_OLD_UUID>'
  AND email = 'fvicencio@gmail.com';

-- (2b) Borrar el user_new (no debe tener memberships ni nada)
-- Si tiene relaciones, ROLLBACK y revisar.
DELETE FROM usuarios
WHERE id = '<USER_NEW_UUID>'
  AND email = 'fvicencio@gmail.com';

-- Verificar antes de COMMIT
SELECT id, firebase_uid, email FROM usuarios WHERE email = 'fvicencio@gmail.com';

-- Si todo OK:
COMMIT;
-- Si algo raro:
-- ROLLBACK;
