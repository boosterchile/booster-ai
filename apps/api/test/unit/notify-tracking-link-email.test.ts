import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  EmailMessage,
  EmailSendResult,
  EmailSender,
} from '../../src/services/notifications/email-sender.js';

beforeAll(() => {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
  process.env.GOOGLE_CLOUD_PROJECT = 'test';
});

const { notifyTrackingLinkEmailAtAssignment } = await import(
  '../../src/services/notify-tracking-link-email.js'
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

const ASSIGNMENT_ID = '00000000-0000-4000-8000-000000000c01';
const TOKEN = '550e8400-e29b-41d4-a716-446655440000';

interface Fila {
  assignmentId: string;
  publicToken: string | null;
  trackingCode: string;
  originRegion: string | null;
  destRegion: string | null;
  consigneeName: string | null;
  consigneeEmail: string | null;
  shipperEmail: string | null;
  carrierName: string | null;
  vehiclePlate: string | null;
}

const fila = (over: Partial<Fila> = {}): Fila => ({
  assignmentId: ASSIGNMENT_ID,
  publicToken: TOKEN,
  trackingCode: 'BOO-XYZ987',
  originRegion: 'XIII',
  destRegion: 'IV',
  consigneeName: 'Bodega La Serena',
  consigneeEmail: null,
  shipperEmail: 'generador@empresa.cl',
  carrierName: 'Transportes Andes',
  vehiclePlate: 'ABCD12',
  ...over,
});

/**
 * Stub de Drizzle: un select (fila del viaje) y updates de la marca. `claim`
 * decide si el UPDATE … WHERE … IS NULL RETURNING devuelve la fila (primera
 * vez) o nada (ya enviado).
 */
function makeDb(opts: { fila: Fila | null; claim?: boolean }) {
  const sets: Array<Record<string, unknown>> = [];
  const select = vi.fn(() => {
    const chain: Record<string, unknown> = {};
    chain.from = vi.fn(() => chain);
    chain.innerJoin = vi.fn(() => chain);
    chain.leftJoin = vi.fn(() => chain);
    chain.where = vi.fn(() => chain);
    chain.limit = vi.fn(async () => (opts.fila ? [opts.fila] : []));
    return chain;
  });
  const update = vi.fn(() => ({
    set: vi.fn((v: Record<string, unknown>) => {
      sets.push(v);
      return {
        where: vi.fn(() => ({
          returning: vi.fn(async () => (opts.claim === false ? [] : [{ id: ASSIGNMENT_ID }])),
          // El UPDATE que libera la marca no pide returning.
          then: (resolve: (v: unknown) => void) => resolve(undefined),
        })),
      };
    }),
  }));
  return { db: { select, update } as never, sets, update };
}

function makeSender(resultado: EmailSendResult | ((m: EmailMessage) => EmailSendResult)) {
  const enviados: EmailMessage[] = [];
  const sender: EmailSender = {
    send: vi.fn(async (m: EmailMessage) => {
      enviados.push(m);
      return typeof resultado === 'function' ? resultado(m) : resultado;
    }),
  };
  return { sender, enviados };
}

const OK: EmailSendResult = { enviado: true, id: 're_1' };
const deps = (db: never, sender: EmailSender) => ({
  db,
  logger,
  emailSender: sender,
  webAppUrl: 'https://app.boosterchile.com',
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('notifyTrackingLinkEmailAtAssignment', () => {
  it('envía al generador con el enlace, el código y la ruta', async () => {
    const { db } = makeDb({ fila: fila() });
    const { sender, enviados } = makeSender(OK);
    const r = await notifyTrackingLinkEmailAtAssignment(deps(db, sender), {
      assignmentId: ASSIGNMENT_ID,
    });
    expect(r).toMatchObject({ skipped: false, enviados: 1 });
    expect(enviados).toHaveLength(1);
    const [m] = enviados;
    expect(m?.to).toBe('generador@empresa.cl');
    expect(m?.subject).toBe('Seguimiento de tu carga BOO-XYZ987');
    expect(m?.text).toContain(`https://app.boosterchile.com/tracking/${TOKEN}`);
    expect(m?.text).toContain('Transportes Andes');
    expect(m?.text).toContain('ABCD12');
    expect(m?.html).toContain(`href="https://app.boosterchile.com/tracking/${TOKEN}"`);
  });

  it('el destinatario con otro correo también lo recibe', async () => {
    const { db } = makeDb({ fila: fila({ consigneeEmail: 'recepcion@cliente.cl' }) });
    const { sender, enviados } = makeSender(OK);
    await notifyTrackingLinkEmailAtAssignment(deps(db, sender), { assignmentId: ASSIGNMENT_ID });
    expect(enviados.map((m) => m.to)).toEqual(['generador@empresa.cl', 'recepcion@cliente.cl']);
  });

  it('mismo correo con otras mayúsculas: un solo envío', async () => {
    const { db } = makeDb({ fila: fila({ consigneeEmail: 'Generador@Empresa.CL' }) });
    const { sender, enviados } = makeSender(OK);
    await notifyTrackingLinkEmailAtAssignment(deps(db, sender), { assignmentId: ASSIGNMENT_ID });
    expect(enviados).toHaveLength(1);
  });

  it('descarta los correos sintéticos .invalid', async () => {
    const { db } = makeDb({
      fila: fila({
        shipperEmail: 'drivers+12345678@boosterchile.invalid',
        consigneeEmail: 'recepcion@cliente.cl',
      }),
    });
    const { sender, enviados } = makeSender(OK);
    await notifyTrackingLinkEmailAtAssignment(deps(db, sender), { assignmentId: ASSIGNMENT_ID });
    expect(enviados.map((m) => m.to)).toEqual(['recepcion@cliente.cl']);
  });

  it('sin ningún correo usable → skip no_email, sin tomar la marca', async () => {
    const { db, update } = makeDb({ fila: fila({ shipperEmail: '  ', consigneeEmail: null }) });
    const { sender } = makeSender(OK);
    const r = await notifyTrackingLinkEmailAtAssignment(deps(db, sender), {
      assignmentId: ASSIGNMENT_ID,
    });
    expect(r).toMatchObject({ skipped: true, reason: 'no_email' });
    expect(update).not.toHaveBeenCalled();
  });

  it('ya enviado (la marca no se toma) → already_notified, sin enviar', async () => {
    const { db } = makeDb({ fila: fila(), claim: false });
    const { sender } = makeSender(OK);
    const r = await notifyTrackingLinkEmailAtAssignment(deps(db, sender), {
      assignmentId: ASSIGNMENT_ID,
    });
    expect(r).toMatchObject({ skipped: true, reason: 'already_notified' });
    expect(sender.send).not.toHaveBeenCalled();
  });

  it('si ningún correo sale, libera la marca para un reintento', async () => {
    const { db, sets } = makeDb({ fila: fila() });
    const { sender } = makeSender({ enviado: false, motivo: 'sin_proveedor' });
    const r = await notifyTrackingLinkEmailAtAssignment(deps(db, sender), {
      assignmentId: ASSIGNMENT_ID,
    });
    expect(r).toMatchObject({ skipped: true, reason: 'send_failed' });
    expect(sets).toHaveLength(2);
    expect(sets[1]).toEqual({ trackingLinkEmailSentAt: null });
  });

  it('si sale al menos uno, la marca queda tomada', async () => {
    const { db, sets } = makeDb({ fila: fila({ consigneeEmail: 'recepcion@cliente.cl' }) });
    const { sender } = makeSender((m) =>
      m.to === 'generador@empresa.cl' ? OK : { enviado: false, motivo: 'error_proveedor' },
    );
    const r = await notifyTrackingLinkEmailAtAssignment(deps(db, sender), {
      assignmentId: ASSIGNMENT_ID,
    });
    expect(r).toMatchObject({ skipped: false, enviados: 1 });
    expect(sets).toHaveLength(1);
  });

  it('asignación inexistente o sin token → skip', async () => {
    const { sender } = makeSender(OK);
    const sinFila = makeDb({ fila: null });
    expect(
      await notifyTrackingLinkEmailAtAssignment(deps(sinFila.db, sender), {
        assignmentId: ASSIGNMENT_ID,
      }),
    ).toMatchObject({ skipped: true, reason: 'assignment_not_found' });
    const sinToken = makeDb({ fila: fila({ publicToken: null }) });
    expect(
      await notifyTrackingLinkEmailAtAssignment(deps(sinToken.db, sender), {
        assignmentId: ASSIGNMENT_ID,
      }),
    ).toMatchObject({ skipped: true, reason: 'no_token' });
    expect(sender.send).not.toHaveBeenCalled();
  });

  it('escapa el HTML de los datos del viaje', async () => {
    const { db } = makeDb({ fila: fila({ carrierName: '<script>x</script> & Cía' }) });
    const { sender, enviados } = makeSender(OK);
    await notifyTrackingLinkEmailAtAssignment(deps(db, sender), { assignmentId: ASSIGNMENT_ID });
    expect(enviados[0]?.html).toContain('&lt;script&gt;x&lt;/script&gt; &amp; Cía');
    expect(enviados[0]?.html).not.toContain('<script>');
  });
});
