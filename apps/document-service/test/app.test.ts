import { createHash, randomUUID } from 'node:crypto';
import type {
  BlobStore,
  DocumentRecord,
  DocumentRepo,
  ListDocumentsFilter,
} from '@booster-ai/document-indexer';
import { MockDteProvider } from '@booster-ai/dte-provider';
import { type Logger, createLogger } from '@booster-ai/logger';
import { describe, expect, it } from 'vitest';
import { type AppDependencies, createApp } from '../src/app.js';

class MemoryRepo implements DocumentRepo {
  store = new Map<string, DocumentRecord>();
  async insert(input: DocumentRecord): Promise<void> {
    this.store.set(input.id, input);
  }
  async findById(id: string): Promise<DocumentRecord | null> {
    return this.store.get(id) ?? null;
  }
  async list(filter: ListDocumentsFilter): Promise<DocumentRecord[]> {
    let list = [...this.store.values()];
    if (filter.tripId) {
      list = list.filter((d) => d.tripId === filter.tripId);
    }
    if (filter.type) {
      list = list.filter((d) => d.type === filter.type);
    }
    return list.slice(filter.offset, filter.offset + filter.limit);
  }
  async findExpired(): Promise<DocumentRecord[]> {
    return [];
  }
  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }
}

class MemoryBlobStore implements BlobStore {
  uploaded = new Map<string, Buffer>();
  signedReads: string[] = [];
  signedUploads: string[] = [];

  async getSignedReadUrl(args: { objectName: string }): Promise<string> {
    this.signedReads.push(args.objectName);
    return `https://signed.test/read/${encodeURIComponent(args.objectName)}`;
  }
  async getSignedUploadUrl(args: { objectName: string }): Promise<string> {
    this.signedUploads.push(args.objectName);
    return `https://signed.test/upload/${encodeURIComponent(args.objectName)}`;
  }
  async statObject(name: string) {
    const buf = this.uploaded.get(name);
    return buf ? { sizeBytes: buf.byteLength } : null;
  }
  async deleteObject(name: string): Promise<void> {
    this.uploaded.delete(name);
  }
  // Extension property that document-service uses to upload
  async uploadObject(name: string, payload: string | Uint8Array | Buffer): Promise<void> {
    const buf =
      typeof payload === 'string'
        ? Buffer.from(payload)
        : Buffer.isBuffer(payload)
          ? payload
          : Buffer.from(payload);
    this.uploaded.set(name, buf);
  }
}

const logger = createLogger({
  service: 'test',
  version: '0.0.0',
  level: 'silent' as Parameters<typeof createLogger>[0]['level'],
}) as unknown as Logger;

function buildDeps(overrides: Partial<AppDependencies> = {}): AppDependencies {
  return {
    logger,
    dteProvider: new MockDteProvider(),
    documentRepo: new MemoryRepo(),
    blobStore: new MemoryBlobStore(),
    bucket: 'test-bucket',
    ...overrides,
  };
}

const validGuiaInput = {
  rutEmisor: '76123456-7',
  razonSocialEmisor: 'Transportes Test SpA',
  rutReceptor: '12345678-9',
  razonSocialReceptor: 'Cliente SA',
  fechaEmision: new Date('2026-05-04T10:00:00Z').toISOString(),
  items: [
    {
      descripcion: 'Transporte Santiago → Concepción',
      cantidad: 1,
      precioUnitarioClp: 850000,
      unidadMedida: 'VIAJE',
    },
  ],
  transporte: {
    rutChofer: '11111111-1',
    nombreChofer: 'Juan Pérez',
    patente: 'AB-CD-12',
    direccionDestino: 'Av. Principal 123',
    comunaDestino: 'Concepción',
  },
  tipoDespacho: 5,
};

