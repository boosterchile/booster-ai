import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

const noop = (): void => undefined;
const noopLogger = {
  trace: noop,
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
  fatal: noop,
  child: () => noopLogger,
} as unknown as Parameters<
  typeof import('../../src/routes/documentos.js').createDocumentosRoutes
>[0]['logger'];

const EMPRESA_ID = '11111111-1111-1111-1111-111111111111';
const VEHICLE_ID = '22222222-2222-2222-2222-222222222222';
const DOC_ID = '33333333-3333-3333-3333-333333333333';
const CONDUCTOR_ID = '44444444-4444-4444-4444-444444444444';

function buildVehicleDocRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: DOC_ID,
    vehicleId: VEHICLE_ID,
    tipo: 'revision_tecnica',
    archivoUrl: null,
    fechaEmision: new Date('2026-01-01T00:00:00Z'),
    fechaVencimiento: new Date('2027-01-01T00:00:00Z'),
    estado: 'vigente',
    notas: null,
    createdAt: new Date('2026-05-10T00:00:00Z'),
    updatedAt: new Date('2026-05-10T00:00:00Z'),
    ...overrides,
  };
}

function buildDriverDocRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: DOC_ID,
    conductorId: CONDUCTOR_ID,
    tipo: 'licencia_conducir',
    archivoUrl: null,
    fechaEmision: new Date('2026-01-01T00:00:00Z'),
    fechaVencimiento: new Date('2027-01-01T00:00:00Z'),
    estado: 'vigente',
    notas: null,
    createdAt: new Date('2026-05-10T00:00:00Z'),
    updatedAt: new Date('2026-05-10T00:00:00Z'),
    ...overrides,
  };
}

function makeDbStub(opts: {
  selectQueue?: unknown[][];
  insertRows?: unknown[];
  updateRows?: unknown[];
  deleteRows?: unknown[];
}) {
  const queue = [...(opts.selectQueue ?? [])];

  const limit = vi.fn(() => Promise.resolve(queue.shift() ?? []));
  const orderBy = vi.fn(() => Promise.resolve(queue.shift() ?? []));

  // where → tiene .limit, .orderBy, y también es awaitable (para subqueries).
  // Tip: drizzle subquery se pasa como valor a inArray sin awaitear; con eso
  // basta que sea un objeto plano.
  const where = vi.fn(() => {
    const next = {
      limit,
      orderBy,
      then: (resolve: (v: unknown[]) => void) => resolve(queue.shift() ?? []),
    };
    return next;
  });

  const innerJoin = vi.fn(() => ({ innerJoin, where }));
  const from = vi.fn(() => ({ where, innerJoin }));
  const select = vi.fn(() => ({ from }));

  const insertReturning = vi.fn(() => Promise.resolve(opts.insertRows ?? []));
  const values = vi.fn(() => ({ returning: insertReturning }));
  const insert = vi.fn(() => ({ values }));

  const updateReturning = vi.fn(() => Promise.resolve(opts.updateRows ?? []));
  const updateWhere = vi.fn(() => ({ returning: updateReturning }));
  const set = vi.fn(() => ({ where: updateWhere }));
  const update = vi.fn(() => ({ set }));

  const deleteReturning = vi.fn(() => Promise.resolve(opts.deleteRows ?? []));
  const deleteWhere = vi.fn(() => ({ returning: deleteReturning }));
  const del = vi.fn(() => ({ where: deleteWhere }));

  return {
    db: { select, insert, update, delete: del } as unknown as Parameters<
      typeof import('../../src/routes/documentos.js').createDocumentosRoutes
    >[0]['db'],
  };
}

