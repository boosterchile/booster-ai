import type { Auth } from 'firebase-admin/auth';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { desactivarUsuario } from '../../src/services/desactivar-usuario.js';

const noop = (): void => undefined;
const noopLogger = {
  trace: noop,
  debug: noop,
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: noop,
  child: () => noopLogger,
} as never;

interface DbStub {
  update: ReturnType<typeof vi.fn>;
}

function makeDb(updatedRows: { id: string }[]): DbStub {
  const returning = vi.fn(async () => updatedRows);
  const where = vi.fn(() => ({ returning }));
  const set = vi.fn(() => ({ where }));
  const update = vi.fn(() => ({ set }));
  return { update };
}

function makeAuth(behavior: { ok: true } | { fail: { code?: string; message?: string } }): Auth {
  return {
    revokeRefreshTokens: vi.fn(async () => {
      if ('fail' in behavior) {
        const e = new Error(behavior.fail.message ?? 'firebase error');
        if (behavior.fail.code) {
          (e as Error & { code: string }).code = behavior.fail.code;
        }
        throw e;
      }
      return undefined;
    }),
  } as unknown as Auth;
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('desactivarUsuario', () => {
  const baseOpts = {
    firebaseUid: 'firebase-uid-abc',
    estado: 'suspendido' as const,
    actorFirebaseUid: 'actor-uid-xyz',
    razon: 'test',
  };

  it('happy path: revoca tokens Firebase + actualiza row BD + retorna ambos OK', async () => {
    const db = makeDb([{ id: 'user-uuid' }]);
    const auth = makeAuth({ ok: true });

    const result = await desactivarUsuario({
      ...baseOpts,
      db: db as never,
      auth,
      logger: noopLogger,
    });

    expect(result).toEqual({ actualizado: true, tokensRevocados: true });
    expect(auth.revokeRefreshTokens).toHaveBeenCalledWith('firebase-uid-abc');
    expect(db.update).toHaveBeenCalledTimes(1);
  });

  it('Firebase user-not-found: no aborta, sigue con UPDATE BD para limpiar fila huérfana', async () => {
    const db = makeDb([{ id: 'user-uuid' }]);
    const auth = makeAuth({ fail: { code: 'auth/user-not-found' } });

    const result = await desactivarUsuario({
      ...baseOpts,
      db: db as never,
      auth,
      logger: noopLogger,
    });

    expect(result).toEqual({ actualizado: true, tokensRevocados: false });
    expect(noopLogger.warn).toHaveBeenCalled();
  });

  it('Firebase otro error → throw, NO updatea BD (atomicidad)', async () => {
    const db = makeDb([{ id: 'user-uuid' }]);
    const auth = makeAuth({ fail: { code: 'auth/network-error', message: 'timeout' } });

    await expect(
      desactivarUsuario({
        ...baseOpts,
        db: db as never,
        auth,
        logger: noopLogger,
      }),
    ).rejects.toThrow('timeout');

    expect(db.update).not.toHaveBeenCalled();
    expect(noopLogger.error).toHaveBeenCalled();
  });

  it('UPDATE retorna 0 rows (user no existe en BD): actualizado=false, tokensRevocados=true', async () => {
    const db = makeDb([]); // empty result
    const auth = makeAuth({ ok: true });

    const result = await desactivarUsuario({
      ...baseOpts,
      db: db as never,
      auth,
      logger: noopLogger,
    });

    expect(result).toEqual({ actualizado: false, tokensRevocados: true });
  });

  it('estado=eliminado se persiste correctamente', async () => {
    const db = makeDb([{ id: 'u' }]);
    const auth = makeAuth({ ok: true });

    await desactivarUsuario({
      ...baseOpts,
      estado: 'eliminado',
      db: db as never,
      auth,
      logger: noopLogger,
    });

    expect(noopLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({ estado: 'eliminado' }),
      'usuario desactivado',
    );
  });

  it('idempotencia: segunda llamada no rompe (ambos paths retornan OK)', async () => {
    const db = makeDb([{ id: 'u' }]);
    const auth = makeAuth({ ok: true });

    const first = await desactivarUsuario({
      ...baseOpts,
      db: db as never,
      auth,
      logger: noopLogger,
    });
    const second = await desactivarUsuario({
      ...baseOpts,
      db: db as never,
      auth,
      logger: noopLogger,
    });

    expect(first.actualizado).toBe(true);
    expect(second.actualizado).toBe(true);
    expect(auth.revokeRefreshTokens).toHaveBeenCalledTimes(2);
  });
});
