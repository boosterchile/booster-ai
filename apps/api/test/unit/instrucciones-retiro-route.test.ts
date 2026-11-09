import { getTableName } from 'drizzle-orm';
import { Hono } from 'hono';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

beforeAll(() => {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
  process.env.GOOGLE_CLOUD_PROJECT = 'test';
});

// GCS: se valida el wiring HTTP (auth, multipart, códigos), no la nube real.
const saveMock = vi.fn(async () => undefined);
const getSignedUrlMock = vi.fn(async () => ['https://signed.example/qr?sig=abc']);
const fileMock = vi.fn(() => ({ save: saveMock, getSignedUrl: getSignedUrlMock }));
const bucketMock = vi.fn(() => ({ file: fileMock }));
vi.mock('@google-cloud/storage', () => ({
  Storage: class {
    bucket = bucketMock;
  },
}));

const { createPickupInstructionsRoutes } = await import('../../src/routes/instrucciones-retiro.js');

const noop = (): void => undefined;
const logger = {
  trace: noop,
  debug: noop,
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: noop,
  child: () => logger,
} as never;

const TRIP_ID = 'c3b8c1d2-0000-4000-8000-000000000100';
const SHIPPER_EMP = 'c3b8c1d2-0000-4000-8000-000000000300';
const CARRIER_EMP = 'c3b8c1d2-0000-4000-8000-000000000400';
const OTHER_EMP = 'c3b8c1d2-0000-4000-8000-000000000500';
const USER_ID = 'c3b8c1d2-0000-4000-8000-000000000600';
const OTRO_CONDUCTOR = 'c3b8c1d2-0000-4000-8000-000000000700';

interface Fila {
  filePath: string | null;
  fileMime: string | null;
  place: string | null;
  note: string | null;
  updatedAt: Date;
}

interface Escenario {
  trip?: { generadorCargaEmpresaId: string } | null;
  assignment?: { empresaId: string; driverUserId?: string | null; status?: string } | null;
  fila?: Fila | null;
}

const upsertSpy = vi.fn();

function makeDb(s: Escenario) {
  let fila = s.fila ?? null;
  const select = vi.fn(() => {
    let table: string | undefined;
    const chain: Record<string, unknown> = {};
    chain.from = vi.fn((t: unknown) => {
      table = getTableName(t as never);
      return chain;
    });
    chain.where = vi.fn(() => chain);
    const rows = (): unknown[] => {
      if (table === 'viajes') {
        return s.trip ? [{ id: TRIP_ID, ...s.trip }] : [];
      }
      if (table === 'asignaciones') {
        if (!s.assignment) {
          return [];
        }
        const status = s.assignment.status ?? 'asignado';
        return ['asignado', 'recogido', 'entregado'].includes(status) ? [s.assignment] : [];
      }
      if (table === 'instrucciones_retiro') {
        return fila ? [fila] : [];
      }
      return [];
    };
    chain.limit = vi.fn(async () => rows());
    return chain;
  });
  const insert = vi.fn(() => ({
    values: vi.fn((v: Record<string, unknown>) => ({
      onConflictDoUpdate: vi.fn((cfg: { set: Record<string, unknown> }) => ({
        returning: vi.fn(async () => {
          upsertSpy(v, cfg.set);
          fila = {
            filePath: (v.filePath as string | null) ?? null,
            fileMime: (v.fileMime as string | null) ?? null,
            place: (v.place as string | null) ?? null,
            note: (v.note as string | null) ?? null,
            updatedAt: new Date('2026-11-09T15:00:00Z'),
          };
          return [fila];
        }),
      })),
    })),
  }));
  return { select, insert } as never;
}

function buildApp(
  db: unknown,
  opts: { empresaId: string; role?: string; generador?: boolean; transportista?: boolean },
  conBucket = true,
) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('userContext', {
      user: { id: USER_ID, email: 'u@e.cl' },
      memberships: [],
      activeMembership: {
        membership: { id: 'm1', role: opts.role ?? 'dueno', status: 'activa' },
        empresa: {
          id: opts.empresaId,
          isGeneradorCarga: opts.generador ?? true,
          isTransportista: opts.transportista ?? false,
          status: 'activa',
        },
      },
    } as never);
    await next();
  });
  app.route(
    '/',
    createPickupInstructionsRoutes({
      db: db as never,
      logger,
      ...(conBucket ? { bucket: 'uploads-raw-test' } : {}),
    }),
  );
  return app;
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const ruta = `/viajes/${TRIP_ID}/instrucciones-retiro`;

