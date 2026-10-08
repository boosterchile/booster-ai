import { describe, expect, it, vi } from 'vitest';

const publishMessage = vi.fn();
const topic = vi.fn(() => ({ publishMessage }));
vi.mock('@google-cloud/pubsub', () => ({
  PubSub: vi.fn(function PubSubMock() {
    return { topic };
  }),
}));

const {
  crearPublicadorDocumentoSubido,
  reconciliarDocumentosPendientes,
  MINUTOS_PENDIENTE_ANTES_DE_REPUBLICAR,
  MINUTOS_PROCESANDO_ANTES_DE_LIBERAR,
} = await import('./reconciliar-documentos-pendientes.js');

const noop = (): void => undefined;
function makeLogger() {
  return {
    trace: noop,
    debug: noop,
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: noop,
    child: () => makeLogger(),
  };
}

const doc = (n: number) => ({
  id: `00000000-0000-4000-8000-00000000000${n}`,
  viaje_id: '11111111-1111-4111-8111-111111111111',
  file_path: `transport-documents/11111111-1111-4111-8111-111111111111/doc-${n}.pdf`,
  file_mime: 'application/pdf',
});

function makeDb(liberados: number, pendientes: ReturnType<typeof doc>[]) {
  const execute = vi
    .fn()
    .mockResolvedValueOnce({ rowCount: liberados, rows: [] })
    .mockResolvedValueOnce({ rowCount: pendientes.length, rows: pendientes });
  return { db: { execute } as never, execute };
}

describe('reconciliarDocumentosPendientes', () => {
  it('libera los procesando atascados y republica los pendientes con el shape del worker', async () => {
    const { db, execute } = makeDb(2, [doc(1), doc(2)]);
    const publicar = vi.fn().mockResolvedValue(undefined);
    const logger = makeLogger();

    const r = await reconciliarDocumentosPendientes({ db, logger: logger as never, publicar });

    expect(r).toEqual({ liberados: 2, republicados: 2, fallidosPublicacion: 0 });
    expect(execute).toHaveBeenCalledTimes(2);
    expect(publicar).toHaveBeenNthCalledWith(1, {
      documentId: doc(1).id,
      viajeId: doc(1).viaje_id,
      filePath: doc(1).file_path,
      fileMime: 'application/pdf',
    });
    expect(publicar).toHaveBeenCalledTimes(2);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ liberados: 2, republicados: 2, fallidosPublicacion: 0 }),
      expect.any(String),
    );
  });

  it('un publish que falla no corta el resto: se cuenta y se loguea con el documentId', async () => {
    const { db } = makeDb(0, [doc(1), doc(2), doc(3)]);
    const publicar = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('pubsub caído'))
      .mockResolvedValueOnce(undefined);
    const logger = makeLogger();

    const r = await reconciliarDocumentosPendientes({ db, logger: logger as never, publicar });

    expect(r).toEqual({ liberados: 0, republicados: 2, fallidosPublicacion: 1 });
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ documentId: doc(2).id }),
      expect.any(String),
    );
  });

  it('sin trabajo devuelve ceros y no publica', async () => {
    const { db } = makeDb(0, []);
    const publicar = vi.fn();

    const r = await reconciliarDocumentosPendientes({
      db,
      logger: makeLogger() as never,
      publicar,
      limite: 5,
    });

    expect(r).toEqual({ liberados: 0, republicados: 0, fallidosPublicacion: 0 });
    expect(publicar).not.toHaveBeenCalled();
  });

  it('rowCount null del driver cuenta como cero liberados', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ rowCount: null, rows: [] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const r = await reconciliarDocumentosPendientes({
      db: { execute } as never,
      logger: makeLogger() as never,
      publicar: vi.fn(),
    });
    expect(r.liberados).toBe(0);
  });

  it('umbrales: pendiente 10 min, procesando 30 min', () => {
    expect(MINUTOS_PENDIENTE_ANTES_DE_REPUBLICAR).toBe(10);
    expect(MINUTOS_PROCESANDO_ANTES_DE_LIBERAR).toBe(30);
  });
});

describe('crearPublicadorDocumentoSubido', () => {
  it('publica el JSON del mensaje en el topic indicado', async () => {
    publishMessage.mockResolvedValueOnce('msg-1');
    const publicar = crearPublicadorDocumentoSubido('document.uploaded');

    await publicar({
      documentId: doc(1).id,
      viajeId: doc(1).viaje_id,
      filePath: doc(1).file_path,
      fileMime: 'application/pdf',
    });

    expect(topic).toHaveBeenCalledWith('document.uploaded');
    const arg = publishMessage.mock.calls[0]?.[0] as { data: Buffer };
    expect(JSON.parse(arg.data.toString('utf-8'))).toEqual({
      documentId: doc(1).id,
      viajeId: doc(1).viaje_id,
      filePath: doc(1).file_path,
      fileMime: 'application/pdf',
    });
  });
});
