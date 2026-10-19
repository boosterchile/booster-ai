# Runbook — Índices parciales de GPS válido (0066)

Antes del deploy que trae la migración `0066_telemetria_gps_valido`, Ops crea
los dos índices con `CONCURRENTLY`. El migrator del API corre dentro de una
transacción y no puede usar `CONCURRENTLY`: si los índices ya existen, son
válidos y tienen esta misma definición, su `CREATE INDEX IF NOT EXISTS` es un
no-op y el arranque no toma el lock de escritura de `telemetria_puntos`.

Base: `booster_ai` en Cloud SQL (`booster-ai-494222`). Rol con permiso de DDL,
el del migrador. No uses el rol de solo lectura. Cada statement va solo, con
autocommit. No abras `BEGIN`.

`IF NOT EXISTS` mira el nombre, no la definición. El `WHERE` de acá tiene que
ser el mismo que el de `apps/api/drizzle/0066_telemetria_gps_valido.sql`.

## 1. Crear

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_telemetria_vehiculo_gps_valido"
  ON "telemetria_puntos" ("vehiculo_id", "timestamp_device" DESC)
  WHERE "latitud" IS NOT NULL
    AND "longitud" IS NOT NULL
    AND "latitud" <> 0
    AND "longitud" <> 0;
```

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_telemetria_imei_gps_valido"
  ON "telemetria_puntos" ("imei", "timestamp_device" DESC)
  WHERE "latitud" IS NOT NULL
    AND "longitud" IS NOT NULL
    AND "latitud" <> 0
    AND "longitud" <> 0;
```

Un `CREATE INDEX CONCURRENTLY` que se corta deja el índice creado e inválido.
El `IF NOT EXISTS` de un reintento no lo reconstruye.

## 2. Verificar

```sql
SELECT c.relname, i.indisvalid, pg_get_indexdef(i.indexrelid) AS definicion
FROM pg_class c
JOIN pg_index i ON i.indexrelid = c.oid
WHERE c.relname IN (
  'idx_telemetria_vehiculo_gps_valido',
  'idx_telemetria_imei_gps_valido'
);
```

Tienen que salir las dos filas, las dos con `indisvalid = true`, y la
definición con `timestamp_device DESC` y el `WHERE` de arriba (`IS NOT NULL`
y `<> 0` en latitud y longitud).

## 3. Si queda INVALID

Para cada fila con `indisvalid = false`, tirar ese índice y volver a crearlo
con el statement del paso 1. No toques el que ya está válido.

```sql
DROP INDEX CONCURRENTLY IF EXISTS "idx_telemetria_vehiculo_gps_valido";
```

```sql
DROP INDEX CONCURRENTLY IF EXISTS "idx_telemetria_imei_gps_valido";
```

Después del drop, repetir el `CREATE INDEX CONCURRENTLY IF NOT EXISTS` de ese
nombre y volver a correr la verificación. Seguir recién cuando las dos filas
dan `indisvalid = true`.

## 4. Deploy

Con los dos índices válidos, el deploy puede seguir. El migrator registra
`0066` y no reconstruye los índices.

Si este paso no se corrió, el migrator igual los crea (`IF NOT EXISTS`, sin
`CONCURRENTLY`) y toma lock de `telemetria_puntos` mientras los construye.

## Rollback en prod

A mano, fuera de una transacción. El archivo `drizzle/down/` no lo aplica el
migrator (ADR-066) y sus `DROP INDEX IF EXISTS` no llevan `CONCURRENTLY`.

```sql
DROP INDEX CONCURRENTLY IF EXISTS "idx_telemetria_imei_gps_valido";
DROP INDEX CONCURRENTLY IF EXISTS "idx_telemetria_vehiculo_gps_valido";
```
