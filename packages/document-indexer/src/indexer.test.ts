import type { Bucket, File, Storage } from '@google-cloud/storage';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentIndexer, DocumentRetentionError } from './indexer.js';
import { setStorageForTesting } from './storage.js';
import type { Document, DocumentQuery, DocumentStore, PersistedDocumentRow } from './tipos.js';

/**
 * In-memory store que captura el row insertado para que los tests del
 * indexer verifiquen comportamiento end-to-end (compute retention,
 * compute path, validate sha256, etc.).
 */
class InMemoryStore implements DocumentStore {
  public lastInsert: PersistedDocumentRow | null = null;
  public docs: Document[] = [];

  async insert(row: PersistedDocumentRow): Promise<Document> {
    this.lastInsert = row;
    const doc: Document = {
      id: '00000000-0000-0000-0000-000000000001' as Document['id'],
      empresaId: row.empresaId as Document['empresaId'],
      tripId: row.tripId as Document['tripId'],
      type: row.type,
      gcsPath: row.gcsPath,
      sha256: row.sha256,
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes,
      folioSii: row.folioSii,
      rutEmisor: row.rutEmisor,
      emittedByUserId: row.emittedByUserId as Document['emittedByUserId'],
      emittedAt: row.emittedAt,
      retentionUntil: row.retentionUntil,
      piiRedactedCopy: row.piiRedactedCopy,
      metadata: row.metadata,
      createdAt: '2026-05-04T00:00:00.000Z',
      updatedAt: '2026-05-04T00:00:00.000Z',
    };
    this.docs.push(doc);
    return doc;
  }

  async findById(id: string): Promise<Document | null> {
    return this.docs.find((d) => d.id === id) ?? null;
  }

  async query(_filter: DocumentQuery): Promise<Document[]> {
    return [...this.docs];
  }

  async softDelete(_id: string): Promise<void> {
    /* no-op */
  }
}

/**
 * Stub mínimo de @google-cloud/storage. Captura el upload y permite a
 * los tests verificar `bucket.file(...).save()` calls.
 */
function makeStorageStub(): {
  storage: Storage;
  saved: Array<{ path: string; size: number; mime: string }>;
} {
  const saved: Array<{ path: string; size: number; mime: string }> = [];
  const fileFn = (path: string): File =>
    ({
      save: async (body: Buffer, opts: { contentType: string }): Promise<void> => {
        saved.push({ path, size: body.byteLength, mime: opts.contentType });
      },
    }) as unknown as File;
  const bucketFn = (_name: string): Bucket =>
    ({
      file: fileFn,
    }) as unknown as Bucket;
  const storage = { bucket: bucketFn } as unknown as Storage;
  return { storage, saved };
}

const VALID_EMPRESA = '00000000-0000-0000-0000-000000000aaa';
const VALID_TRIP = '00000000-0000-0000-0000-000000000bbb';
const VALID_USER = '00000000-0000-0000-0000-000000000ccc';

