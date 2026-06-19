import { getTableName } from 'drizzle-orm';
import { Hono } from 'hono';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

beforeAll(() => {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
  process.env.GOOGLE_CLOUD_PROJECT = 'test';
});

// Mock GCS y Pub/Sub: el route los usa para archivar + publicar. Validamos el
// wiring HTTP (auth, multipart, status codes), no la nube real.
const saveMock = vi.fn(async () => undefined);
const getSignedUrlMock = vi.fn(async () => ['https://signed.example/doc?sig=abc']);
const fileMock = vi.fn(() => ({ save: saveMock, getSignedUrl: getSignedUrlMock }));
const bucketMock = vi.fn(() => ({ file: fileMock }));
vi.mock('@google-cloud/storage', () => ({
  // `new Storage()` en el route → necesita un constructor real (no arrow).
  Storage: class {
    bucket = bucketMock;
  },
}));

const publishMessageMock = vi.fn(async () => 'msg-id');
const topicMock = vi.fn(() => ({ publishMessage: publishMessageMock }));
vi.mock('@google-cloud/pubsub', () => ({
  PubSub: class {
    topic = topicMock;
  },
}));

const { createTransportDocumentsRoutes, detectMagicByteMime } = await import(
  '../../src/routes/transport-documents.js'
);

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

const TRIP_ID = 'b3b8c1d2-0000-4000-8000-000000000100';
const DOC_ID = 'b3b8c1d2-0000-4000-8000-000000000200';
const SHIPPER_EMP = 'b3b8c1d2-0000-4000-8000-000000000300';
const CARRIER_EMP = 'b3b8c1d2-0000-4000-8000-000000000400';
const OTHER_EMP = 'b3b8c1d2-0000-4000-8000-000000000500';
const USER_ID = 'b3b8c1d2-0000-4000-8000-000000000600';

const userCtx = (empresaId: string, role = 'dueno') => ({
  user: { id: USER_ID, email: 'u@e.cl' },
  memberships: [],
  activeMembership: { empresa: { id: empresaId }, membership: { role } },
});

interface DbScenario {
  /** trip row (o null si no existe). */
  trip?: { generadorCargaEmpresaId: string } | null;
  /**
   * assignment row del trip (o null). `status` opcional (default 'asignado'):
   * el route filtra por estados vigentes (excluye 'cancelado', finding 2), y el
   * mock replica ese filtro para que el test valide comportamiento, no solo SQL.
   */
  assignment?: { empresaId: string; status?: string } | null;
  /** doc row para manual-entry / GET detail. */
  doc?: {
    id: string;
    viajeId: string;
    createdAt: Date;
    filePath: string;
    docType: string;
    fileMime: string;
    extractionStatus: string;
    source: string;
    folio: string | null;
    rutEmisor: string | null;
    razonSocialEmisor: string | null;
    rutReceptor: string | null;
    razonSocialReceptor: string | null;
    fechaEmision: string | null;
    montoTotal: string | null;
    tedSignatureValid: boolean | null;
    retentionUntil: string | null;
  } | null;
  /** lista de docs para GET listado. */
  list?: unknown[];
  insertedId?: string;
}

const updateSetSpy = vi.fn();
const insertValuesSpy = vi.fn();

function makeDb(s: DbScenario) {
  // El route hace varios .select() en orden distinto según endpoint. Usamos
  // getTableName en runtime para decidir qué devolver, igual que el service test.
  const select = vi.fn(() => {
    let table: string | undefined;
    const chain: Record<string, unknown> = {};
    chain.from = vi.fn((t: unknown) => {
      try {
        table = getTableName(t);
      } catch {
        table = undefined;
      }
      return chain;
    });
    chain.where = vi.fn(() => chain);
    chain.orderBy = vi.fn(() => chain); // GET listado: await sobre el chain
    const rows = (): unknown[] => {
      if (table === 'viajes') {
        return s.trip ? [{ id: TRIP_ID, ...s.trip }] : [];
      }
      if (table === 'asignaciones') {
        // Replica el filtro `inArray(status, ESTADOS_VIGENTES)` del route: un
        // assignment 'cancelado' NO se devuelve (como en SQL real). Default
        // 'asignado' (vigente) para los assignments que no fijan status.
        if (!s.assignment) {
          return [];
        }
        const status = s.assignment.status ?? 'asignado';
        const vigentes = ['asignado', 'recogido', 'entregado'];
        return vigentes.includes(status) ? [s.assignment] : [];
      }
      if (table === 'documentos_transporte') {
        // GET listado no usa .limit; manual-entry/detail sí.
        return s.doc ? [s.doc] : (s.list ?? []);
      }
      return [];
    };
    chain.then = (resolve: (r: unknown[]) => void) => resolve(rows());
    chain.limit = vi.fn(async () => rows());
    return chain;
  });

  const insert = vi.fn(() => ({
    values: vi.fn((v: unknown) => {
      insertValuesSpy(v);
      return { returning: vi.fn(async () => [{ id: s.insertedId ?? DOC_ID }]) };
    }),
  }));

  const update = vi.fn(() => ({
    set: vi.fn((v: unknown) => {
      updateSetSpy(v);
      return { where: vi.fn(async () => undefined) };
    }),
  }));

  return { select, insert, update } as never;
}

