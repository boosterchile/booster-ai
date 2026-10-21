import type { Logger } from '@booster-ai/logger';
import type { IngestResult } from '@booster-ai/transport-documents';
import { describe, expect, it, vi } from 'vitest';
import { createDocumentUploadedHandler } from './handle-document-uploaded.js';
import type { DocumentStore, ObjectDownloader } from './process-document-uploaded.js';

const VALID_MESSAGE = {
  documentId: '11111111-1111-1111-1111-111111111111',
  viajeId: '22222222-2222-2222-2222-222222222222',
  filePath: 'transport-documents/22222222-2222-2222-2222-222222222222/abc.pdf',
  fileMime: 'application/pdf',
};

const FAILED: IngestResult = { status: 'fallido', reason: 'no_pdf417_found' };

function makeLogger() {
  const noop = (): void => undefined;
  const logger = {
    trace: noop,
    debug: noop,
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: noop,
    child: () => logger,
  };
  return logger;
}

function makeDeps(overrides?: { store?: Partial<DocumentStore>; downloader?: ObjectDownloader }) {
  const logger = makeLogger();
  const store: DocumentStore = {
    claimForProcessing: vi.fn(async () => true),
    loadCreatedAt: vi.fn(async () => new Date('2026-10-21T00:00:00Z')),
    persistDecoded: vi.fn(async () => undefined),
    markFailed: vi.fn(async () => undefined),
    ...overrides?.store,
  };
  const downloader = overrides?.downloader ?? {
    download: vi.fn(async () => Uint8Array.from([0x25, 0x50, 0x44, 0x46])),
  };
  const ingestor = { ingest: vi.fn(async () => FAILED) };
  const handle = createDocumentUploadedHandler({
    store,
    downloader,
    ingestor,
    logger: logger as never as Logger,
  });
  return { handle, logger, store, ingestor };
}

const delivery = (body: unknown) => ({
  data: Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)),
  messageId: 'msg-1',
  deliveryAttempt: 2,
});

describe('createDocumentUploadedHandler — decisión ack/nack común a pull y push', () => {
  it('procesa un mensaje válido y confirma (ack)', async () => {
    const { handle, logger, store, ingestor } = makeDeps();
    await expect(handle(delivery(VALID_MESSAGE))).resolves.toBe('ack');
    expect(store.claimForProcessing).toHaveBeenCalledWith(VALID_MESSAGE.documentId);
    expect(ingestor.ingest).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: 'msg-1', deliveryAttempt: 2, outcome: 'fallido' }),
      'document.uploaded procesado',
    );
  });

  it('confirma el skip idempotente sin tocar GCS', async () => {
    const download = vi.fn(async () => new Uint8Array());
    const { handle } = makeDeps({
      store: { claimForProcessing: vi.fn(async () => false) },
      downloader: { download },
    });
    await expect(handle(delivery(VALID_MESSAGE))).resolves.toBe('ack');
    expect(download).not.toHaveBeenCalled();
  });

  it('descarta (ack) un body que no es JSON, sin reintentar ni tocar la base', async () => {
    const { handle, logger, store } = makeDeps();
    await expect(handle(delivery('no es json {'))).resolves.toBe('ack');
    expect(store.claimForProcessing).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ errors: [{ message: 'JSON inválido' }] }),
      'document.uploaded malformado, ack para descartar (no reintentar)',
    );
  });

  it('descarta (ack) un JSON fuera de contrato (filePath fuera de prefijo)', async () => {
    const { handle, store } = makeDeps();
    await expect(
      handle(delivery({ ...VALID_MESSAGE, filePath: 'certificates/secreto.pdf' })),
    ).resolves.toBe('ack');
    expect(store.claimForProcessing).not.toHaveBeenCalled();
  });

  it('pide reintento (nack) ante un error transitorio de GCS', async () => {
    const { handle, logger, store } = makeDeps({
      downloader: {
        download: vi.fn(async () => {
          throw new Error('ECONNRESET');
        }),
      },
    });
    await expect(handle(delivery(VALID_MESSAGE))).resolves.toBe('nack');
    // processDocumentUploaded revierte el claim antes de propagar.
    expect(store.markFailed).toHaveBeenCalledWith(
      VALID_MESSAGE.documentId,
      'reset_tras_error:ECONNRESET',
    );
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: 'msg-1', documentId: VALID_MESSAGE.documentId }),
      'error procesando document.uploaded, nack para reintento',
    );
  });
});
