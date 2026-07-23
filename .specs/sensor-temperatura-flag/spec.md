# Spec — Distinción "sin sensor" vs "0°C real" (flag de provisioning Dallas)

## Problema (recon verificado)

`io_data['72']` (Dallas IO 72) = **0 crudo en los 4 devices, 100% de pings, cero variación** → ningún
FMC150 tiene sonda funcional. El centinela Teltonika `0x8000` (-3276.8°C) **no lo emiten** (mandan 0,
que cae en el rango válido -55..125°C). **Por VALOR, 0 es indistinguible** entre "sin sensor" y una
lectura REAL de 0°C (válida en cadena de frío 0-4°C). → La distinción **no puede venir del dato**.

## Decisión (fijada por el PO)

Criterio C: **flag de provisioning primario + varianza como sanity**. El flag es **explícito y propio** —
**NO** se deriva de `body_type='refrigerado'` (carrocería refrigerada ≠ sonda cableada al Teltonika).

## Cambios

1. **Campo** `vehiculos.tiene_sensor_temperatura` (boolean, default false). Migración **0051 expand-only**
   (ADD COLUMN con DEFAULT, Postgres 11+ sin reescritura).
2. **Endpoint** `GET /vehiculos/:id/ubicacion`: expone `temperatura_c` **solo si `tiene_sensor_temperatura`**;
   si false → `null` sin importar el crudo. **NO se special-casea 0 en el intérprete** (0°C sigue siendo
   0.0°C válido cuando corresponde). Gating en `resolverTemperaturaCarga` (puro).
3. **Sanity de varianza**: si flag=true pero los últimos `SANITY_TEMP_PINGS`(20) crudos de IO 72 son 0
   con varianza cero (≥ `SANITY_TEMP_MIN`(10) lecturas) → `temperatura_sensor_sospechoso: true` en el DTO
   + `logger.warn`. **NO es alerta nueva** — no se cablea el pipeline de notificaciones. Query extra solo
   cuando flag=true (hoy: 0 vehículos → costo cero).
4. **UI**: flag=false → `temperatura_c` null → "Sin dato" (igual que los CAN). sospechoso → hint inline
   "⚠ revisar sensor" (no alerta).

## Criterios de éxito (tests)

- flag=false → `temperatura_c` null aunque el crudo sea 0.
- flag=true + valores reales → expone (55 → 5.5°C), sospechoso=false.
- flag=true + 0 constante → `temperatura_c` **0.0 (válido, no se nulea)** + sospechoso=true.
- El intérprete Dallas existente no se rompe (0 sigue siendo 0.0°C válido).

## Fuera de alcance

Cablear notificaciones (eco-score/safety skeleton), UI de administración del flag (se setea por
provisioning/DB), backfill de vehículos con sonda (hoy: ninguno).