describe('DocumentIndexer.upload', () => {
  let store: InMemoryStore;
  let saved: Array<{ path: string; size: number; mime: string }>;

  beforeEach(() => {
    store = new InMemoryStore();
    const stub = makeStorageStub();
    saved = stub.saved;
    setStorageForTesting(stub.storage);
  });

  it('sube un PDF de carta_porte y persiste retention 6 años', async () => {
    const indexer = new DocumentIndexer({
      bucket: 'booster-ai-documents-test',
      store,
      now: () => new Date('2026-05-04T10:00:00.000Z'),
    });

    const result = await indexer.upload({
      empresaId: VALID_EMPRESA,
      tripId: VALID_TRIP,
      type: 'carta_porte',
      body: Buffer.from('%PDF-1.4 fake content'),
      mimeType: 'application/pdf',
      emittedByUserId: VALID_USER,
    });

    expect(saved).toHaveLength(1);
    expect(saved[0]?.mime).toBe('application/pdf');
    expect(result.gcsUri).toMatch(/^gs:\/\/booster-ai-documents-test\/carta-porte\/2026\/05\//);
    expect(result.document.retentionUntil).toBe('2032-05-04T10:00:00.000Z');
    expect(store.lastInsert?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(store.lastInsert?.tripId).toBe(VALID_TRIP);
  });

  it('NO setea retention para foto_pickup', async () => {
    const indexer = new DocumentIndexer({
      bucket: 'b',
      store,
      now: () => new Date('2026-05-04T00:00:00Z'),
    });
    await indexer.upload({
      empresaId: VALID_EMPRESA,
      tripId: VALID_TRIP,
      type: 'foto_pickup',
      body: Buffer.from([0xff, 0xd8, 0xff]),
      mimeType: 'image/jpeg',
    });
    expect(store.lastInsert?.retentionUntil).toBeNull();
  });

  it('persiste folio + rut para DTE Guía', async () => {
    const indexer = new DocumentIndexer({ bucket: 'b', store });
    await indexer.upload({
      empresaId: VALID_EMPRESA,
      tripId: VALID_TRIP,
      type: 'dte_guia_despacho',
      body: Buffer.from('<DTE/>'),
      mimeType: 'application/xml',
      folioSii: '12345',
      rutEmisor: '76543210-3',
    });
    expect(store.lastInsert?.folioSii).toBe('12345');
    expect(store.lastInsert?.rutEmisor).toBe('76543210-3');
    // El path debería usar el folio como identifier (rut-folio)
    expect(store.lastInsert?.gcsPath).toContain('76543210-3-12345');
  });

  it('throw si el sha256 declarado no matchea el computado', async () => {
    const indexer = new DocumentIndexer({ bucket: 'b', store });
    await expect(
      indexer.upload({
        empresaId: VALID_EMPRESA,
        type: 'otro',
        body: Buffer.from('hello'),
        mimeType: 'application/pdf',
        sha256: 'a'.repeat(64), // intencionalmente incorrecto
      }),
    ).rejects.toThrow(/sha256 mismatch/);
  });

  it('honra emittedAt explícito en el cálculo de retention', async () => {
    const indexer = new DocumentIndexer({ bucket: 'b', store });
    await indexer.upload({
      empresaId: VALID_EMPRESA,
      tripId: VALID_TRIP,
      type: 'dte_guia_despacho',
      body: Buffer.from('<DTE/>'),
      mimeType: 'application/xml',
      emittedAt: '2026-01-01T00:00:00.000Z',
      folioSii: '1',
      rutEmisor: '11111111-1', // 1×2 + 1×3 + 1×4 + 1×5 + 1×6 + 1×7 + 1×2 + 1×3 = 32; 11-(32%11)=11-10=1 ✓
    });
    expect(store.lastInsert?.retentionUntil).toBe('2032-01-01T00:00:00.000Z');
  });
});

describe('DocumentIndexer.softDelete', () => {
  let store: InMemoryStore;
  beforeEach(() => {
    store = new InMemoryStore();
    setStorageForTesting(makeStorageStub().storage);
  });

  it('rechaza tipos con retention legal', async () => {
    const indexer = new DocumentIndexer({ bucket: 'b', store });
    const { document } = await indexer.upload({
      empresaId: VALID_EMPRESA,
      tripId: VALID_TRIP,
      type: 'carta_porte',
      body: Buffer.from('x'),
      mimeType: 'application/pdf',
    });
    await expect(indexer.softDelete(document.id)).rejects.toBeInstanceOf(DocumentRetentionError);
  });

  it('permite delete de tipos no retenidos', async () => {
    const indexer = new DocumentIndexer({ bucket: 'b', store });
    const spy = vi.spyOn(store, 'softDelete');
    const { document } = await indexer.upload({
      empresaId: VALID_EMPRESA,
      tripId: VALID_TRIP,
      type: 'foto_pickup',
      body: Buffer.from('x'),
      mimeType: 'image/jpeg',
    });
    await indexer.softDelete(document.id);
    expect(spy).toHaveBeenCalledWith(document.id);
  });

  it('throw si el documento no existe', async () => {
    const indexer = new DocumentIndexer({ bucket: 'b', store });
    await expect(indexer.softDelete('no-existe')).rejects.toThrow(/no encontrado/);
  });
});
