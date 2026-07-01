-- Migration 0043 — Evidencia verificable de consentimiento (Ley 21.719)
--
-- Frente F1 de .specs/consent-idor-y-modelo-19628-21719/ (ADR-068). La Ley
-- N° 21.719 (vigente 01-dic-2026) exige evidencia verificable de cada
-- aceptación: identidad, finalidades marcadas, fecha/hora, VERSIÓN DEL AVISO
-- e IP/DISPOSITIVO. La tabla `consentimientos` ya cubre identidad
-- (otorgado_por_id), finalidades (categorias_datos), fecha (otorgado_en) y
-- documento (documento_consentimiento_url); faltaban versión del aviso e
-- IP/UA del otorgamiento.
--
-- Réplica del patrón ya usado en carrier_memberships (consent_terms_v2_ip /
-- consent_terms_v2_user_agent). Captura en el handler POST /me/consents vía
-- extractClientIp(x-forwarded-for) + user-agent.
--
-- Expand-only (audit P1-H / ADR-066): solo ADD COLUMN nullable, sin default,
-- sin NOT NULL, sin DROP. Los consents existentes quedan con estas columnas
-- en NULL: no se inventa evidencia retroactiva (no backfill). El rollback de
-- código es seguro — cualquier revisión previa encuentra un esquema que aún
-- soporta lo que esperaba.
--
-- Riesgo de despliegue: bajo. No afecta filas existentes ni constraints.
ALTER TABLE "consentimientos" ADD COLUMN "version_aviso" varchar(20);
--> statement-breakpoint
ALTER TABLE "consentimientos" ADD COLUMN "ip_otorgamiento" text;
--> statement-breakpoint
ALTER TABLE "consentimientos" ADD COLUMN "user_agent_otorgamiento" text;
