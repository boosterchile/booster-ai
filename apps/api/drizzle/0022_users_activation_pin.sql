-- Migration 0022 — PIN de activación para conductores (D9)
--
-- Añade `activacion_pin_hash` TEXT nullable a `usuarios` para el flujo
-- driver-activate.
--
-- Flujo:
--   1. Carrier crea conductor → backend genera PIN aleatorio 6 dígitos +
--      hash scrypt + lo guarda en `activacion_pin_hash`. Devuelve el PIN
--      plaintext UNA SOLA VEZ en la respuesta del POST /conductores.
--   2. Carrier muestra el PIN al conductor (UI con botón "copiar", borra
--      al cambiar de pantalla).
--   3. Conductor abre /login/conductor → ingresa RUT + PIN.
--   4. Backend POST /auth/driver-activate verifica:
--      - user.rut matchea
--      - scryptVerify(pin, user.activacion_pin_hash) === true
--      Si pasa:
--      - Crea Firebase user real via Admin SDK (email sintético
--        `rut+<rut>@drivers.boosterchile.com`, password = PIN para que
--        subsecuentes logins funcionen con email/pass)
--      - UPDATE users SET firebase_uid=<real>, email=<sintético>,
--        activacion_pin_hash=NULL, status='activo'
--      - Devuelve Firebase custom token para signInWithCustomToken
--
-- Después de activar, el conductor usa Firebase email/password con su
-- email sintético. Puede cambiar la contraseña desde /app/perfil.
--
-- Índice `idx_usuarios_rut`: queries del driver-login son `WHERE rut = ?`
-- — sin índice tendría seq scan. RUT no es UNIQUE en `usuarios`
-- (deliberado — un user pre-onboarding puede no tener RUT cargado todavía),
-- así que no podemos crear índice UNIQUE.
--
-- Riesgo deploy: bajo. ADD COLUMN nullable es metadata-only. Index CREATE
-- requiere lock corto. Reversible con DROP.

ALTER TABLE "usuarios" ADD COLUMN "activacion_pin_hash" text;

CREATE INDEX "idx_usuarios_rut" ON "usuarios" ("rut");
