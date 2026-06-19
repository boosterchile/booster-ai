import type { IngestResult } from '@booster-ai/transport-documents';
import { describe, expect, it, vi } from 'vitest';
import {
  type DocumentStore,
  type ObjectDownloader,
  documentUploadedMessageSchema,
  processDocumentUploaded,
} from './process-document-uploaded.js';

const VALID_MESSAGE = {
  documentId: '11111111-1111-1111-1111-111111111111',
  viajeId: '22222222-2222-2222-2222-222222222222',
  filePath: 'transport-documents/22222222-2222-2222-2222-222222222222/abc.pdf',
  fileMime: 'application/pdf',
};

const DECODED: Extract<IngestResult, { status: 'decodificado' }> = {
  status: 'decodificado',
  fields: {
    rutEmisor: '76111111-1',
    docType: '52',
    folio: '67',
    fechaEmision: '2026-06-11',
    rutReceptor: '12345678-5',
    razonSocialReceptor: 'Comprador S.A.',
    razonSocialEmisor: null,
    montoTotal: '24365',
  },
  tedRaw: '<TED>...</TED>',
  retentionUntil: '2032-06-11',
  needsRetentionReview: false,
};

function makeStore(overrides?: Partial<DocumentStore>): DocumentStore {
  return {
    claimForProcessing: overrides?.claimForProcessing ?? vi.fn(async () => true),
    loadCreatedAt: overrides?.loadCreatedAt ?? vi.fn(async () => new Date('2026-06-18T00:00:00Z')),
    persistDecoded: overrides?.persistDecoded ?? vi.fn(async () => undefined),
    markFailed: overrides?.markFailed ?? vi.fn(async () => undefined),
  };
}

function makeDownloader(bytes = Uint8Array.from([0x25, 0x50, 0x44, 0x46])): ObjectDownloader {
  return { download: vi.fn(async () => bytes) };
}

const okIngestor = { ingest: vi.fn(async (): Promise<IngestResult> => DECODED) };

describe('documentUploadedMessageSchema — boundary Zod del consumer', () => {
  it('acepta un payload bien formado', () => {
    expect(documentUploadedMessageSchema.safeParse(VALID_MESSAGE).success).toBe(true);
  });

  it('rechaza un payload sin documentId', () => {
    const { documentId, ...rest } = VALID_MESSAGE;
    void documentId;
    expect(documentUploadedMessageSchema.safeParse(rest).success).toBe(false);
  });

  it('rechaza documentId que no es uuid', () => {
    expect(
      documentUploadedMessageSchema.safeParse({ ...VALID_MESSAGE, documentId: 'no-uuid' }).success,
    ).toBe(false);
  });

  it('rechaza un filePath fuera del prefijo transport-documents/ (objeto arbitrario)', () => {
    expect(
      documentUploadedMessageSchema.safeParse({
        ...VALID_MESSAGE,
        filePath: 'certificates/secreto.pdf',
      }).success,
    ).toBe(false);
  });

  it('rechaza un filePath con traversal ".." aunque tenga el prefijo', () => {
    expect(
      documentUploadedMessageSchema.safeParse({
        ...VALID_MESSAGE,
        filePath: 'transport-documents/../certificates/secreto.pdf',
      }).success,
    ).toBe(false);
  });

  it('acepta un filePath con el prefijo correcto', () => {
    expect(
      documentUploadedMessageSchema.safeParse({
        ...VALID_MESSAGE,
        filePath: 'transport-documents/22222222-2222-2222-2222-222222222222/abc.pdf',
      }).success,
    ).toBe(true);
  });
});

