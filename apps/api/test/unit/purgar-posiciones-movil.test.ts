import { describe, expect, it, vi } from 'vitest';
import { purgarPosicionesMovil } from '../../src/services/purgar-posiciones-movil.js';

const noop = (): void => undefined;
const logger = { info: vi.fn(), warn: noop, error: noop, debug: noop } as never;

describe('purgarPosicionesMovil', () => {
  it('ejecuta DELETE con retención y subquery preserva-último; retorna conteo (T1)', async () => {
    const execute = vi.fn().mockResolvedValue({ rowCount: 42 });
    const result = await purgarPosicionesMovil({ db: { execute } as never, logger });

    expect(result).toEqual({ deleted: 42, retentionDays: 30 });
    expect(execute).toHaveBeenCalledOnce();
    // El SQL DEBE excluir la última fila por vehículo (fallback de /flota).
    const sqlObj = execute.mock.calls[0]?.[0];
    const text = JSON.stringify(sqlObj);
    expect(text).toContain('DISTINCT ON (vehiculo_id)');
    expect(text).toContain('NOT IN');
    expect(text).toContain('make_interval');
  });

  it('sin filas viejas → deleted 0, idempotente (T2)', async () => {
    const execute = vi.fn().mockResolvedValue({ rowCount: 0 });
    const result = await purgarPosicionesMovil({
      db: { execute } as never,
      logger,
      retentionDays: 7,
    });
    expect(result).toEqual({ deleted: 0, retentionDays: 7 });
  });
});
