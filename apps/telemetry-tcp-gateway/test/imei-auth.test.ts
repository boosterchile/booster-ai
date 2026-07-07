import { describe, expect, it, vi } from 'vitest';
import { resolveImei } from '../src/imei-auth.js';

function makeMockDb(opts: {
  vehicleRow?: { id: string };
  upsertedRow?: { id: string };
}) {
  const execute = vi
    .fn()
    .mockResolvedValueOnce({ rows: opts.vehicleRow ? [opts.vehicleRow] : [] })
    .mockResolvedValueOnce({ rows: opts.upsertedRow ? [opts.upsertedRow] : [] });
  // mock minimal de drizzle (noExplicitAny está off para tests)
  return { execute } as any;
}

const noopLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
  trace: vi.fn(),
  child: vi.fn(),
  // minimal logger mock (noExplicitAny está off para tests)
} as any;

describe('resolveImei', () => {
  it('devuelve vehicleId si el IMEI matchea un vehículo registrado', async () => {
    const db = makeMockDb({ vehicleRow: { id: 'veh-uuid-123' } });
    const result = await resolveImei({
      db,
      logger: noopLogger,
      imei: '356307042441013',
      sourceIp: '1.2.3.4',
    });
    expect(result.vehicleId).toBe('veh-uuid-123');
    expect(result.pendingDeviceId).toBeNull();
  });

  it('upsert en dispositivos_pendientes si IMEI no matchea', async () => {
    const db = makeMockDb({ upsertedRow: { id: 'pending-uuid-456' } });
    const result = await resolveImei({
      db,
      logger: noopLogger,
      imei: '999999999999999',
      sourceIp: '5.6.7.8',
    });
    expect(result.vehicleId).toBeNull();
    expect(result.pendingDeviceId).toBe('pending-uuid-456');
  });

  it('maneja sourceIp null sin tirar', async () => {
    const db = makeMockDb({ upsertedRow: { id: 'pending-uuid-789' } });
    const result = await resolveImei({
      db,
      logger: noopLogger,
      imei: '111111111111111',
      sourceIp: null,
    });
    expect(result.pendingDeviceId).toBe('pending-uuid-789');
  });

  // P1-L: open enrollment con rate limiting.
  it('NO enrolla (skip del upsert) si el rate limiter de enrollment rechaza', async () => {
    const db = makeMockDb({}); // sin match de vehículo → iría al enrollment
    const enrollmentLimiter = { tryConsume: vi.fn(() => false) };
    const result = await resolveImei({
      db,
      logger: noopLogger,
      imei: '888888888888888',
      sourceIp: '9.9.9.9',
      enrollmentLimiter,
    });
    expect(result.vehicleId).toBeNull();
    expect(result.pendingDeviceId).toBeNull();
    expect(enrollmentLimiter.tryConsume).toHaveBeenCalledTimes(1);
    // Solo corre la query de lookup de vehículo; el INSERT del upsert NO.
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it('un IMEI conocido nunca consulta el rate limiter de enrollment', async () => {
    const db = makeMockDb({ vehicleRow: { id: 'veh-1' } });
    const enrollmentLimiter = { tryConsume: vi.fn(() => false) };
    const result = await resolveImei({
      db,
      logger: noopLogger,
      imei: '356307042441013',
      sourceIp: '1.2.3.4',
      enrollmentLimiter,
    });
    expect(result.vehicleId).toBe('veh-1');
    expect(enrollmentLimiter.tryConsume).not.toHaveBeenCalled();
  });

  it('sin enrollmentLimiter (opcional) enrolla normal — backwards-compat', async () => {
    const db = makeMockDb({ upsertedRow: { id: 'pending-uuid-xyz' } });
    const result = await resolveImei({
      db,
      logger: noopLogger,
      imei: '222222222222222',
      sourceIp: '8.8.8.8',
    });
    expect(result.pendingDeviceId).toBe('pending-uuid-xyz');
  });

  // -------------------------------------------------------------------
  // D3b (W2, hito 2 CORFO / .specs/hito-2-corfo-mes-8/decisiones.md D3.b):
  // un device que fue DESASOCIADO (su row de dispositivos_pendientes queda
  // en 'reemplazado' vía el PATCH self-service) pero sigue transmitiendo
  // debe reaparecer en la bandeja de pendientes (reemplazado→pendiente) al
  // reconectar. 'rechazado' NO se reabre (el rechazo debe sobrevivir
  // reconexiones — D2). 'aprobado' no se toca acá (nunca debería llegar a
  // este upsert mientras siga vigente: el lookup de vehículo del paso 1 ya
  // habría matcheado).
  //
  // No hay Postgres real en este test unitario (db.execute está mockeado),
  // así que la verificación es sobre el TEXTO del SQL emitido: confirma que
  // el ON CONFLICT DO UPDATE incluye el CASE que reabre 'reemplazado' pero
  // preserva cualquier otro estado (rechazado/aprobado/pendiente) intacto.
  // -------------------------------------------------------------------
  it('D3b: el upsert de enrollment reabre reemplazado→pendiente pero preserva otros estados', async () => {
    const execute = vi.fn().mockResolvedValueOnce({ rows: [] }); // sin match de vehículo
    const db = { execute } as unknown as Parameters<typeof resolveImei>[0]['db'];
    execute.mockResolvedValueOnce({ rows: [{ id: 'pending-uuid-1' }] }); // el upsert

    await resolveImei({
      db,
      logger: noopLogger,
      imei: '356307042441013',
      sourceIp: '1.2.3.4',
    });

    expect(execute).toHaveBeenCalledTimes(2);
    const upsertSql = execute.mock.calls[1]?.[0];
    const text = JSON.stringify(upsertSql);
    // Reabre reemplazado → pendiente.
    expect(text).toContain("WHEN dispositivos_pendientes.estado = 'reemplazado'");
    expect(text).toContain("THEN 'pendiente'");
    // Preserva el estado actual en cualquier otro caso (rechazado/aprobado
    // sobreviven la reconexión sin ser tocados por este upsert).
    expect(text).toContain('ELSE dispositivos_pendientes.estado');
  });

  // -------------------------------------------------------------------
  // D3c: el enrollment NO debe crear/reabrir rows de dispositivos_pendientes
  // para IMEIs que YA resuelven a un vehículo — el lookup de vehículo
  // (paso 1) corre PRIMERO y, si matchea, se retorna sin tocar
  // dispositivos_pendientes en absoluto (ni INSERT ni upsert). Verificado
  // hoy: ya es así (early return antes del upsert) — este test lo deja
  // bloqueado contra regresión.
  // -------------------------------------------------------------------
  it('D3c: IMEI que matchea vehículo NO toca dispositivos_pendientes (solo 1 query)', async () => {
    const db = makeMockDb({ vehicleRow: { id: 'veh-uuid-123' } });
    const result = await resolveImei({
      db,
      logger: noopLogger,
      imei: '356307042441013',
      sourceIp: '1.2.3.4',
    });
    expect(result.vehicleId).toBe('veh-uuid-123');
    // Solo corrió el SELECT de vehículos; el upsert de dispositivos_pendientes
    // NO se ejecutó.
    expect(db.execute).toHaveBeenCalledTimes(1);
  });
});
