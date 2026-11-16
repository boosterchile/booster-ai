import type { Logger } from '@booster-ai/logger';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createInvitacionCorreoToken } from '../services/invitar-correo-cuenta-token.js';
import { createAuthInvitarCuentaRoutes } from './auth-invitar-cuenta.js';

/**
 * ADR-093 — GET/POST /auth/invitar-cuenta (TDD auth crítico).
 */

const observabilidad = vi.hoisted(() => ({
  contadores: [] as Array<{ nombre: string; labels: Record<string, unknown> }>,
}));
vi.mock('../observability/business-metrics.js', () => ({
  getBusinessCounter: (nombre: string) => ({
    add: (_v: number, labels: Record<string, unknown> = {}) => {
      observabilidad.contadores.push({ nombre, labels });
    },
  }),
}));
vi.mock('../observability/business-span.js', () => ({
  withBusinessSpan: async (
    _o: { name: string },
    fn: (span: { atributos: Record<string, unknown> }) => Promise<unknown>,
  ) => fn({ atributos: {} }),
  setResultAttributes: (
    span: { atributos: Record<string, unknown> },
    attrs: Record<string, unknown>,
  ) => {
    Object.assign(span.atributos, attrs);
  },
}));

const INV_ID = '7a4e2c1b-3d5f-4a6b-8c9d-0e1f2a3b4c5d';
const USER_ID = '9c8b7a6d-5e4f-4a3b-9c1d-0e9f8a7b6c5d';
const EMAIL = 'gerencia@boosterchile.com';
const RUT = '12345678-5';
const VENCE = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

function makeLogger(): Logger {
  const l = {
    trace: () => undefined,
    debug: () => undefined,
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: () => undefined,
    child: () => l,
  };
  return l as unknown as Logger;
}

const passthrough: never = (async (_c: unknown, next: () => Promise<void>) => {
  await next();
}) as never;

describe('createAuthInvitarCuentaRoutes', () => {
  beforeEach(() => {
    observabilidad.contadores.length = 0;
  });

  it('GET con token inválido → 410 invitacion_invalida', async () => {
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [],
          }),
        }),
      }),
    };
    const app = new Hono();
    app.route(
      '/auth',
      createAuthInvitarCuentaRoutes({
        db: db as never,
        logger: makeLogger(),
        firebaseAuth: {} as never,
        rateLimit: passthrough,
      }),
    );

    const res = await app.request('/auth/invitar-cuenta?token=token-demasiado-corto');
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ error: 'gone', code: 'invitacion_invalida' });
  });

  it('GET con token vigente → 200 email + tipo', async () => {
    const { token, tokenHash } = createInvitacionCorreoToken();
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [
              {
                email: EMAIL,
                tipo: 'personal_booster',
                expiraEn: VENCE,
                consumidoEn: null,
                tokenHash,
              },
            ],
          }),
        }),
      }),
    };
    // consultarInvitacionPorToken filtra por hash; el mock ignora where y
    // siempre devuelve la fila vigente.
    const app = new Hono();
    app.route(
      '/auth',
      createAuthInvitarCuentaRoutes({
        db: db as never,
        logger: makeLogger(),
        firebaseAuth: {} as never,
        rateLimit: passthrough,
      }),
    );

    const res = await app.request(`/auth/invitar-cuenta?token=${encodeURIComponent(token)}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { email: string; tipo: string };
    expect(body.email).toBe(EMAIL);
    expect(body.tipo).toBe('personal_booster');
  });

  it('POST crea cuenta Firebase + usuarios y responde 201 con custom_token', async () => {
    const { token } = createInvitacionCorreoToken();
    const createUser = vi.fn(async () => ({ uid: 'fb-new' }));
    const createCustomToken = vi.fn(async () => 'ct-1');
    const deleteUser = vi.fn();

    let selectPaso = 0;
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => {
              selectPaso += 1;
              // 1) consultarInvitacionPorToken  2) existeCuentaConCorreo  3) porRut
              if (selectPaso === 1) {
                return [
                  {
                    email: EMAIL,
                    tipo: 'personal_booster',
                    expiraEn: VENCE,
                    consumidoEn: null,
                  },
                ];
              }
              return [];
            },
          }),
        }),
      }),
      transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          update: () => ({
            set: () => ({
              where: () => ({
                returning: async () => [{ id: INV_ID, tipo: 'personal_booster', email: EMAIL }],
              }),
            }),
          }),
          insert: () => ({
            values: () => ({
              returning: async () => [{ id: USER_ID }],
            }),
          }),
        };
        return fn(tx);
      },
    };

    const app = new Hono();
    app.route(
      '/auth',
      createAuthInvitarCuentaRoutes({
        db: db as never,
        logger: makeLogger(),
        firebaseAuth: { createUser, createCustomToken, deleteUser } as never,
        rateLimit: passthrough,
      }),
    );

    const res = await app.request('/auth/invitar-cuenta', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        token,
        full_name: 'Gerencia Booster',
        password: 'Secreta99',
        password_confirm: 'Secreta99',
        rut: RUT,
      }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      ok: boolean;
      user_id: string;
      email: string;
      custom_token: string | null;
    };
    expect(body.ok).toBe(true);
    expect(body.user_id).toBe(USER_ID);
    expect(body.email).toBe(EMAIL);
    expect(body.custom_token).toBe('ct-1');
    expect(createUser).toHaveBeenCalledWith(
      expect.objectContaining({
        email: EMAIL,
        password: 'Secreta99',
        emailVerified: true,
      }),
    );
  });
});
