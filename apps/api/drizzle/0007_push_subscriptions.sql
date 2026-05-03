-- Migration 0007 — Web Push subscriptions (P3.c)
--
-- 1 row por user × device (PWA en celular + browser desktop = 2 rows del mismo
-- user, distinguidos por endpoint UNIQUE).
--
-- UPSERT por endpoint al re-suscribir: si el browser revoca y el user vuelve
-- a aceptar el permiso, el endpoint puede cambiar (depende del provider) o
-- mantenerse, pero el ON CONFLICT (endpoint) DO UPDATE permite cualquier
-- caso sin duplicar.
--
-- Soft-delete via status='inactiva' cuando el push service devuelve 410 Gone
-- (subscription expirada / browser revocado). Conservar audit trail.

CREATE TYPE "estado_push_subscription" AS ENUM ('activa', 'inactiva');

CREATE TABLE "push_subscriptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "usuario_id" uuid NOT NULL REFERENCES "usuarios"("id") ON DELETE CASCADE,
  "endpoint" text NOT NULL,
  "p256dh_key" text NOT NULL,
  "auth_key" text NOT NULL,
  "user_agent" text,
  "estado" "estado_push_subscription" NOT NULL DEFAULT 'activa',
  "ultimo_fallo_en" timestamptz,
  "creado_en" timestamptz NOT NULL DEFAULT now(),
  "actualizado_en" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "uq_push_subscriptions_endpoint" UNIQUE ("endpoint")
);

CREATE INDEX "idx_push_subscriptions_user_activa"
  ON "push_subscriptions"("usuario_id", "estado");