const validCartaInput = {
  trackingCode: 'BOO-TEST01',
  fechaEmision: new Date('2026-05-04T10:00:00Z').toISOString(),
  fechaSalida: new Date('2026-05-04T14:00:00Z').toISOString(),
  remitente: {
    rut: '12345678-9',
    razonSocial: 'Cliente SA',
    giro: 'Comercio',
    direccion: 'Av. Apoquindo 4500',
    comuna: 'Las Condes',
  },
  transportista: {
    rut: '76123456-7',
    razonSocial: 'Transportes Chile SpA',
    giro: 'Transporte',
    direccion: 'Camino X 123',
    comuna: 'Quilicura',
  },
  conductor: {
    rut: '11111111-1',
    nombreCompleto: 'Juan Pérez',
    numeroLicencia: 'LIC-12345',
    claseLicencia: 'A3',
  },
  vehiculo: {
    patente: 'AB-CD-12',
    marca: 'Volvo',
    modelo: 'FH 460',
    anio: 2022,
    capacidadKg: 25_000,
    tipoVehiculo: 'camion_pesado',
  },
  origen: {
    direccion: 'Av. Apoquindo 4500',
    comuna: 'Las Condes',
    region: 'Metropolitana',
  },
  destino: {
    direccion: 'Calle Comercio 100',
    comuna: 'Concepción',
    region: 'Biobío',
  },
  cargas: [
    {
      descripcion: 'Cemento',
      cantidad: 100,
      unidadMedida: 'sacos',
      pesoKg: 2_500,
      tipoCarga: 'construccion',
    },
  ],
};

describe('document-service — healthz', () => {
  it('GET /healthz responde 200 ok', async () => {
    const app = createApp(buildDeps());
    const res = await app.request('/healthz');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, service: 'document-service' });
  });
});

describe('document-service — POST /generate/guia-despacho', () => {
  it('emite + indexa + sube a GCS', async () => {
    const repo = new MemoryRepo();
    const blob = new MemoryBlobStore();
    const app = createApp(buildDeps({ documentRepo: repo, blobStore: blob }));
    const tripId = randomUUID();
    const userId = randomUUID();

    const res = await app.request('/generate/guia-despacho', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tripId,
        userId,
        guia: validGuiaInput,
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.dte.folio).toBe('1');
    expect(body.dte.tipoDte).toBe(52);
    expect(body.document.tripId).toBe(tripId);
    expect(body.document.type).toBe('dte_52');
    expect(repo.store.size).toBe(1);
    expect(blob.uploaded.size).toBe(1);
  });

  it('rechaza input inválido con 400', async () => {
    const app = createApp(buildDeps());
    const res = await app.request('/generate/guia-despacho', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tripId: randomUUID(),
        guia: { ...validGuiaInput, rutEmisor: 'no-es-rut' },
      }),
    });
    expect(res.status).toBe(400);
  });

  it('respeta authorize → forbidden', async () => {
    const app = createApp(buildDeps({ authorize: async () => false }));
    const res = await app.request('/generate/guia-despacho', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tripId: randomUUID(),
        guia: validGuiaInput,
      }),
    });
    expect(res.status).toBe(403);
  });

  it('respeta authorize → unauthenticated', async () => {
    const app = createApp(buildDeps({ authorize: async () => 'anonymous' as const }));
    const res = await app.request('/generate/guia-despacho', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tripId: randomUUID(),
        guia: validGuiaInput,
      }),
    });
    expect(res.status).toBe(401);
  });
});

describe('document-service — POST /generate/carta-porte', () => {
  it('genera PDF + indexa + retorna signed URL', async () => {
    const repo = new MemoryRepo();
    const blob = new MemoryBlobStore();
    const app = createApp(buildDeps({ documentRepo: repo, blobStore: blob }));
    const tripId = randomUUID();

    const res = await app.request('/generate/carta-porte', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tripId,
        userId: randomUUID(),
        carta: validCartaInput,
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.document.type).toBe('carta_porte');
    expect(body.document.tripId).toBe(tripId);
    expect(body.downloadUrl).toContain('signed.test/read/');
    expect(repo.store.size).toBe(1);
    expect(blob.uploaded.size).toBe(1);
    // El PDF subido debe tener magic bytes %PDF
    const uploadedPath = [...blob.uploaded.keys()][0]!;
    const buf = blob.uploaded.get(uploadedPath)!;
    expect(buf.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('rechaza carta inválida con 400', async () => {
    const app = createApp(buildDeps());
    const res = await app.request('/generate/carta-porte', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tripId: randomUUID(),
        carta: { ...validCartaInput, trackingCode: '' },
      }),
    });
    expect(res.status).toBe(400);
  });
});

