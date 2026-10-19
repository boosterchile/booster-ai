import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { describe, expect, it } from 'vitest';
import * as schema from '../db/schema.js';
import {
  INDICE_GPS_VALIDO_IMEI,
  INDICE_GPS_VALIDO_VEHICULO,
  queryUltimaPosicionGpsValida,
} from './ultima-posicion-gps.js';

const VEHICULO = '00000000-0000-4000-8000-000000000001';

describe('queryUltimaPosicionGpsValida', () => {
  it('deja el 0 literal y LIMIT 1 para calzar el índice parcial', () => {
    const db = drizzle({} as never, { schema });
    const porVehiculo = queryUltimaPosicionGpsValida(db, { vehiculoId: VEHICULO }).toSQL();
    expect(porVehiculo.sql.toLowerCase()).toContain('<> 0');
    expect(porVehiculo.sql.toLowerCase()).toMatch(/limit/);
    expect(porVehiculo.sql).not.toMatch(/<>\s+\$/);
    expect(porVehiculo.params.filter((param) => param !== 1)).toEqual([VEHICULO]);

    const porImei = queryUltimaPosicionGpsValida(db, { imei: '860000000000001' }).toSQL();
    expect(porImei.sql.toLowerCase()).toContain('<> 0');
    expect(porImei.sql).not.toMatch(/<>\s+\$/);
    expect(porImei.params.filter((param) => param !== 1)).toEqual(['860000000000001']);
  });

  it('0066 es IF NOT EXISTS y el runbook repite la misma definición', () => {
    const migracion = sentenciasCreate(
      readFileSync(resolve(__dirname, '../../drizzle/0066_telemetria_gps_valido.sql'), 'utf8'),
    );
    expect(migracion).toHaveLength(2);
    expect(migracion[0]).toContain(`IF NOT EXISTS "${INDICE_GPS_VALIDO_VEHICULO}"`);
    expect(migracion[1]).toContain(`IF NOT EXISTS "${INDICE_GPS_VALIDO_IMEI}"`);
    expect(whereDe(migracion[0] ?? '')).toBe(whereDe(migracion[1] ?? ''));

    const runbook = readFileSync(
      resolve(__dirname, '../../../../docs/runbooks/indice-parcial-gps-0066.md'),
      'utf8',
    );
    const concurrentes = [...runbook.matchAll(/```sql\n(CREATE INDEX CONCURRENTLY[\s\S]*?);/g)].map(
      (match) => match[1] ?? '',
    );
    expect(concurrentes).toHaveLength(2);
    expect(definicion(concurrentes[0] ?? '')).toBe(definicion(migracion[0] ?? ''));
    expect(definicion(concurrentes[1] ?? '')).toBe(definicion(migracion[1] ?? ''));

    const down = readFileSync(
      resolve(__dirname, '../../drizzle/down/0066_telemetria_gps_valido.down.sql'),
      'utf8',
    );
    expect(down).toContain('DROP INDEX IF EXISTS "idx_telemetria_vehiculo_gps_valido"');
    expect(down).toContain('DROP INDEX IF EXISTS "idx_telemetria_imei_gps_valido"');
    expect(down).toContain(
      'DROP INDEX CONCURRENTLY IF EXISTS "idx_telemetria_vehiculo_gps_valido"',
    );
    expect(down).toContain('DROP INDEX CONCURRENTLY IF EXISTS "idx_telemetria_imei_gps_valido"');
  });
});

/** Saca los CREATE del archivo, sin comentarios. El SQL de Ops va comentado. */
function sentenciasCreate(sql: string): string[] {
  return sql
    .split('--> statement-breakpoint')
    .map((bloque) =>
      bloque
        .split('\n')
        .filter((linea) => !linea.trim().startsWith('--'))
        .join('\n')
        .trim(),
    )
    .filter((bloque) => /CREATE INDEX/i.test(bloque));
}

/** Misma definición: IF NOT EXISTS, columnas y WHERE, sin el CONCURRENTLY de Ops. */
function definicion(sql: string): string {
  return sql
    .replace(/CREATE INDEX CONCURRENTLY/gi, 'CREATE INDEX')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/;$/, '');
}

function whereDe(sql: string): string {
  const desde = sql.toLowerCase().indexOf('where');
  return definicion(desde === -1 ? '' : sql.slice(desde));
}
