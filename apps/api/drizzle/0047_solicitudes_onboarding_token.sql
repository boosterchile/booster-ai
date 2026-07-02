-- Migration 0047 — solicitudes_registro: estado del token de onboarding one-shot
-- + firebase_uid (feature onboarding-flow-redesign, Fase 1 T1.1).
--
-- Contexto (.specs/onboarding-flow-redesign/{spec,plan}.md):
--   Hace operativo el alta gateada por admin SIN reabrir SEC-001. El predicado
--   de provisión NO es por email (eso reabriría el vector de enumeration /
--   colisión vía Google sign-in que detectó el devils-advocate de DEFINE) sino
--   un TOKEN DE UN SOLO USO emitido en el approve y consumido atómicamente en
--   el onboarding (T1.5a:
--     UPDATE solicitudes_registro
--        SET consumido_en = now()
--      WHERE id = ? AND consumido_en IS NULL RETURNING ...).
--
-- Aditiva y backward-compatible: TODAS las columnas son NULLABLE. Con el flag
-- ADMIN_PROVISIONED_ONBOARDING_ENABLED en OFF (default), `approve` mantiene el
-- comportamiento viejo (precrea el row) y NO escribe estas columnas. Esto deja
-- el sistema deployable commit-a-commit (review P0-4).
--
-- ADRs: ADR-052 (admin-approval gate) + ADR-057 (Google sign-in vivo; authz en
-- el boundary). Naming bilingüe (CLAUDE.md): columnas español snake_case sin
-- tildes; timestamptz como el resto de la tabla (migration 0039).

-- 1. token_hash: hash del token one-shot (NO el token en claro). Se guarda el
--    hash para que una fuga de la BD no entregue tokens usables. NULL mientras
--    la solicitud no tiene token emitido (pending / rechazada / legacy).
ALTER TABLE "solicitudes_registro" ADD COLUMN "token_hash" text;
--> statement-breakpoint
-- 2. consumido_en: timestamp del consumo atómico del token. NULL = no consumido.
--    El consumo (T1.5a) usa UPDATE ... WHERE consumido_en IS NULL RETURNING: si
--    no actualiza fila, el token ya fue usado (one-shot real, no doble alta).
ALTER TABLE "solicitudes_registro" ADD COLUMN "consumido_en" timestamptz;
--> statement-breakpoint
-- 3. expira_en: expiración del token (TTL). Vencido => verify (T1.2) rechaza el
--    acceso, y el job de limpieza (T1.7) recolecta el huérfano.
ALTER TABLE "solicitudes_registro" ADD COLUMN "expira_en" timestamptz;
--> statement-breakpoint
-- 4. firebase_uid: uid del usuario Firebase creado en el approve (Admin SDK).
--    Persistirlo permite a T1.7 IDENTIFICAR y borrar el usuario Firebase
--    huérfano cuando el token expira sin consumirse (review P0-5). Sin esta
--    columna el huérfano (credencial viva, email verificable) quedaría
--    indefinidamente — exactamente la superficie que el token intenta cerrar.
ALTER TABLE "solicitudes_registro" ADD COLUMN "firebase_uid" text;
--> statement-breakpoint
-- 5. Índice único parcial: un token_hash emitido es único (integridad one-shot,
--    defensa en profundidad sobre el consumo atómico). Parcial WHERE token_hash
--    IS NOT NULL para no colisionar con las múltiples filas que legítimamente lo
--    tienen NULL (pending / legacy / rechazadas).
CREATE UNIQUE INDEX "solicitudes_registro_token_hash_uq"
  ON "solicitudes_registro" ("token_hash")
  WHERE "token_hash" IS NOT NULL;
--> statement-breakpoint
COMMENT ON COLUMN "solicitudes_registro"."token_hash" IS
  'onboarding-flow-redesign T1.1: hash del token one-shot emitido en el approve (NO el token en claro). NULL = sin token. Indice unico parcial garantiza unicidad del token emitido.';
--> statement-breakpoint
COMMENT ON COLUMN "solicitudes_registro"."consumido_en" IS
  'onboarding-flow-redesign T1.1: timestamp del consumo atomico del token (T1.5a UPDATE WHERE consumido_en IS NULL RETURNING). NULL = no consumido.';
--> statement-breakpoint
COMMENT ON COLUMN "solicitudes_registro"."expira_en" IS
  'onboarding-flow-redesign T1.1: expiracion del token (TTL). Vencido => verify rechaza el acceso (T1.2) y el job de limpieza recolecta el huerfano (T1.7).';
--> statement-breakpoint
COMMENT ON COLUMN "solicitudes_registro"."firebase_uid" IS
  'onboarding-flow-redesign T1.1: uid Firebase creado en el approve. Permite a T1.7 borrar el usuario huerfano si el token expira sin consumirse (review P0-5).';
