-- Migration 0058 — RUT de persona único.
--
-- idx_usuarios_rut no era UNIQUE. login-rut y /auth/activar hacen LIMIT 1
-- sin ORDER BY: dos filas con el mismo RUT vuelven el login no determinista.
-- PostgreSQL permite varios NULL en un UNIQUE (ADR-034: rut NULL solo para
-- stakeholder internacional).
--
-- Expand-only si no hay duplicados. Si esta migración falla, no borrar filas.
-- Diagnóstico:
--   SELECT rut, count(*) FROM usuarios
--   WHERE rut IS NOT NULL
--   GROUP BY rut HAVING count(*) > 1;
--
-- Primero el índice único. Si el CREATE falla, idx_usuarios_rut sigue ahí.

CREATE UNIQUE INDEX "uq_usuarios_rut" ON "usuarios" ("rut");
--> statement-breakpoint
DROP INDEX IF EXISTS "idx_usuarios_rut";