describe('document-service — POST /documents/upload-url', () => {
  it('retorna signed URL para PUT', async () => {
    const blob = new MemoryBlobStore();
    const app = createApp(buildDeps({ blobStore: blob }));
    const res = await app.request('/documents/upload-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tripId: randomUUID(),
        type: 'foto_pickup',
        identifier: 'trip1-driver1',
        contentType: 'image/jpeg',
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.uploadUrl).toContain('signed.test/upload/');
    expect(body.expiresInSeconds).toBe(900);
    expect(blob.signedUploads).toHaveLength(1);
  });
});

describe('document-service — GET /documents/:id', () => {
  it('retorna metadata del documento', async () => {
    const repo = new MemoryRepo();
    const sha = createHash('sha256').update('x').digest('hex');
    const record: DocumentRecord = {
      id: randomUUID(),
      tripId: randomUUID(),
      type: 'carta_porte',
      gcsPath: 'carta-porte/2026/05/cp-X.pdf',
      sha256: sha,
      folioSii: null,
      emittedByUserId: null,
      emittedAt: new Date(),
      retentionUntil: new Date('2033-01-01'),
      piiRedactedCopyExists: false,
      sizeBytes: 1234,
    };
    await repo.insert(record);
    const app = createApp(buildDeps({ documentRepo: repo }));
    const res = await app.request(`/documents/${record.id}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.document.id).toBe(record.id);
  });

  it('404 si no existe', async () => {
    const app = createApp(buildDeps());
    const res = await app.request(`/documents/${randomUUID()}`);
    expect(res.status).toBe(404);
  });
});

describe('document-service — GET /documents/:id/signed-url', () => {
  it('retorna signed URL del documento', async () => {
    const repo = new MemoryRepo();
    const blob = new MemoryBlobStore();
    const sha = createHash('sha256').update('x').digest('hex');
    const record: DocumentRecord = {
      id: randomUUID(),
      tripId: randomUUID(),
      type: 'dte_52',
      gcsPath: 'dte/2026/05/guia-1.xml',
      sha256: sha,
      folioSii: '1',
      emittedByUserId: null,
      emittedAt: new Date(),
      retentionUntil: new Date('2033-01-01'),
      piiRedactedCopyExists: false,
      sizeBytes: 100,
    };
    await repo.insert(record);
    const app = createApp(buildDeps({ documentRepo: repo, blobStore: blob }));
    const res = await app.request(`/documents/${record.id}/signed-url`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.downloadUrl).toContain('signed.test/read/');
    expect(body.expiresInSeconds).toBe(900);
  });
});

describe('document-service — GET /documents (listado)', () => {
  it('filtra por tripId', async () => {
    const repo = new MemoryRepo();
    const sha = createHash('sha256').update('x').digest('hex');
    const trip1 = randomUUID();
    const trip2 = randomUUID();
    for (const tripId of [trip1, trip1, trip2]) {
      await repo.insert({
        id: randomUUID(),
        tripId,
        type: 'dte_52',
        gcsPath: 'x',
        sha256: sha,
        folioSii: '1',
        emittedByUserId: null,
        emittedAt: new Date(),
        retentionUntil: new Date('2033-01-01'),
        piiRedactedCopyExists: false,
        sizeBytes: 100,
      });
    }
    const app = createApp(buildDeps({ documentRepo: repo }));
    const res = await app.request(`/documents?tripId=${trip1}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(2);
  });
});
