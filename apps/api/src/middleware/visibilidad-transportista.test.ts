import type { Logger } from '@booster-ai/logger';
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { crearGuardiaVisibilidadTransportista } from './visibilidad-transportista.js';

const noop = (): void => undefined;
function makeLogger() {
  return { trace: noop, debug: noop, info: noop, warn: noop, error: vi.fn(), fatal: noop };
}

function app(payload: unknown, log = makeLogger()) {
  const a = new Hono();
  a.use('/offers/*', crearGuardiaVisibilidadTransportista({ logger: log as never as Logger }));
  a.get('/offers/mine', (c) => c.json(payload as Record<string, unknown>));
  a.get('/offers/texto', (c) => c.text('comision_clp'));
  return { a, log };
}

describe('guardia de visibilidad para transportista (ADR-079 §5)', () => {
  it('deja pasar una respuesta sin claves del generador', async () => {
    const { a } = app({ offers: [{ id: 'o1', proposed_price_clp: 700_000 }] });
    const res = await a.request('/offers/mine');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ offers: [{ id: 'o1', proposed_price_clp: 700_000 }] });
  });

  it('una clave privada del generador en cualquier nivel → 500 fail-closed y error logueado', async () => {
    const { a, log } = app({ offers: [{ id: 'o1', detalle: { precio_generador_clp: 840_000 } }] });
    const res = await a.request('/offers/mine');
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain('840000');
    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({ claves: ['precio_generador_clp'], path: '/offers/mine' }),
      'visibilidad: respuesta a transportista con claves del generador',
    );
  });

  it('solo inspecciona JSON (un texto que menciona la palabra no es violación)', async () => {
    const { a } = app({});
    expect((await a.request('/offers/texto')).status).toBe(200);
  });
});