function buildApp(db: unknown, empresaId: string, withBucketTopic = true, role = 'dueno') {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('userContext', userCtx(empresaId, role));
    await next();
  });
  app.route(
    '/',
    createTransportDocumentsRoutes({
      db: db as never,
      logger,
      ...(withBucketTopic
        ? { transportDocumentsBucket: 'documents-test', documentUploadedTopic: 'document.uploaded' }
        : {}),
    }),
  );
  return app;
}

// Magic bytes reales (el route valida el CONTENIDO, no solo file.type).
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]; // "%PDF-1.7"
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function pdfForm(): FormData {
  const fd = new FormData();
  fd.append('file', new File([new Uint8Array(PDF_MAGIC)], 'g.pdf', { type: 'application/pdf' }));
  return fd;
}

beforeEach(() => {
  saveMock.mockClear();
  publishMessageMock.mockClear();
  insertValuesSpy.mockClear();
  updateSetSpy.mockClear();
  getSignedUrlMock.mockClear();
});

describe('POST /transport-orders/:id/documents', () => {
  it('PDF válido del shipper dueño → 202, GCS save, fila pendiente, publish', async () => {
    const db = makeDb({ trip: { generadorCargaEmpresaId: SHIPPER_EMP } });
    const app = buildApp(db, SHIPPER_EMP);
    const res = await app.request(`/transport-orders/${TRIP_ID}/documents`, {
      method: 'POST',
      body: pdfForm(),
    });
    expect(res.status).toBe(202);
    const json = (await res.json()) as { document_id: string; extraction_status: string };
    expect(json.extraction_status).toBe('pendiente');
    expect(saveMock).toHaveBeenCalledTimes(1);
    expect(publishMessageMock).toHaveBeenCalledTimes(1);
    expect(insertValuesSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        viajeId: TRIP_ID,
        extractionStatus: 'pendiente',
        source: 'pdf_upload',
        docType: 'other',
      }),
    );
  });

  it('carrier asignado puede subir (autorizado vía assignment)', async () => {
    const db = makeDb({
      trip: { generadorCargaEmpresaId: SHIPPER_EMP },
      assignment: { empresaId: CARRIER_EMP },
    });
    const app = buildApp(db, CARRIER_EMP);
    const res = await app.request(`/transport-orders/${TRIP_ID}/documents`, {
      method: 'POST',
      body: pdfForm(),
    });
    expect(res.status).toBe(202);
  });

  it('IDOR: empresa ajena → 403', async () => {
    const db = makeDb({
      trip: { generadorCargaEmpresaId: SHIPPER_EMP },
      assignment: { empresaId: CARRIER_EMP },
    });
    const app = buildApp(db, OTHER_EMP);
    const res = await app.request(`/transport-orders/${TRIP_ID}/documents`, {
      method: 'POST',
      body: pdfForm(),
    });
    expect(res.status).toBe(403);
    expect(saveMock).not.toHaveBeenCalled();
  });

  it('trip inexistente → 404', async () => {
    const db = makeDb({ trip: null });
    const app = buildApp(db, SHIPPER_EMP);
    const res = await app.request(`/transport-orders/${TRIP_ID}/documents`, {
      method: 'POST',
      body: pdfForm(),
    });
    expect(res.status).toBe(404);
  });

  it('MIME no permitido → 400', async () => {
    const db = makeDb({ trip: { generadorCargaEmpresaId: SHIPPER_EMP } });
    const app = buildApp(db, SHIPPER_EMP);
    const fd = new FormData();
    fd.append('file', new File([new Uint8Array([1])], 'x.txt', { type: 'text/plain' }));
    const res = await app.request(`/transport-orders/${TRIP_ID}/documents`, {
      method: 'POST',
      body: fd,
    });
    expect(res.status).toBe(400);
  });

  it('sin file → 400', async () => {
    const db = makeDb({ trip: { generadorCargaEmpresaId: SHIPPER_EMP } });
    const app = buildApp(db, SHIPPER_EMP);
    const res = await app.request(`/transport-orders/${TRIP_ID}/documents`, {
      method: 'POST',
      body: new FormData(),
    });
    expect(res.status).toBe(400);
  });

  it('sin bucket configurado → 503', async () => {
    const db = makeDb({ trip: { generadorCargaEmpresaId: SHIPPER_EMP } });
    const app = buildApp(db, SHIPPER_EMP, false);
    const res = await app.request(`/transport-orders/${TRIP_ID}/documents`, {
      method: 'POST',
      body: pdfForm(),
    });
    expect(res.status).toBe(503);
  });

  // Finding 4 (role gate): solo dueño/admin/despachador pueden escribir.
  it('rol visualizador → 403 write_role_required (sin tocar GCS)', async () => {
    const db = makeDb({ trip: { generadorCargaEmpresaId: SHIPPER_EMP } });
    const app = buildApp(db, SHIPPER_EMP, true, 'visualizador');
    const res = await app.request(`/transport-orders/${TRIP_ID}/documents`, {
      method: 'POST',
      body: pdfForm(),
    });
    expect(res.status).toBe(403);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe('write_role_required');
    expect(saveMock).not.toHaveBeenCalled();
  });

  it('rol conductor → 403 write_role_required', async () => {
    const db = makeDb({ trip: { generadorCargaEmpresaId: SHIPPER_EMP } });
    const app = buildApp(db, SHIPPER_EMP, true, 'conductor');
    const res = await app.request(`/transport-orders/${TRIP_ID}/documents`, {
      method: 'POST',
      body: pdfForm(),
    });
    expect(res.status).toBe(403);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe('write_role_required');
  });

  it('rol despachador SÍ puede subir → 202', async () => {
    const db = makeDb({ trip: { generadorCargaEmpresaId: SHIPPER_EMP } });
    const app = buildApp(db, SHIPPER_EMP, true, 'despachador');
    const res = await app.request(`/transport-orders/${TRIP_ID}/documents`, {
      method: 'POST',
      body: pdfForm(),
    });
    expect(res.status).toBe(202);
  });

  // Finding 3 (magic bytes): contenido que no coincide con el MIME declarado.
  it('PDF declarado pero contenido no-PDF → 400 mime_mismatch (sin subir a GCS)', async () => {
    const db = makeDb({ trip: { generadorCargaEmpresaId: SHIPPER_EMP } });
    const app = buildApp(db, SHIPPER_EMP);
    const fd = new FormData();
    // file.type miente: dice PDF pero el contenido son bytes basura.
    fd.append(
      'file',
      new File([new Uint8Array([0x00, 0x01, 0x02, 0x03])], 'fake.pdf', {
        type: 'application/pdf',
      }),
    );
    const res = await app.request(`/transport-orders/${TRIP_ID}/documents`, {
      method: 'POST',
      body: fd,
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe('mime_mismatch');
    expect(saveMock).not.toHaveBeenCalled();
  });

  it('contenido PNG declarado como JPEG → 400 mime_mismatch', async () => {
    const db = makeDb({ trip: { generadorCargaEmpresaId: SHIPPER_EMP } });
    const app = buildApp(db, SHIPPER_EMP);
    const fd = new FormData();
    fd.append(
      'file',
      new File([new Uint8Array(PNG_MAGIC)], 'mislabeled.jpg', { type: 'image/jpeg' }),
    );
    const res = await app.request(`/transport-orders/${TRIP_ID}/documents`, {
      method: 'POST',
      body: fd,
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe('mime_mismatch');
  });

  it('PNG válido (magic bytes correctos) → 202', async () => {
    const db = makeDb({ trip: { generadorCargaEmpresaId: SHIPPER_EMP } });
    const app = buildApp(db, SHIPPER_EMP);
    const fd = new FormData();
    fd.append('file', new File([new Uint8Array(PNG_MAGIC)], 'g.png', { type: 'image/png' }));
    const res = await app.request(`/transport-orders/${TRIP_ID}/documents`, {
      method: 'POST',
      body: fd,
    });
    expect(res.status).toBe(202);
    expect(saveMock).toHaveBeenCalledTimes(1);
  });

  // Finding 2: assignment CANCELADO no autoriza al carrier.
  it('carrier con assignment cancelado → 403 (assignment cancelado no autoriza)', async () => {
    const db = makeDb({
      trip: { generadorCargaEmpresaId: SHIPPER_EMP },
      assignment: { empresaId: CARRIER_EMP, status: 'cancelado' },
    });
    const app = buildApp(db, CARRIER_EMP);
    const res = await app.request(`/transport-orders/${TRIP_ID}/documents`, {
      method: 'POST',
      body: pdfForm(),
    });
    expect(res.status).toBe(403);
    expect(saveMock).not.toHaveBeenCalled();
  });

  it('carrier con assignment recogido (vigente) SÍ autoriza → 202', async () => {
    const db = makeDb({
      trip: { generadorCargaEmpresaId: SHIPPER_EMP },
      assignment: { empresaId: CARRIER_EMP, status: 'recogido' },
    });
    const app = buildApp(db, CARRIER_EMP);
    const res = await app.request(`/transport-orders/${TRIP_ID}/documents`, {
      method: 'POST',
      body: pdfForm(),
    });
    expect(res.status).toBe(202);
  });
});

const docRow = (overrides: Record<string, unknown> = {}) => ({
  id: DOC_ID,
  viajeId: TRIP_ID,
  createdAt: new Date('2026-06-18T10:00:00.000Z'),
  filePath: `transport-documents/${TRIP_ID}/x.pdf`,
  docType: 'other',
  fileMime: 'application/pdf',
  extractionStatus: 'fallido',
  source: 'pdf_upload',
  folio: null,
  rutEmisor: null,
  razonSocialEmisor: null,
  rutReceptor: null,
  razonSocialReceptor: null,
  fechaEmision: null,
  montoTotal: null,
  tedSignatureValid: null,
  retentionUntil: null,
  ...overrides,
});

describe('POST /documents/:id/manual-entry', () => {
  it('corrige campos del shipper dueño → 200, ingreso_manual, retention recalculada', async () => {
    const db = makeDb({ trip: { generadorCargaEmpresaId: SHIPPER_EMP }, doc: docRow() });
    const app = buildApp(db, SHIPPER_EMP);
    const res = await app.request(`/documents/${DOC_ID}/manual-entry`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ doc_type: '52', folio: '999', fecha_emision: '2026-06-15' }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { extraction_status: string; retention_until: string };
    expect(json.extraction_status).toBe('ingreso_manual');
    expect(json.retention_until).toBe('2032-06-15');
    expect(updateSetSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        docType: '52',
        folio: '999',
        fechaEmision: '2026-06-15',
        extractionStatus: 'ingreso_manual',
        retentionUntil: '2032-06-15',
      }),
    );
  });

  it('sin fecha_emision → retention fallback created_at + 6a', async () => {
    const db = makeDb({ trip: { generadorCargaEmpresaId: SHIPPER_EMP }, doc: docRow() });
    const app = buildApp(db, SHIPPER_EMP);
    const res = await app.request(`/documents/${DOC_ID}/manual-entry`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ folio: '123' }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { retention_until: string };
    expect(json.retention_until).toBe('2032-06-18');
  });

  it('body vacío → 400 (Zod refine)', async () => {
    const db = makeDb({ trip: { generadorCargaEmpresaId: SHIPPER_EMP }, doc: docRow() });
    const app = buildApp(db, SHIPPER_EMP);
    const res = await app.request(`/documents/${DOC_ID}/manual-entry`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('IDOR empresa ajena → 403', async () => {
    const db = makeDb({
      trip: { generadorCargaEmpresaId: SHIPPER_EMP },
      assignment: { empresaId: CARRIER_EMP },
      doc: docRow(),
    });
    const app = buildApp(db, OTHER_EMP);
    const res = await app.request(`/documents/${DOC_ID}/manual-entry`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ folio: '1' }),
    });
    expect(res.status).toBe(403);
    expect(updateSetSpy).not.toHaveBeenCalled();
  });

  it('documento inexistente → 404', async () => {
    const db = makeDb({ doc: null });
    const app = buildApp(db, SHIPPER_EMP);
    const res = await app.request(`/documents/${DOC_ID}/manual-entry`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ folio: '1' }),
    });
    expect(res.status).toBe(404);
  });

  // Finding 4 (role gate) también aplica a manual-entry.
  it('rol visualizador → 403 write_role_required (sin UPDATE)', async () => {
    const db = makeDb({ trip: { generadorCargaEmpresaId: SHIPPER_EMP }, doc: docRow() });
    const app = buildApp(db, SHIPPER_EMP, true, 'visualizador');
    const res = await app.request(`/documents/${DOC_ID}/manual-entry`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ folio: '1' }),
    });
    expect(res.status).toBe(403);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe('write_role_required');
    expect(updateSetSpy).not.toHaveBeenCalled();
  });
});

