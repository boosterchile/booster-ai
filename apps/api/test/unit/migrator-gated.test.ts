import type { Logger } from '@booster-ai/logger';
import type pg from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrationsGated } from '../../src/db/migrator.js';

// T3 SEC-001 — el wrapper `runMigrationsGated` envuelve `runMigrations`
// y aplica la política STRICT_MIGRATION_ORDERING:
//   - strict=true  → re-lanza si runMigrations falla (fail-closed).
//   - strict=false → loguea error pero NO re-lanza (legacy behavior).
//
// El test inyecta una fn `runner` via DI seam para no depender de un
// real Postgres pool — la lógica bajo test es la gate, no el SQL.

const runMigrationsMock = vi.fn();

function makeLogger() {
  return {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn().mockImplementation(function (this: unknown) {
      return this;
    }),
  } as unknown as Logger & { error: ReturnType<typeof vi.fn> };
}

const fakePool = {} as pg.Pool;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('runMigrationsGated (T3 SEC-001)', () => {
  it('strict=true + runMigrations OK → resuelve sin error', async () => {
    runMigrationsMock.mockResolvedValueOnce(undefined);
    const logger = makeLogger();
    await expect(
      runMigrationsGated(fakePool, logger, { strict: true, runner: runMigrationsMock }),
    ).resolves.toBeUndefined();
    expect(runMigrationsMock).toHaveBeenCalledOnce();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('strict=false + runMigrations OK → resuelve sin error', async () => {
    runMigrationsMock.mockResolvedValueOnce(undefined);
    const logger = makeLogger();
    await expect(
      runMigrationsGated(fakePool, logger, { strict: false, runner: runMigrationsMock }),
    ).resolves.toBeUndefined();
    expect(runMigrationsMock).toHaveBeenCalledOnce();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('strict=true + runMigrations throws → loguea ERROR y RELANZA (fail-closed)', async () => {
    const boom = new Error('migration broke');
    runMigrationsMock.mockRejectedValueOnce(boom);
    const logger = makeLogger();
    await expect(
      runMigrationsGated(fakePool, logger, { strict: true, runner: runMigrationsMock }),
    ).rejects.toBe(boom);
    expect(logger.error).toHaveBeenCalledOnce();
    const [payload, message] = (logger.error as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(payload).toMatchObject({ err: boom, strict: true });
    expect(message).toMatch(/STRICT_MIGRATION_ORDERING/);
  });

  it('strict=false + runMigrations throws → loguea ERROR y CONTINÚA (legacy)', async () => {
    const boom = new Error('migration broke');
    runMigrationsMock.mockRejectedValueOnce(boom);
    const logger = makeLogger();
    await expect(
      runMigrationsGated(fakePool, logger, { strict: false, runner: runMigrationsMock }),
    ).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledOnce();
    const [payload, message] = (logger.error as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(payload).toMatchObject({ err: boom, strict: false });
    expect(message).toMatch(/STRICT_MIGRATION_ORDERING/);
    // No swallow silencioso — el error queda loggeable a nivel ERROR.
    expect(payload.err).toBe(boom);
  });
});
