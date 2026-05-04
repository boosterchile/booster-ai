import { createHash, randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  type BlobStore,
  DocumentIntegrityError,
  DocumentNotFoundError,
  type DocumentRecord,
  type DocumentRepo,
  DocumentRetentionViolationError,
  DocumentValidationError,
  assertRetentionExpired,
  assertSha256Match,
  computeRetentionUntil,
  deleteDocumentIfExpired,
  gcsPathFor,
  getDocumentById,
  getSignedReadUrl,
  getSignedUploadUrl,
  indexDocument,
  isRetentionExpired,
  listDocuments,
  redactedPathFor,
} from '../src/index.js';

// ---------------------------------------------------------------------------
// In-memory implementations para tests
// ---------------------------------------------------------------------------

class MemoryRepo implements DocumentRepo {
  private store = new Map<string, DocumentRecord>();
  async insert(input: DocumentRecord): Promise<void> {
    this.store.set(input.id, input);
  }
  async findById(id: string): Promise<DocumentRecord | null> {
    return this.store.get(id) ?? null;
  }
  async list(filter: {
    tripId?: string;
    type?: string;
    emittedAfter?: Date;
    emittedBefore?: Date;
    limit: number;
    offset: number;
  }): Promise<DocumentRecord[]> {
    let list = [...this.store.values()];
    if (filter.tripId) {
      list = list.filter((d) => d.tripId === filter.tripId);
    }
    if (filter.type) {
      list = list.filter((d) => d.type === filter.type);
    }
    if (filter.emittedAfter) {
      list = list.filter((d) => d.emittedAt.getTime() >= filter.emittedAfter?.getTime());
    }
    if (filter.emittedBefore) {
      list = list.filter((d) => d.emittedAt.getTime() < filter.emittedBefore?.getTime());
    }
    return list.slice(filter.offset, filter.offset + filter.limit);
  }
  async findExpired(asOf: Date, limit: number): Promise<DocumentRecord[]> {
    return [...this.store.values()]
      .filter((d) => d.retentionUntil.getTime() <= asOf.getTime())
      .slice(0, limit);
  }
  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }
}

class MemoryBlobStore implements BlobStore {
  blobs = new Map<string, Uint8Array>();
  signedReads: string[] = [];
  signedUploads: string[] = [];
  deleted: string[] = [];

  async getSignedReadUrl(args: { objectName: string }): Promise<string> {
    this.signedReads.push(args.objectName);
    return `https://signed.test/read/${encodeURIComponent(args.objectName)}`;
  }
  async getSignedUploadUrl(args: { objectName: string }): Promise<string> {
    this.signedUploads.push(args.objectName);
    return `https://signed.test/upload/${encodeURIComponent(args.objectName)}`;
  }
  async statObject(name: string): Promise<{ sizeBytes: number } | null> {
    const blob = this.blobs.get(name);
    return blob ? { sizeBytes: blob.byteLength } : null;
  }
  async deleteObject(name: string): Promise<void> {
    this.deleted.push(name);
    this.blobs.delete(name);
  }
}

// ---------------------------------------------------------------------------
// gcsPathFor
// ---------------------------------------------------------------------------

describe('gcsPathFor', () => {
  it('DTE 52 → /dte/{year}/{month}/guia-<folio>.xml', () => {
    const path = gcsPathFor({
      type: 'dte_52',
      identifier: '12345',
      extension: 'xml',
      emittedAt: new Date('2026-05-15T10:00:00Z'),
    });
    expect(path).toBe('dte/2026/05/guia-12345.xml');
  });

  it('Carta de Porte → /carta-porte/{year}/{month}/cp-<tracking>.pdf', () => {
    const path = gcsPathFor({
      type: 'carta_porte',
      identifier: 'BOO-ABC123',
      emittedAt: new Date('2026-01-05T00:00:00Z'),
    });
    expect(path).toBe('carta-porte/2026/01/cp-BOO-ABC123.pdf');
  });

  it('Foto pickup → /photos/pickup/{year}/{month}/pickup-<id>.jpg', () => {
    const path = gcsPathFor({
      type: 'foto_pickup',
      identifier: 'trip1-driver1',
      extension: 'jpg',
      emittedAt: new Date('2026-12-31T23:59:59Z'),
    });
    expect(path).toBe('photos/pickup/2026/12/pickup-trip1-driver1.jpg');
  });

  it('sanitiza identificadores con chars peligrosos', () => {
    const path = gcsPathFor({
      type: 'carta_porte',
      identifier: '../../../etc/passwd',
      emittedAt: new Date('2026-05-01T00:00:00Z'),
    });
    expect(path).not.toContain('..');
    expect(path).not.toContain('/etc');
  });

  it('redactedPathFor agrega .redacted.pdf', () => {
    expect(redactedPathFor('dte/2026/05/guia-1.xml')).toBe('dte/2026/05/guia-1.xml.redacted.pdf');
  });
});

