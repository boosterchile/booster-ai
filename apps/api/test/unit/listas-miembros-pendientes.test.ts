import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { createConductoresRoutes } from '../../src/routes/conductores.js';
import { createMeEmpresaMiembrosRoutes } from '../../src/routes/me-empresa-miembros.js';

/** Listas de la empresa: un miembro no activo no muestra sus datos reales. */

const noop = (): void => undefined;
const logger = {
  trace: noop,
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
  fatal: noop,
  child: () => logger,
} as never;

function dbCon(filas: unknown[]) {
  const q: Record<string, unknown> = {};
  for (const m of ['select', 'from', 'innerJoin', 'leftJoin', 'where', 'orderBy']) {
    q[m] = () => q;
  }
  q.limit = () => Promise.resolve(filas);
  q.then = (res: (v: unknown) => unknown) => Promise.resolve(filas).then(res);
  return q as never;
}

function ctx(empresaId: string) {
  return async (c: { set: (k: string, v: unknown) => void }, next: () => Promise<void>) => {
    c.set('userContext', {
      user: { id: 'u1', firebaseUid: 'fb-1', email: 'd@x.invalid' },
      memberships: [],
      activeMembership: {
        membership: { id: 'm1', role: 'dueno', empresaId },
        empresa: { id: empresaId, legal_name: 'E' },
      },
    });
    await next();
  };
}

describe('datos de miembros no activos', () => {
  it('equipo: pendiente sin fechas no muestra nombre, correo ni RUT', async () => {
    const a = new Hono();
    a.use('*', ctx('e1') as never);
    a.route(
      '/m',
      createMeEmpresaMiembrosRoutes({
        db: dbCon([
          {
            membershipId: 'mb',
            userId: 'u2',
            fullName: 'Nombre Real',
            email: 'real@x.invalid',
            rut: '12.345.678-5',
            rol: 'despachador',
            estado: 'pendiente_invitacion',
            invitadoEn: null,
            personaCreadaEn: null,
            membresiaCreadaEn: null,
          },
        ]),
        logger,
      } as never),
    );
    const texto = JSON.stringify(await (await a.request('/m')).json());
    expect(texto).not.toContain('Nombre Real');
    expect(texto).not.toContain('real@x.invalid');
    expect(texto).not.toContain('12.345.678-5');
  });

  it('conductores: pendiente sin fechas no muestra nombre, correo ni RUT', async () => {
    const a = new Hono();
    a.use('*', ctx('e1') as never);
    a.route(
      '/c',
      createConductoresRoutes({
        db: dbCon([
          {
            id: 'c1',
            user_id: 'u2',
            empresa_id: 'e1',
            license_class: 'A5',
            license_number: 'L',
            license_expiry: null,
            is_extranjero: false,
            status: 'activo',
            created_at: null,
            updated_at: null,
            deleted_at: null,
            user_full_name: 'Nombre Real',
            user_rut: '12.345.678-5',
            user_email: 'real@x.invalid',
            user_phone: '+56900000000',
            user_firebase_uid: 'pending-rut:12345678-5',
            user_created_at: null,
          },
        ]),
        logger,
      } as never),
    );
    const res = await a.request('/c');
    expect(res.status).toBe(200);
    const texto = JSON.stringify(await res.json());
    expect(texto).not.toContain('Nombre Real');
    expect(texto).not.toContain('real@x.invalid');
    expect(texto).not.toContain('12.345.678-5');
  });
});
