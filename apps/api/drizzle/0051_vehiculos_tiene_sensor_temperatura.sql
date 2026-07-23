-- Migration 0051 — vehiculos.tiene_sensor_temperatura: flag de provisioning de
-- sonda Dallas (IO 72) cableada al Teltonika.
--
-- Motivo (recon .specs/sensor-temperatura-flag/): io_data['72']=0 crudo lo
-- emiten los FMC150 SIN sonda (no el centinela 0x8000), y 0°C es una lectura
-- VÁLIDA en cadena de frío (0-4°C). Por VALOR es indistinguible "sin sensor"
-- de "0°C real" → la distinción tiene que venir de provisioning, no del dato.
-- NO se deriva de body_type='refrigerado' (carrocería refrigerada ≠ sonda
-- cableada al Teltonika — son cosas distintas; el flag es explícito y propio).
--
-- Expand-only (ADR-066): solo ADD COLUMN con DEFAULT (Postgres 11+, materializa
-- en catálogo sin reescritura bloqueante). default false = estado real actual
-- (0 vehículos con sonda funcional). Rollback de código seguro (una revisión
-- previa ignora la columna). Reverse manual en
-- drizzle/down/0051_vehiculos_tiene_sensor_temperatura.down.sql.

ALTER TABLE vehiculos
  ADD COLUMN tiene_sensor_temperatura boolean NOT NULL DEFAULT false;
--> statement-breakpoint

COMMENT ON COLUMN vehiculos.tiene_sensor_temperatura IS
  'Provisioning: true si el vehiculo tiene sonda Dallas (IO 72) cableada al Teltonika. El endpoint /vehiculos/:id/ubicacion solo expone temperatura_c si es true; si false, temperatura_c=null sin importar el crudo (0C es lectura valida, no inferible del valor). Desacoplado de body_type refrigerado.';
