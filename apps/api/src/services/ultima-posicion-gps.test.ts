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

  it('la migración 0066 declara los dos índices con el mismo predicado', () => {
    const sql = readFileSync(
      resolve(__dirname, '../../drizzle/0066_telemetria_gps_valido.sql'),
      'utf8',
    );
    expect(sql).toContain(INDICE_GPS_VALIDO_VEHICULO);
    expect(sql).toContain(INDICE_GPS_VALIDO_IMEI);
    expect(sql).toContain('timestamp_device" DESC');
    expect(sql.toLowerCase()).toContain('"latitud" is not null');
    expect(sql.toLowerCase()).toContain('"longitud" is not null');
    expect(sql).toContain('"latitud" <> 0');
    expect(sql).toContain('"longitud" <> 0');
  });
});