// ---------------------------------------------------------------------------
// computeRetentionUntil
// ---------------------------------------------------------------------------

describe('retention', () => {
  it('default: 6 años + 365 días desde emittedAt → 2033', () => {
    // 2026-05-04 + 6 años = 2032-05-04 + 365 días = ~2033-05-04
    const emittedAt = new Date('2026-05-04T10:00:00Z');
    const r = computeRetentionUntil(emittedAt);
    expect(r.getUTCFullYear()).toBe(2033);
  });

  it('config custom: 10 años, sin margen extra', () => {
    const emittedAt = new Date('2026-05-04T10:00:00Z');
    const r = computeRetentionUntil(emittedAt, {
      retentionYears: 10,
      extraMarginDays: 0,
    });
    expect(r.getUTCFullYear()).toBe(2036);
    expect(r.getUTCMonth()).toBe(4); // mayo (0-indexed)
    expect(r.getUTCDate()).toBe(4);
  });

  it('isRetentionExpired retorna true para fecha pasada', () => {
    expect(isRetentionExpired(new Date('2020-01-01'))).toBe(true);
    expect(isRetentionExpired(new Date('2099-01-01'))).toBe(false);
  });

  it('assertRetentionExpired throws DocumentRetentionViolationError si no venció', () => {
    expect(() => assertRetentionExpired(new Date('2099-01-01'))).toThrowError(
      DocumentRetentionViolationError,
    );
    expect(() => assertRetentionExpired(new Date('2020-01-01'))).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// indexDocument
// ---------------------------------------------------------------------------

describe('indexDocument', () => {
  let repo: MemoryRepo;
  beforeEach(() => {
    repo = new MemoryRepo();
  });

  it('persiste documento con id UUID + retentionUntil calculado', async () => {
    const sha = createHash('sha256').update('payload').digest('hex');
    const record = await indexDocument(repo, {
      tripId: randomUUID(),
      type: 'carta_porte',
      gcsPath: 'carta-porte/2026/05/cp-X.pdf',
      sha256: sha,
      folioSii: null,
      emittedByUserId: randomUUID(),
      sizeBytes: 4096,
    });
    expect(record.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/);
    expect(record.retentionUntil.getUTCFullYear()).toBeGreaterThanOrEqual(2032);
    expect(record.piiRedactedCopyExists).toBe(false);
  });

  it('respeta emittedAt explícito si se pasa', async () => {
    const sha = createHash('sha256').update('payload').digest('hex');
    const fixedDate = new Date('2024-01-01T00:00:00Z');
    const record = await indexDocument(repo, {
      tripId: null,
      type: 'dte_52',
      gcsPath: 'dte/2024/01/guia-1.xml',
      sha256: sha,
      folioSii: '1',
      emittedByUserId: null,
      sizeBytes: 1234,
      emittedAt: fixedDate,
    });
    expect(record.emittedAt.toISOString()).toBe('2024-01-01T00:00:00.000Z');
  });

  it('rechaza sha256 mal formado', async () => {
    await expect(
      indexDocument(repo, {
        tripId: null,
        type: 'dte_52',
        gcsPath: 'x',
        sha256: 'short',
        folioSii: null,
        emittedByUserId: null,
        sizeBytes: 100,
      }),
    ).rejects.toThrowError(DocumentValidationError);
  });

  it('rechaza tipo no permitido', async () => {
    const sha = createHash('sha256').update('x').digest('hex');
    await expect(
      indexDocument(repo, {
        tripId: null,
        type: 'wat' as unknown as 'dte_52',
        gcsPath: 'x',
        sha256: sha,
        folioSii: null,
        emittedByUserId: null,
        sizeBytes: 100,
      }),
    ).rejects.toThrowError(DocumentValidationError);
  });
});

// ---------------------------------------------------------------------------
// listDocuments
// ---------------------------------------------------------------------------

describe('listDocuments', () => {
  it('filtra por tripId', async () => {
    const repo = new MemoryRepo();
    const sha = createHash('sha256').update('x').digest('hex');
    const trip1 = randomUUID();
    const trip2 = randomUUID();
    await indexDocument(repo, {
      tripId: trip1,
      type: 'carta_porte',
      gcsPath: 'a',
      sha256: sha,
      folioSii: null,
      emittedByUserId: null,
      sizeBytes: 1,
    });
    await indexDocument(repo, {
      tripId: trip2,
      type: 'carta_porte',
      gcsPath: 'b',
      sha256: sha,
      folioSii: null,
      emittedByUserId: null,
      sizeBytes: 1,
    });
    const list = await listDocuments(repo, { tripId: trip1 });
    expect(list).toHaveLength(1);
    expect(list[0]?.tripId).toBe(trip1);
  });

  it('respeta limit + offset', async () => {
    const repo = new MemoryRepo();
    const sha = createHash('sha256').update('x').digest('hex');
    for (let i = 0; i < 10; i++) {
      await indexDocument(repo, {
        tripId: null,
        type: 'carta_porte',
        gcsPath: `p${i}`,
        sha256: sha,
        folioSii: null,
        emittedByUserId: null,
        sizeBytes: 1,
      });
    }
    const page1 = await listDocuments(repo, { limit: 3, offset: 0 });
    const page2 = await listDocuments(repo, { limit: 3, offset: 3 });
    expect(page1).toHaveLength(3);
    expect(page2).toHaveLength(3);
    expect(page1[0]?.id).not.toBe(page2[0]?.id);
  });
});

// ---------------------------------------------------------------------------
// getDocumentById
// ---------------------------------------------------------------------------

describe('getDocumentById', () => {
  it('throws DocumentNotFoundError si no existe', async () => {
    const repo = new MemoryRepo();
    await expect(getDocumentById(repo, randomUUID())).rejects.toThrowError(DocumentNotFoundError);
  });
});

// ---------------------------------------------------------------------------
// signed URLs
// ---------------------------------------------------------------------------

describe('signed URLs', () => {
  it('getSignedReadUrl retorna URL firmada del backend abstract', async () => {
    const blob = new MemoryBlobStore();
    const url = await getSignedReadUrl(blob, 'dte/2026/05/guia-1.xml');
    expect(url).toContain('signed.test/read/');
    expect(blob.signedReads).toContain('dte/2026/05/guia-1.xml');
  });

  it('getSignedUploadUrl pasa contentType al backend', async () => {
    const blob = new MemoryBlobStore();
    const url = await getSignedUploadUrl(blob, {
      objectName: 'photos/pickup/2026/05/pickup-x.jpg',
      contentType: 'image/jpeg',
    });
    expect(url).toContain('signed.test/upload/');
  });
});

// ---------------------------------------------------------------------------
// assertSha256Match
// ---------------------------------------------------------------------------

describe('assertSha256Match', () => {
  it('no throwea si matchea', () => {
    const buf = Buffer.from('payload');
    const sha = createHash('sha256').update(buf).digest('hex');
    expect(() => assertSha256Match(sha, buf)).not.toThrow();
  });

  it('throws DocumentIntegrityError si no matchea', () => {
    const buf = Buffer.from('payload');
    expect(() => assertSha256Match('a'.repeat(64), buf)).toThrowError(DocumentIntegrityError);
  });

  it('acepta Uint8Array además de Buffer', () => {
    const u8 = new Uint8Array([1, 2, 3, 4]);
    const sha = createHash('sha256').update(Buffer.from(u8)).digest('hex');
    expect(() => assertSha256Match(sha, u8)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// deleteDocumentIfExpired
// ---------------------------------------------------------------------------

describe('deleteDocumentIfExpired', () => {
  it('borra del repo + blob si retention venció', async () => {
    const repo = new MemoryRepo();
    const blob = new MemoryBlobStore();
    const sha = createHash('sha256').update('x').digest('hex');
    const oldDate = new Date('2010-01-01T00:00:00Z');
    const record = await indexDocument(repo, {
      tripId: null,
      type: 'dte_52',
      gcsPath: 'old',
      sha256: sha,
      folioSii: '1',
      emittedByUserId: null,
      sizeBytes: 1,
      emittedAt: oldDate,
    });
    blob.blobs.set('old', new Uint8Array());

    await deleteDocumentIfExpired(repo, blob, record.id);
    expect(blob.deleted).toContain('old');
    expect(await repo.findById(record.id)).toBeNull();
  });

  it('throws DocumentRetentionViolationError si retention vigente', async () => {
    const repo = new MemoryRepo();
    const blob = new MemoryBlobStore();
    const sha = createHash('sha256').update('x').digest('hex');
    const record = await indexDocument(repo, {
      tripId: null,
      type: 'dte_52',
      gcsPath: 'recent',
      sha256: sha,
      folioSii: '1',
      emittedByUserId: null,
      sizeBytes: 1,
    });
    await expect(deleteDocumentIfExpired(repo, blob, record.id)).rejects.toThrowError(
      DocumentRetentionViolationError,
    );
    expect(blob.deleted).not.toContain('recent');
  });
});