function form(campos: { file?: File; lugar?: string; nota?: string }): FormData {
  const fd = new FormData();
  if (campos.file) {
    fd.append('file', campos.file);
  }
  if (campos.lugar !== undefined) {
    fd.append('lugar', campos.lugar);
  }
  if (campos.nota !== undefined) {
    fd.append('nota', campos.nota);
  }
  return fd;
}

const png = () => new File([PNG], 'qr.png', { type: 'image/png' });

beforeEach(() => {
  saveMock.mockClear();
  getSignedUrlMock.mockClear();
  upsertSpy.mockClear();
});

describe('PUT /viajes/:id/instrucciones-retiro', () => {
  it('el generador dueño sube un PNG con nota → 200 y archiva en el bucket', async () => {
    const db = makeDb({ trip: { generadorCargaEmpresaId: SHIPPER_EMP } });
    const res = await buildApp(db, { empresaId: SHIPPER_EMP }).request(ruta, {
      method: 'PUT',
      body: form({ file: png(), lugar: 'Bodega Sur, Quilicura', nota: 'Andén 4' }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      instrucciones: { lugar: string; nota: string; archivo: { mime: string; url: string } };
    };
    expect(json.instrucciones.lugar).toBe('Bodega Sur, Quilicura');
    expect(json.instrucciones.nota).toBe('Andén 4');
    expect(json.instrucciones.archivo.mime).toBe('image/png');
    expect(bucketMock).toHaveBeenCalledWith('uploads-raw-test');
    const objeto = fileMock.mock.calls.at(0)?.[0] as unknown as string;
    expect(objeto).toMatch(new RegExp(`^instrucciones-retiro/${TRIP_ID}/[0-9a-f-]+\\.png$`));
    expect(saveMock).toHaveBeenCalledTimes(1);
  });

  it('sin archivo nuevo conserva el anterior y cambia la nota', async () => {
    const db = makeDb({
      trip: { generadorCargaEmpresaId: SHIPPER_EMP },
      fila: {
        filePath: 'instrucciones-retiro/t/viejo.png',
        fileMime: 'image/png',
        place: null,
        note: 'antes',
        updatedAt: new Date(),
      },
    });
    const res = await buildApp(db, { empresaId: SHIPPER_EMP }).request(ruta, {
      method: 'PUT',
      body: form({ nota: 'después' }),
    });
    expect(res.status).toBe(200);
    expect(saveMock).not.toHaveBeenCalled();
    const [valores] = upsertSpy.mock.calls.at(0) as [Record<string, unknown>];
    expect(valores.filePath).toBe('instrucciones-retiro/t/viejo.png');
    expect(valores.note).toBe('después');
  });

  it('sin archivo ni nota → 400 instrucciones_vacias', async () => {
    const db = makeDb({ trip: { generadorCargaEmpresaId: SHIPPER_EMP } });
    const res = await buildApp(db, { empresaId: SHIPPER_EMP }).request(ruta, {
      method: 'PUT',
      body: form({ lugar: 'Bodega Sur', nota: '   ' }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('instrucciones_vacias');
  });

  it('magic bytes que no calzan → 400 mime_mismatch, sin archivar', async () => {
    const db = makeDb({ trip: { generadorCargaEmpresaId: SHIPPER_EMP } });
    const falso = new File([new Uint8Array([0x00, 0x01, 0x02])], 'qr.png', { type: 'image/png' });
    const res = await buildApp(db, { empresaId: SHIPPER_EMP }).request(ruta, {
      method: 'PUT',
      body: form({ file: falso }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('mime_mismatch');
    expect(saveMock).not.toHaveBeenCalled();
  });

  it('visualizador del generador → 403 read_only', async () => {
    const db = makeDb({ trip: { generadorCargaEmpresaId: SHIPPER_EMP } });
    const res = await buildApp(db, { empresaId: SHIPPER_EMP, role: 'visualizador' }).request(ruta, {
      method: 'PUT',
      body: form({ nota: 'x' }),
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('read_only');
  });

  it('la transportista asignada no escribe → 403', async () => {
    const db = makeDb({
      trip: { generadorCargaEmpresaId: SHIPPER_EMP },
      assignment: { empresaId: CARRIER_EMP },
    });
    const res = await buildApp(db, {
      empresaId: CARRIER_EMP,
      generador: false,
      transportista: true,
    }).request(ruta, { method: 'PUT', body: form({ nota: 'x' }) });
    expect(res.status).toBe(403);
    expect(upsertSpy).not.toHaveBeenCalled();
  });

  it('empresa ajena → 403; viaje inexistente → 404', async () => {
    const ajena = makeDb({ trip: { generadorCargaEmpresaId: SHIPPER_EMP } });
    const r1 = await buildApp(ajena, { empresaId: OTHER_EMP }).request(ruta, {
      method: 'PUT',
      body: form({ nota: 'x' }),
    });
    expect(r1.status).toBe(403);
    const inexistente = makeDb({ trip: null });
    const r2 = await buildApp(inexistente, { empresaId: SHIPPER_EMP }).request(ruta, {
      method: 'PUT',
      body: form({ nota: 'x' }),
    });
    expect(r2.status).toBe(404);
  });

  it('sin bucket configurado y con archivo → 503 storage_unavailable', async () => {
    const db = makeDb({ trip: { generadorCargaEmpresaId: SHIPPER_EMP } });
    const res = await buildApp(db, { empresaId: SHIPPER_EMP }, false).request(ruta, {
      method: 'PUT',
      body: form({ file: png() }),
    });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { code: string }).code).toBe('storage_unavailable');
  });
});

describe('GET /viajes/:id/instrucciones-retiro', () => {
  const fila: Fila = {
    filePath: 'instrucciones-retiro/t/qr.png',
    fileMime: 'image/png',
    place: 'Bodega Sur',
    note: 'Andén 4',
    updatedAt: new Date('2026-11-09T15:00:00Z'),
  };

  it('el conductor de la asignación lee con URL firmada', async () => {
    const db = makeDb({
      trip: { generadorCargaEmpresaId: SHIPPER_EMP },
      assignment: { empresaId: CARRIER_EMP, driverUserId: USER_ID },
      fila,
    });
    const res = await buildApp(db, {
      empresaId: CARRIER_EMP,
      role: 'conductor',
      generador: false,
      transportista: true,
    }).request(ruta);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { instrucciones: { archivo: { url: string } } };
    expect(json.instrucciones.archivo.url).toContain('https://signed.example');
    expect(getSignedUrlMock).toHaveBeenCalledWith(
      expect.objectContaining({ version: 'v4', action: 'read' }),
    );
  });

  it('otro conductor de la misma transportista → 403, sin URL', async () => {
    const db = makeDb({
      trip: { generadorCargaEmpresaId: SHIPPER_EMP },
      assignment: { empresaId: CARRIER_EMP, driverUserId: OTRO_CONDUCTOR },
      fila,
    });
    const res = await buildApp(db, {
      empresaId: CARRIER_EMP,
      role: 'conductor',
      generador: false,
      transportista: true,
    }).request(ruta);
    expect(res.status).toBe(403);
    expect(getSignedUrlMock).not.toHaveBeenCalled();
  });

  it('el generador dueño lee; sin instrucciones → 404 sin_instrucciones', async () => {
    const con = makeDb({ trip: { generadorCargaEmpresaId: SHIPPER_EMP }, fila });
    expect((await buildApp(con, { empresaId: SHIPPER_EMP }).request(ruta)).status).toBe(200);
    const sin = makeDb({ trip: { generadorCargaEmpresaId: SHIPPER_EMP } });
    const res = await buildApp(sin, { empresaId: SHIPPER_EMP }).request(ruta);
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe('sin_instrucciones');
  });

  it('solo nota: archivo null y no firma nada', async () => {
    const db = makeDb({
      trip: { generadorCargaEmpresaId: SHIPPER_EMP },
      fila: { ...fila, filePath: null, fileMime: null },
    });
    const res = await buildApp(db, { empresaId: SHIPPER_EMP }).request(ruta);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { instrucciones: { archivo: unknown } };
    expect(json.instrucciones.archivo).toBeNull();
    expect(getSignedUrlMock).not.toHaveBeenCalled();
  });
});