async function buildDocumentosApp(
  db: Parameters<typeof import('../../src/routes/documentos.js').createDocumentosRoutes>[0]['db'],
  opts: {
    role?: 'dueno' | 'admin' | 'despachador' | 'conductor' | null;
    noEmpresa?: boolean;
  } = { role: 'dueno' },
) {
  const { createDocumentosRoutes } = await import('../../src/routes/documentos.js');
  const app = new Hono();
  app.use('*', async (c, next) => {
    if (opts.role === null) {
      await next();
      return;
    }
    c.set('userContext', {
      user: { id: 'u-1', firebaseUid: 'fb-1', email: 'test@x.com' },
      memberships: [],
      activeMembership: opts.noEmpresa
        ? null
        : {
            membership: { id: 'm-1', role: opts.role },
            empresa: { id: EMPRESA_ID, legal_name: 'Test SA' },
          },
    });
    await next();
  });
  app.route('/documentos', createDocumentosRoutes({ db, logger: noopLogger }));
  return app;
}

async function buildCumplimientoApp(
  db: Parameters<typeof import('../../src/routes/documentos.js').createCumplimientoRoutes>[0]['db'],
  opts: {
    role?: 'dueno' | 'admin' | 'despachador' | 'conductor' | null;
    noEmpresa?: boolean;
  } = { role: 'dueno' },
) {
  const { createCumplimientoRoutes } = await import('../../src/routes/documentos.js');
  const app = new Hono();
  app.use('*', async (c, next) => {
    if (opts.role === null) {
      await next();
      return;
    }
    c.set('userContext', {
      user: { id: 'u-1', firebaseUid: 'fb-1', email: 'test@x.com' },
      memberships: [],
      activeMembership: opts.noEmpresa
        ? null
        : {
            membership: { id: 'm-1', role: opts.role },
            empresa: { id: EMPRESA_ID, legal_name: 'Test SA' },
          },
    });
    await next();
  });
  app.route('/cumplimiento', createCumplimientoRoutes({ db, logger: noopLogger }));
  return app;
}