describe('processDocumentUploaded — decode + persistencia (4b)', () => {
  it('PDF decodificable → claim, descarga, ingesta, persistDecoded, outcome "decodificado"', async () => {
    const store = makeStore();
    const downloader = makeDownloader();
    const outcome = await processDocumentUploaded({
      message: VALID_MESSAGE,
      store,
      downloader,
      ingestor: okIngestor,
    });

    expect(outcome).toBe('decodificado');
    expect(store.claimForProcessing).toHaveBeenCalledWith(VALID_MESSAGE.documentId);
    expect(downloader.download).toHaveBeenCalledWith(VALID_MESSAGE.filePath);
    expect(store.persistDecoded).toHaveBeenCalledOnce();
    expect(store.markFailed).not.toHaveBeenCalled();
  });

  it('persiste los campos del <DD> mapeados + ted_raw + retención al decodificar', async () => {
    const persistDecoded = vi.fn(async () => undefined);
    const store = makeStore({ persistDecoded });
    await processDocumentUploaded({
      message: VALID_MESSAGE,
      store,
      downloader: makeDownloader(),
      ingestor: okIngestor,
    });
    expect(persistDecoded).toHaveBeenCalledWith(VALID_MESSAGE.documentId, DECODED);
  });

  it('foto/PDF sin TED legible → markFailed, outcome "fallido"', async () => {
    const failingIngestor = {
      ingest: vi.fn(
        async (): Promise<IngestResult> => ({
          status: 'fallido',
          reason: 'no_pdf417_found',
        }),
      ),
    };
    const store = makeStore();
    const outcome = await processDocumentUploaded({
      message: VALID_MESSAGE,
      store,
      downloader: makeDownloader(),
      ingestor: failingIngestor,
    });
    expect(outcome).toBe('fallido');
    expect(store.markFailed).toHaveBeenCalledWith(VALID_MESSAGE.documentId, 'no_pdf417_found');
    expect(store.persistDecoded).not.toHaveBeenCalled();
  });

  it('idempotencia: si el doc ya no está en pendiente/fallido (claim devuelve false) → outcome "skipped", no reprocesa', async () => {
    const store = makeStore({ claimForProcessing: vi.fn(async () => false) });
    const downloader = makeDownloader();
    const ingestor = { ingest: vi.fn(async (): Promise<IngestResult> => DECODED) };
    const outcome = await processDocumentUploaded({
      message: VALID_MESSAGE,
      store,
      downloader,
      ingestor,
    });
    expect(outcome).toBe('skipped');
    // No descarga ni ingesta ni persiste: el claim condicional cortó temprano.
    expect(downloader.download).not.toHaveBeenCalled();
    expect(ingestor.ingest).not.toHaveBeenCalled();
    expect(store.persistDecoded).not.toHaveBeenCalled();
    expect(store.markFailed).not.toHaveBeenCalled();
  });

  it('idempotencia: reentrega del MISMO documentId no duplica (segundo claim es false)', async () => {
    let claimed = false;
    const store = makeStore({
      claimForProcessing: vi.fn(async () => {
        if (claimed) {
          return false;
        }
        claimed = true;
        return true;
      }),
    });
    const args = {
      message: VALID_MESSAGE,
      store,
      downloader: makeDownloader(),
      ingestor: { ingest: vi.fn(async (): Promise<IngestResult> => DECODED) },
    };
    const first = await processDocumentUploaded(args);
    const second = await processDocumentUploaded(args);
    expect(first).toBe('decodificado');
    expect(second).toBe('skipped');
    expect(store.persistDecoded).toHaveBeenCalledOnce();
  });

  it('error transitorio en la descarga (GCS caído) → propaga para nack Y revierte el claim a fallido (no deja procesando colgado)', async () => {
    const markFailed = vi.fn(async (_id: string, _reason: string) => undefined);
    const store = makeStore({ markFailed });
    const downloader: ObjectDownloader = {
      download: vi.fn(async () => {
        throw new Error('GCS unavailable');
      }),
    };
    await expect(
      processDocumentUploaded({
        message: VALID_MESSAGE,
        store,
        downloader,
        ingestor: okIngestor,
      }),
    ).rejects.toThrow('GCS unavailable');
    // P0: la fila NO debe quedar en `procesando`. Se revierte a `fallido`
    // (reclaimable + conservada) antes de propagar el error para el nack.
    expect(markFailed).toHaveBeenCalledOnce();
    expect(markFailed.mock.calls[0]?.[0]).toBe(VALID_MESSAGE.documentId);
    expect(markFailed.mock.calls[0]?.[1]).toContain('GCS unavailable');
  });

  it('error transitorio al persistir → propaga para nack (no se traga) Y revierte a fallido', async () => {
    const markFailed = vi.fn(async (_id: string, _reason: string) => undefined);
    const store = makeStore({
      markFailed,
      persistDecoded: vi.fn(async () => {
        throw new Error('DB connection lost');
      }),
    });
    await expect(
      processDocumentUploaded({
        message: VALID_MESSAGE,
        store,
        downloader: makeDownloader(),
        ingestor: okIngestor,
      }),
    ).rejects.toThrow('DB connection lost');
    expect(markFailed).toHaveBeenCalledOnce();
    expect(markFailed.mock.calls[0]?.[1]).toContain('DB connection lost');
  });

  it('crash mid-process (ingestor lanza inesperadamente) → revierte el claim a fallido y propaga (no queda locked en procesando)', async () => {
    const markFailed = vi.fn(async (_id: string, _reason: string) => undefined);
    const store = makeStore({ markFailed });
    const crashingIngestor = {
      ingest: vi.fn(async (): Promise<IngestResult> => {
        throw new Error('OOM mid-render');
      }),
    };
    await expect(
      processDocumentUploaded({
        message: VALID_MESSAGE,
        store,
        downloader: makeDownloader(),
        ingestor: crashingIngestor,
      }),
    ).rejects.toThrow('OOM mid-render');
    // La fila reclamada (procesando) se revierte a fallido → reclaimable en la
    // próxima reentrega; nunca queda atascada.
    expect(markFailed).toHaveBeenCalledOnce();
    expect(store.persistDecoded).not.toHaveBeenCalled();
  });

  it('si la reversión a fallido tras un error también falla → propaga el error ORIGINAL (no lo enmascara)', async () => {
    const store = makeStore({
      loadCreatedAt: vi.fn(async () => new Date('2026-06-18T00:00:00Z')),
      markFailed: vi.fn(async () => {
        throw new Error('DB sigue caída en el reset');
      }),
    });
    const downloader: ObjectDownloader = {
      download: vi.fn(async () => {
        throw new Error('GCS unavailable');
      }),
    };
    // El error que gobierna el nack es el transitorio original, no el del reset.
    await expect(
      processDocumentUploaded({
        message: VALID_MESSAGE,
        store,
        downloader,
        ingestor: okIngestor,
      }),
    ).rejects.toThrow('GCS unavailable');
  });
});