describe('GET /transport-orders/:id/documents', () => {
  it('lista los documentos de la orden (shipper dueño)', async () => {
    const db = makeDb({
      trip: { generadorCargaEmpresaId: SHIPPER_EMP },
      list: [{ id: DOC_ID, extractionStatus: 'pendiente' }],
    });
    const app = buildApp(db, SHIPPER_EMP);
    const res = await app.request(`/transport-orders/${TRIP_ID}/documents`);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { documents: unknown[] };
    expect(json.documents).toHaveLength(1);
  });

  it('IDOR empresa ajena → 403', async () => {
    const db = makeDb({
      trip: { generadorCargaEmpresaId: SHIPPER_EMP },
      assignment: { empresaId: CARRIER_EMP },
      list: [],
    });
    const app = buildApp(db, OTHER_EMP);
    const res = await app.request(`/transport-orders/${TRIP_ID}/documents`);
    expect(res.status).toBe(403);
  });
});

describe('GET /documents/:id', () => {
  it('detalle + signed URL v4 (shipper dueño)', async () => {
    const db = makeDb({ trip: { generadorCargaEmpresaId: SHIPPER_EMP }, doc: docRow() });
    const app = buildApp(db, SHIPPER_EMP);
    const res = await app.request(`/documents/${DOC_ID}`);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { document: { id: string }; download_url: string };
    expect(json.document.id).toBe(DOC_ID);
    expect(json.download_url).toContain('https://signed.example');
    expect(getSignedUrlMock).toHaveBeenCalledWith(
      expect.objectContaining({ version: 'v4', action: 'read' }),
    );
  });

  it('IDOR empresa ajena → 403', async () => {
    const db = makeDb({
      trip: { generadorCargaEmpresaId: SHIPPER_EMP },
      assignment: { empresaId: CARRIER_EMP },
      doc: docRow(),
    });
    const app = buildApp(db, OTHER_EMP);
    const res = await app.request(`/documents/${DOC_ID}`);
    expect(res.status).toBe(403);
  });

  // Finding 4: los GET NO tienen role gate — visualizador puede leer.
  it('rol visualizador SÍ puede leer detalle (GET sin role gate) → 200', async () => {
    const db = makeDb({ trip: { generadorCargaEmpresaId: SHIPPER_EMP }, doc: docRow() });
    const app = buildApp(db, SHIPPER_EMP, true, 'visualizador');
    const res = await app.request(`/documents/${DOC_ID}`);
    expect(res.status).toBe(200);
  });
});