describe('documentos vehiculo routes', () => {
  it('GET /vehiculo/:id sin auth → 401', async () => {
    const stub = makeDbStub({});
    const app = await buildDocumentosApp(stub.db, { role: null });
    const res = await app.request(`/documentos/vehiculo/${VEHICLE_ID}`);
    expect(res.status).toBe(401);
  });

  it('GET /vehiculo/:id sin empresa activa → 403', async () => {
    const stub = makeDbStub({});
    const app = await buildDocumentosApp(stub.db, { noEmpresa: true });
    const res = await app.request(`/documentos/vehiculo/${VEHICLE_ID}`);
    expect(res.status).toBe(403);
  });

  it('GET /vehiculo/:id vehículo no existe → 404', async () => {
    const stub = makeDbStub({ selectQueue: [[]] });
    const app = await buildDocumentosApp(stub.db);
    const res = await app.request(`/documentos/vehiculo/${VEHICLE_ID}`);
    expect(res.status).toBe(404);
  });

  it('GET /vehiculo/:id lista docs', async () => {
    const stub = makeDbStub({
      selectQueue: [
        [{ id: VEHICLE_ID }],
        [
          buildVehicleDocRow({ tipo: 'revision_tecnica' }),
          buildVehicleDocRow({
            id: 'd2',
            tipo: 'soap',
            fechaEmision: '2026-01-01',
            fechaVencimiento: '2027-01-01',
          }),
        ],
      ],
    });
    const app = await buildDocumentosApp(stub.db);
    const res = await app.request(`/documentos/vehiculo/${VEHICLE_ID}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      documentos: Array<{ tipo: string; fecha_vencimiento: string }>;
    };
    expect(body.documentos).toHaveLength(2);
    expect(body.documentos[0]?.tipo).toBe('revision_tecnica');
    expect(body.documentos[0]?.fecha_vencimiento).toBe('2027-01-01');
    expect(body.documentos[1]?.fecha_vencimiento).toBe('2027-01-01');
  });

  it('POST /vehiculo/:id rol conductor → 403', async () => {
    const stub = makeDbStub({});
    const app = await buildDocumentosApp(stub.db, { role: 'conductor' });
    const res = await app.request(`/documentos/vehiculo/${VEHICLE_ID}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tipo: 'revision_tecnica' }),
    });
    expect(res.status).toBe(403);
  });

  it('POST /vehiculo/:id body inválido (tipo desconocido) → 400', async () => {
    const stub = makeDbStub({});
    const app = await buildDocumentosApp(stub.db);
    const res = await app.request(`/documentos/vehiculo/${VEHICLE_ID}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tipo: 'inexistente' }),
    });
    expect(res.status).toBe(400);
  });

  it('POST /vehiculo/:id vehículo ajeno → 404', async () => {
    const stub = makeDbStub({ selectQueue: [[]] });
    const app = await buildDocumentosApp(stub.db);
    const res = await app.request(`/documentos/vehiculo/${VEHICLE_ID}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tipo: 'revision_tecnica' }),
    });
    expect(res.status).toBe(404);
  });

  it('POST /vehiculo/:id crea doc con fechas → 201', async () => {
    const stub = makeDbStub({
      selectQueue: [[{ id: VEHICLE_ID }]],
      insertRows: [
        buildVehicleDocRow({
          tipo: 'soap',
          fechaEmision: new Date('2026-01-15T00:00:00Z'),
          fechaVencimiento: new Date('2027-01-15T00:00:00Z'),
        }),
      ],
    });
    const app = await buildDocumentosApp(stub.db, { role: 'despachador' });
    const res = await app.request(`/documentos/vehiculo/${VEHICLE_ID}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tipo: 'soap',
        fecha_emision: '2026-01-15',
        fecha_vencimiento: '2027-01-15',
        notas: 'Renovado',
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { documento: { tipo: string; fecha_vencimiento: string } };
    expect(body.documento.tipo).toBe('soap');
    expect(body.documento.fecha_vencimiento).toBe('2027-01-15');
  });

  it('PATCH /vehiculo-doc/:id doc ajeno → 404', async () => {
    const stub = makeDbStub({ selectQueue: [[]] });
    const app = await buildDocumentosApp(stub.db);
    const res = await app.request(`/documentos/vehiculo-doc/${DOC_ID}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ notas: 'X' }),
    });
    expect(res.status).toBe(404);
  });

  it('PATCH /vehiculo-doc/:id actualiza fecha_vencimiento → recalcula estado', async () => {
    const stub = makeDbStub({
      selectQueue: [[{ id: DOC_ID, fechaVencimiento: new Date('2027-01-01T00:00:00Z') }]],
      updateRows: [
        buildVehicleDocRow({
          fechaVencimiento: new Date('2026-06-01T00:00:00Z'),
          estado: 'por_vencer',
        }),
      ],
    });
    const app = await buildDocumentosApp(stub.db);
    const res = await app.request(`/documentos/vehiculo-doc/${DOC_ID}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fecha_vencimiento: '2026-06-01' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { documento: { fecha_vencimiento: string } };
    expect(body.documento.fecha_vencimiento).toBe('2026-06-01');
  });

  it('PATCH /vehiculo-doc/:id update sin retorno (race) → 404', async () => {
    const stub = makeDbStub({
      selectQueue: [[{ id: DOC_ID, fechaVencimiento: null }]],
      updateRows: [],
    });
    const app = await buildDocumentosApp(stub.db);
    const res = await app.request(`/documentos/vehiculo-doc/${DOC_ID}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tipo: 'padron', notas: 'x', archivo_url: null, fecha_emision: null }),
    });
    expect(res.status).toBe(404);
  });

  it('DELETE /vehiculo-doc/:id como despachador → 200', async () => {
    const stub = makeDbStub({ deleteRows: [{ id: DOC_ID }] });
    const app = await buildDocumentosApp(stub.db, { role: 'despachador' });
    const res = await app.request(`/documentos/vehiculo-doc/${DOC_ID}`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it('DELETE /vehiculo-doc/:id no encontrado → 404', async () => {
    const stub = makeDbStub({ deleteRows: [] });
    const app = await buildDocumentosApp(stub.db);
    const res = await app.request(`/documentos/vehiculo-doc/${DOC_ID}`, { method: 'DELETE' });
    expect(res.status).toBe(404);
  });
});

describe('documentos conductor routes', () => {
  it('GET /conductor/:id no existe → 404', async () => {
    const stub = makeDbStub({ selectQueue: [[]] });
    const app = await buildDocumentosApp(stub.db);
    const res = await app.request(`/documentos/conductor/${CONDUCTOR_ID}`);
    expect(res.status).toBe(404);
  });

  it('GET /conductor/:id lista docs', async () => {
    const stub = makeDbStub({
      selectQueue: [[{ id: CONDUCTOR_ID }], [buildDriverDocRow()]],
    });
    const app = await buildDocumentosApp(stub.db);
    const res = await app.request(`/documentos/conductor/${CONDUCTOR_ID}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { documentos: Array<{ tipo: string }> };
    expect(body.documentos[0]?.tipo).toBe('licencia_conducir');
  });

  it('POST /conductor/:id rol conductor → 403', async () => {
    const stub = makeDbStub({});
    const app = await buildDocumentosApp(stub.db, { role: 'conductor' });
    const res = await app.request(`/documentos/conductor/${CONDUCTOR_ID}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tipo: 'licencia_conducir' }),
    });
    expect(res.status).toBe(403);
  });

  it('POST /conductor/:id crea doc → 201', async () => {
    const stub = makeDbStub({
      selectQueue: [[{ id: CONDUCTOR_ID }]],
      insertRows: [buildDriverDocRow({ tipo: 'curso_b6' })],
    });
    const app = await buildDocumentosApp(stub.db, { role: 'admin' });
    const res = await app.request(`/documentos/conductor/${CONDUCTOR_ID}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tipo: 'curso_b6', fecha_vencimiento: '2027-01-01' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { documento: { tipo: string } };
    expect(body.documento.tipo).toBe('curso_b6');
  });

  it('POST /conductor/:id conductor ajeno → 404', async () => {
    const stub = makeDbStub({ selectQueue: [[]] });
    const app = await buildDocumentosApp(stub.db);
    const res = await app.request(`/documentos/conductor/${CONDUCTOR_ID}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tipo: 'licencia_conducir' }),
    });
    expect(res.status).toBe(404);
  });

  it('PATCH /conductor-doc/:id doc ajeno → 404', async () => {
    const stub = makeDbStub({ selectQueue: [[]] });
    const app = await buildDocumentosApp(stub.db);
    const res = await app.request(`/documentos/conductor-doc/${DOC_ID}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ notas: 'X' }),
    });
    expect(res.status).toBe(404);
  });

  it('PATCH /conductor-doc/:id actualiza con todos los campos', async () => {
    const stub = makeDbStub({
      selectQueue: [[{ id: DOC_ID }]],
      updateRows: [
        buildDriverDocRow({
          archivoUrl: 'https://x.com/doc.pdf',
          fechaEmision: new Date('2026-02-01T00:00:00Z'),
          fechaVencimiento: new Date('2027-02-01T00:00:00Z'),
          notas: 'Renovado',
        }),
      ],
    });
    const app = await buildDocumentosApp(stub.db);
    const res = await app.request(`/documentos/conductor-doc/${DOC_ID}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tipo: 'licencia_conducir',
        archivo_url: 'https://x.com/doc.pdf',
        fecha_emision: '2026-02-01',
        fecha_vencimiento: '2027-02-01',
        notas: 'Renovado',
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { documento: { archivo_url: string | null } };
    expect(body.documento.archivo_url).toBe('https://x.com/doc.pdf');
  });

  it('PATCH /conductor-doc/:id update vacío race → 404', async () => {
    const stub = makeDbStub({
      selectQueue: [[{ id: DOC_ID }]],
      updateRows: [],
    });
    const app = await buildDocumentosApp(stub.db);
    const res = await app.request(`/documentos/conductor-doc/${DOC_ID}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ notas: null }),
    });
    expect(res.status).toBe(404);
  });

  it('DELETE /conductor-doc/:id como dueno → 200', async () => {
    const stub = makeDbStub({ deleteRows: [{ id: DOC_ID }] });
    const app = await buildDocumentosApp(stub.db);
    const res = await app.request(`/documentos/conductor-doc/${DOC_ID}`, { method: 'DELETE' });
    expect(res.status).toBe(200);
  });

  it('DELETE /conductor-doc/:id no encontrado → 404', async () => {
    const stub = makeDbStub({ deleteRows: [] });
    const app = await buildDocumentosApp(stub.db);
    const res = await app.request(`/documentos/conductor-doc/${DOC_ID}`, { method: 'DELETE' });
    expect(res.status).toBe(404);
  });
});

describe('cumplimiento dashboard', () => {
  it('GET / sin auth → 401', async () => {
    const stub = makeDbStub({});
    const app = await buildCumplimientoApp(stub.db, { role: null });
    const res = await app.request('/cumplimiento');
    expect(res.status).toBe(401);
  });

  it('GET / sin empresa activa → 403', async () => {
    const stub = makeDbStub({});
    const app = await buildCumplimientoApp(stub.db, { noEmpresa: true });
    const res = await app.request('/cumplimiento');
    expect(res.status).toBe(403);
  });

  it('GET / agrega counts y devuelve listas', async () => {
    const stub = makeDbStub({
      selectQueue: [
        [
          {
            id: 'd1',
            vehicleId: VEHICLE_ID,
            plate: 'AB1234',
            tipo: 'soap',
            estado: 'vencido',
            fechaVencimiento: new Date('2026-04-01T00:00:00Z'),
          },
          {
            id: 'd2',
            vehicleId: VEHICLE_ID,
            plate: 'AB1234',
            tipo: 'revision_tecnica',
            estado: 'por_vencer',
            fechaVencimiento: '2026-06-01',
          },
        ],
        [
          {
            id: 'dc1',
            conductorId: CONDUCTOR_ID,
            fullName: 'Juan Pérez',
            rut: '12345678-5',
            tipo: 'licencia_conducir',
            estado: 'vencido',
            fechaVencimiento: new Date('2026-03-01T00:00:00Z'),
          },
        ],
      ],
    });
    const app = await buildCumplimientoApp(stub.db);
    const res = await app.request('/cumplimiento');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      resumen: { vencidos: number; por_vencer_30d: number; total_pendientes: number };
      vehiculos: Array<{ plate: string; fecha_vencimiento: string }>;
      conductores: Array<{ full_name: string; rut: string; fecha_vencimiento: string }>;
    };
    expect(body.resumen.vencidos).toBe(2);
    expect(body.resumen.por_vencer_30d).toBe(1);
    expect(body.resumen.total_pendientes).toBe(3);
    expect(body.vehiculos[0]?.fecha_vencimiento).toBe('2026-04-01');
    expect(body.vehiculos[1]?.fecha_vencimiento).toBe('2026-06-01');
    expect(body.conductores[0]?.full_name).toBe('Juan Pérez');
    expect(body.conductores[0]?.rut).toBe('12345678-5');
  });

  it('GET / sin docs pendientes → totales en 0', async () => {
    const stub = makeDbStub({ selectQueue: [[], []] });
    const app = await buildCumplimientoApp(stub.db);
    const res = await app.request('/cumplimiento');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      resumen: { vencidos: number; por_vencer_30d: number; total_pendientes: number };
    };
    expect(body.resumen.total_pendientes).toBe(0);
  });
});
