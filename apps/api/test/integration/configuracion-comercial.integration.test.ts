import {
  CONFIGURACION_COMERCIAL_INICIAL,
  type ConfiguracionComercial,
} from '@booster-ai/shared-schemas';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import * as schema from '../../src/db/schema.js';
import {
  leerConfiguracionPublicada,
  listarHistorialConfiguracion,
  publicarConfiguracionComercial,
} from '../../src/services/configuracion-comercial.js';
import { type TestDbHandle, createTestDb } from '../helpers/test-db.js';

/**
 * ADR-079 §3 contra Postgres real: publicar crea una versión nueva y la deja
 * como única publicada; la anterior queda en el historial sin cambios
 * (nunca UPDATE de su config); publicaciones concurrentes no rompen el
 * singleton ni repiten número de versión.
 */
const con = (spot: number): ConfiguracionComercial => ({
  ...CONFIGURACION_COMERCIAL_INICIAL,
  comisiones: { ...CONFIGURACION_COMERCIAL_INICIAL.comisiones, spot_pct: spot },
});

describe('integration: configuración comercial (ADR-079 §3)', () => {
  let handle: TestDbHandle;

  beforeAll(() => {
    handle = createTestDb();
  });
  afterAll(async () => {
    await handle.pool.end();
  });

  test('publicar crea versión nueva publicada y conserva la anterior intacta', async () => {
    const antes = await leerConfiguracionPublicada(handle.db);
    const nueva = await publicarConfiguracionComercial({
      db: handle.db,
      config: con(18),
      notaCambio: 'baja spot a 18 %',
      adminEmail: 'admin@boosterchile.com',
    });

    expect(nueva.version).toBe(antes.version + 1);
    const ahora = await leerConfiguracionPublicada(handle.db);
    expect(ahora.id).toBe(nueva.id);
    expect(ahora.config.comisiones.spot_pct).toBe(18);
    expect(ahora.notaCambio).toBe('baja spot a 18 %');

    const [anterior] = await handle.db
      .select()
      .from(schema.configuracionComercial)
      .where(eq(schema.configuracionComercial.id, antes.id));
    expect(anterior?.publicada).toBe(false);
    expect(anterior?.config).toEqual(antes.config);

    const historial = await listarHistorialConfiguracion(handle.db);
    expect(historial[0]?.id).toBe(nueva.id);
  });

  test('publicaciones concurrentes: una sola publicada y versiones distintas', async () => {
    const resultados = await Promise.all(
      [17, 16, 15].map((spot) =>
        publicarConfiguracionComercial({
          db: handle.db,
          config: con(spot),
          notaCambio: `concurrente ${spot}`,
          adminEmail: 'admin@boosterchile.com',
        }),
      ),
    );
    const versiones = new Set(resultados.map((r) => r.version));
    expect(versiones.size).toBe(3);

    const publicadas = await handle.db
      .select()
      .from(schema.configuracionComercial)
      .where(eq(schema.configuracionComercial.publicada, true));
    expect(publicadas).toHaveLength(1);
    expect(publicadas[0]?.version).toBe(Math.max(...versiones));
  });
});
