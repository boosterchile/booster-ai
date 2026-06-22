import { describe, expect, it } from 'vitest';
import {
  DUNNING_BACKOFF_DIAS,
  DUNNING_MAX_INTENTOS,
  type ResultadoGatewayPago,
  decidirSiguienteDunning,
} from '../src/index.js';

const HOY_MS = Date.UTC(2026, 5, 15, 12, 0, 0); // 2026-06-15T12:00Z

/**
 * `decidirSiguienteDunning` es la máquina de estados PURA del dunning de
 * cobro de membresías (ADR-031 §"reintentos"): dado el nº de intentos ya
 * hechos y el resultado del gateway de pago, decide el `cobroEstado`
 * siguiente, el contador de intentos y cuándo reintentar. Sin I/O, sin
 * Date.now().
 */

describe('decidirSiguienteDunning — pago exitoso (gateway real futuro)', () => {
  it('resultado "pagada" → estado "cobrada", sin próximo intento', () => {
    const r = decidirSiguienteDunning({
      intentosPrevios: 0,
      resultadoGateway: 'pagada',
      hoyMs: HOY_MS,
    });
    expect(r.cobroEstado).toBe('cobrada');
    expect(r.cobroIntentos).toBe(1);
    expect(r.proximoIntentoEnMs).toBeNull();
    expect(r.esMorosa).toBe(false);
  });
});

describe('decidirSiguienteDunning — stub no-op (pending_provider)', () => {
  it('primer intento pending → estado "pending_payment_provider", próximo en +7d', () => {
    const r = decidirSiguienteDunning({
      intentosPrevios: 0,
      resultadoGateway: 'pending_provider',
      hoyMs: HOY_MS,
    });
    expect(r.cobroEstado).toBe('pending_payment_provider');
    expect(r.cobroIntentos).toBe(1);
    expect(r.esMorosa).toBe(false);
    expect(r.proximoIntentoEnMs).toBe(HOY_MS + DUNNING_BACKOFF_DIAS * 24 * 60 * 60 * 1000);
  });

  it('segundo intento pending → estado "reintentando", próximo en +7d', () => {
    const r = decidirSiguienteDunning({
      intentosPrevios: 1,
      resultadoGateway: 'pending_provider',
      hoyMs: HOY_MS,
    });
    expect(r.cobroEstado).toBe('reintentando');
    expect(r.cobroIntentos).toBe(2);
    expect(r.esMorosa).toBe(false);
    expect(r.proximoIntentoEnMs).toBe(HOY_MS + DUNNING_BACKOFF_DIAS * 24 * 60 * 60 * 1000);
  });

  it('tercer (último) intento pending → estado "morosa", sin próximo intento', () => {
    const r = decidirSiguienteDunning({
      intentosPrevios: 2,
      resultadoGateway: 'pending_provider',
      hoyMs: HOY_MS,
    });
    expect(r.cobroIntentos).toBe(3);
    expect(r.cobroIntentos).toBe(DUNNING_MAX_INTENTOS);
    expect(r.cobroEstado).toBe('morosa');
    expect(r.esMorosa).toBe(true);
    expect(r.proximoIntentoEnMs).toBeNull();
  });
});

describe('decidirSiguienteDunning — fallo duro del gateway', () => {
  it('resultado "rechazada" en intento < max → reintentando con backoff', () => {
    const r = decidirSiguienteDunning({
      intentosPrevios: 0,
      resultadoGateway: 'rechazada',
      hoyMs: HOY_MS,
    });
    expect(r.cobroEstado).toBe('reintentando');
    expect(r.cobroIntentos).toBe(1);
    expect(r.esMorosa).toBe(false);
    expect(r.proximoIntentoEnMs).toBe(HOY_MS + DUNNING_BACKOFF_DIAS * 24 * 60 * 60 * 1000);
  });

  it('resultado "rechazada" en el 3º intento → morosa', () => {
    const r = decidirSiguienteDunning({
      intentosPrevios: 2,
      resultadoGateway: 'rechazada',
      hoyMs: HOY_MS,
    });
    expect(r.cobroEstado).toBe('morosa');
    expect(r.esMorosa).toBe(true);
    expect(r.proximoIntentoEnMs).toBeNull();
  });
});

describe('decidirSiguienteDunning — validación', () => {
  it('intentosPrevios negativo → throw', () => {
    expect(() =>
      decidirSiguienteDunning({
        intentosPrevios: -1,
        resultadoGateway: 'pending_provider',
        hoyMs: HOY_MS,
      }),
    ).toThrow(/intentosPrevios/);
  });

  it('intentosPrevios ya en el máximo → throw (no se debe reintentar una morosa)', () => {
    expect(() =>
      decidirSiguienteDunning({
        intentosPrevios: DUNNING_MAX_INTENTOS,
        resultadoGateway: 'pending_provider',
        hoyMs: HOY_MS,
      }),
    ).toThrow(/intentosPrevios/);
  });

  it('hoyMs inválido → throw', () => {
    expect(() =>
      decidirSiguienteDunning({
        intentosPrevios: 0,
        resultadoGateway: 'pending_provider',
        hoyMs: Number.NaN,
      }),
    ).toThrow(/hoyMs/);
  });

  it('resultadoGateway no soportado se rechaza en runtime (defensa para callers JS)', () => {
    const malo = 'explotó' as unknown as ResultadoGatewayPago;
    expect(() =>
      decidirSiguienteDunning({ intentosPrevios: 0, resultadoGateway: malo, hoyMs: HOY_MS }),
    ).toThrow(/resultadoGateway/);
  });
});