// Finding 3: validación de magic bytes (función pura).
describe('detectMagicByteMime', () => {
  it('detecta PDF por "%PDF"', () => {
    expect(detectMagicByteMime(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]))).toBe(
      'application/pdf',
    );
  });

  it('detecta JPEG por FF D8 FF', () => {
    expect(detectMagicByteMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
  });

  it('detecta PNG por su firma de 8 bytes', () => {
    expect(
      detectMagicByteMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    ).toBe('image/png');
  });

  it('null para contenido que no coincide con ningún tipo permitido', () => {
    expect(detectMagicByteMime(new Uint8Array([0x00, 0x01, 0x02, 0x03]))).toBeNull();
  });

  it('null para buffer más corto que la firma (no out-of-bounds match)', () => {
    // 0x89 0x50 son el prefijo de PNG pero el buffer es demasiado corto.
    expect(detectMagicByteMime(new Uint8Array([0x89, 0x50]))).toBeNull();
  });

  it('null para buffer vacío', () => {
    expect(detectMagicByteMime(new Uint8Array([]))).toBeNull();
  });

  it('no confunde JPEG-prefijo con PDF (FF D8 no es %PDF)', () => {
    // Defensa: un PNG que NO termina su firma completa no debe matchear PNG.
    expect(detectMagicByteMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00]))).toBeNull();
  });
});
