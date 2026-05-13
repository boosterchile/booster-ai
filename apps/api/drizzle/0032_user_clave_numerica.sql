-- Migration 0032_user_clave_numerica.sql
-- ADR-035 — Auth universal RUT + clave numérica. Añade `clave_numerica_hash`
-- al modelo `usuarios` para que cualquier rol (no solo conductor) pueda
-- autenticarse con RUT + clave de 6 dígitos.
--
-- El hash es scrypt timing-safe (mismo formato que `activacion_pin_hash`
-- de migration 0022). La plaintext nunca persiste.
--
-- También añadimos `recovery_otp_hash` + `recovery_otp_expires_at` para
-- el flow de recuperación vía WhatsApp OTP. El OTP es single-use,
-- expira en 10 minutos.

ALTER TABLE usuarios
  ADD COLUMN clave_numerica_hash text,
  ADD COLUMN recovery_otp_hash text,
  ADD COLUMN recovery_otp_expires_at timestamp with time zone;

COMMENT ON COLUMN usuarios.clave_numerica_hash IS
  'ADR-035 — scrypt hash de clave numérica (6 dígitos) usada en /auth/login-rut.';
COMMENT ON COLUMN usuarios.recovery_otp_hash IS
  'ADR-035 — scrypt hash del OTP de recovery vía WhatsApp. Single-use, expira en 10 min.';
COMMENT ON COLUMN usuarios.recovery_otp_expires_at IS
  'ADR-035 — timestamp de expiración del OTP. NULL si no hay OTP activo.';

-- Index parcial para queries del estilo "user con clave seteada" (rara,
-- pero permite analytics de adopción del nuevo flow).
CREATE INDEX idx_usuarios_clave_numerica_hash_set
  ON usuarios (id)
  WHERE clave_numerica_hash IS NOT NULL;
