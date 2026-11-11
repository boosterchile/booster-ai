import { beforeEach, describe, expect, it, vi } from 'vitest';

// El recorrido contra PostgreSQL está en
// test/integration/reemitir-certificado.integration.test.ts; aquí, las ramas.
const m = vi.hoisted(() => ({
  emitirCertificado: vi.fn(),
  obtenerVigente: vi.fn(),
  crearVersionEnTx: vi.fn(),
  siguienteVersion: vi.fn(),
  armarDatosEmision: vi.fn(),
  generarPdfBase: vi.fn(),
}));
vi.mock('@booster-ai/certificate-generator', async (original) => {
  const real = await original<typeof import('@booster-ai/certificate-generator')>();
  return {
    ArtefactoYaSubidoError: real.ArtefactoYaSubidoError,
    rutaPdfCertificado: real.rutaPdfCertificado,
    emitirCertificado: m.emitirCertificado,
    generarPdfBase: m.generarPdfBase,
  };
});
const { ArtefactoYaSubidoError } = await import('@booster-ai/certificate-generator');
vi.mock('../../src/services/certificados-versionados.js', async (original) => ({
  ...(await original<typeof import('../../src/services/certificados-versionados.js')>()),
  obtenerVigente: m.obtenerVigente,
  crearVersionEnTx: m.crearVersionEnTx,
  siguienteVersion: m.siguienteVersion,
}));
vi.mock('../../src/services/emitir-certificado-viaje.js', () => ({
  armarDatosEmision: m.armarDatosEmision,
}));

const { VersionVigenteCambioError } = await import(
  '../../src/services/certificados-versionados.js'
);
const { ReemisionConcurrenteError, reemitirCertificado, simularReemision } = await import(
  '../../src/services/reemitir-certificado.js'
);

type Filas = Record<string, unknown>[];
const consulta = (filas: Filas) => {
  const cadena: Promise<Filas> & Record<string, () => unknown> = Object.assign(
    Promise.resolve(filas),
    { from: () => cadena, where: () => cadena, limit: () => cadena },
  );
  return cadena;
};

/** SELECTs en orden: viaje, métricas. UPDATE de la guarda devuelve `corregidas`. */
/** SELECTs en orden: viaje, métricas y el solicitante del evento. */
function baseFalsa(
  viaje: Filas,
  metricas: Filas,
  corregidas: Filas = [{ tripId: 'v' }],
  solicitante: Filas = [{ id: 'po' }],
) {
  const cola = [viaje, metricas, solicitante];
  const insertados: unknown[] = [];
  const tx = {
    update: vi.fn(() => ({
      set: () => ({ where: () => ({ returning: async () => corregidas }) }),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(async (v: unknown) => {
        insertados.push(v);
      }),
    })),
  };
  const db = {
    select: vi.fn(() => consulta(cola.shift() ?? [])),
    transaction: vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
  };
  return { db: db as never, insertados };
}

const sha = (c: string) => c.repeat(64);
const VIAJE = { id: 'v', status: 'entregado' };
const METRICAS = {
  tripId: 'v',
  certificateIssuedAt: new Date('2026-11-03T06:18:23Z'),
  certificateSha256: sha('a'),
  certificadoVigenteId: 'c1',
  emissionFactorUsed: '3.25000',
  fuelConsumedLActual: '182.33',
  fuelConsumedLEstimated: '167.93',
  carbonEmissionsKgco2eActual: '590.746',
  carbonEmissionsKgco2eEstimated: '545.764',
  fuenteDistancia: null,
  motivoFallback: null,
  decisionVersion: null,
};
const EMITIDO_V1 = new Date('2026-11-03T06:18:23Z');
const VIGENTE = { id: 'c1', version: 1, sha256: sha('a'), emitidoEn: EMITIDO_V1 };
const CONFIG = { kmsKeyId: 'k', certificatesBucket: 'b', verifyBaseUrl: 'https://api' };
const CORRECCION = {
  motivo: 'factor_impreso_no_corresponde',
  factorAnterior: 3.25,
  factorNuevo: 3.24,
} as const;
const noop = (): void => undefined;
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: noop } as never;

const reemitir = (db: never, overrides: Partial<Parameters<typeof reemitirCertificado>[0]> = {}) =>
  reemitirCertificado({
    db,
    logger,
    tripId: 'v',
    correccion: CORRECCION,
    solicitadoPorUserId: 'po',
    config: CONFIG,
    ...overrides,
  });

beforeEach(() => {
  vi.clearAllMocks();
  m.obtenerVigente.mockResolvedValue(VIGENTE);
  m.armarDatosEmision.mockResolvedValue({
    ok: true,
    datos: { viaje: { trackingCode: 'X' }, metricas: {} },
  });
  m.emitirCertificado.mockResolvedValue({
    pdfGcsUri: 'gs://b/x.v2.pdf',
    pdfSha256: sha('b'),
    kmsKeyVersion: '1',
    issuedAt: new Date('2026-11-12T12:00:00Z'),
  });
  m.crearVersionEnTx.mockResolvedValue({ id: 'c2', version: 2 });
  m.siguienteVersion.mockResolvedValue(2);
});

describe('reemitirCertificado — precondiciones', () => {
  it('sin configuración de firma no hace nada', async () => {
    const { db } = baseFalsa([VIAJE], [METRICAS]);
    expect(await reemitir(db, { config: {} })).toEqual({ ok: false, code: 'config_missing' });
  });

  it('viaje inexistente', async () => {
    const { db } = baseFalsa([], [METRICAS]);
    expect(await reemitir(db)).toMatchObject({ code: 'trip_not_found' });
  });

  it('viaje no entregado', async () => {
    const { db } = baseFalsa([{ ...VIAJE, status: 'asignado' }], [METRICAS]);
    expect(await reemitir(db)).toMatchObject({ code: 'trip_not_delivered' });
  });

  it.each([
    ['sin métricas', []],
    ['sin emitir', [{ ...METRICAS, certificateIssuedAt: null }]],
    ['sin huella', [{ ...METRICAS, certificateSha256: null }]],
  ])('certificado no emitido: %s', async (_n, metricas) => {
    const { db } = baseFalsa([VIAJE], metricas);
    expect(await reemitir(db)).toMatchObject({ code: 'certificate_not_issued' });
  });

  it('sin versión vigente', async () => {
    m.obtenerVigente.mockResolvedValueOnce(null);
    const { db } = baseFalsa([VIAJE], [METRICAS]);
    expect(await reemitir(db)).toMatchObject({ code: 'sin_version_vigente' });
  });

  it.each([
    ['otra versión apuntada', { certificadoVigenteId: 'otra' }],
    ['otra huella', { certificateSha256: sha('z') }],
  ])('vigente inconsistente: %s', async (_n, cambio) => {
    const { db } = baseFalsa([VIAJE], [{ ...METRICAS, ...cambio }]);
    expect(await reemitir(db)).toMatchObject({ code: 'vigente_inconsistente' });
  });

  it.each([
    ['factor guardado distinto', { emissionFactorUsed: '3.24000' }, CORRECCION],
    ['factor guardado nulo', { emissionFactorUsed: null }, CORRECCION],
    ['factor nuevo igual al anterior', {}, { ...CORRECCION, factorNuevo: 3.25 }],
  ])('corrección que no corresponde: %s', async (_n, cambio, correccion) => {
    const { db } = baseFalsa([VIAJE], [{ ...METRICAS, ...cambio }]);
    expect(await reemitir(db, { correccion })).toMatchObject({
      code: 'correccion_no_corresponde',
    });
    expect(m.emitirCertificado).not.toHaveBeenCalled();
  });

  it('sin litros o sin emisiones no se puede comprobar el factor', async () => {
    const { db } = baseFalsa(
      [VIAJE],
      [{ ...METRICAS, fuelConsumedLActual: null, fuelConsumedLEstimated: null }],
    );
    expect(await reemitir(db)).toMatchObject({ code: 'datos_insuficientes' });
  });

  it('usa los valores estimados cuando no hay reales', async () => {
    // 167,93 L × 3,25 = 545,7725 ≈ 545,764 no; con 3,24 = 544,09 no: no explica.
    const { db } = baseFalsa(
      [VIAJE],
      [{ ...METRICAS, fuelConsumedLActual: null, carbonEmissionsKgco2eActual: null }],
    );
    expect(await reemitir(db)).toMatchObject({ code: 'correccion_no_explica_cifra' });
  });

  it('factor nuevo que no explica la cifra', async () => {
    const { db } = baseFalsa([VIAJE], [METRICAS]);
    expect(await reemitir(db, { correccion: { ...CORRECCION, factorNuevo: 3.3 } })).toMatchObject({
      code: 'correccion_no_explica_cifra',
    });
  });

  it('sin generador de carga no se puede armar el PDF', async () => {
    m.armarDatosEmision.mockResolvedValueOnce({ ok: false, reason: 'no_shipper' });
    const { db } = baseFalsa([VIAJE], [METRICAS]);
    expect(await reemitir(db)).toMatchObject({ code: 'no_shipper' });
    expect(m.emitirCertificado).not.toHaveBeenCalled();
  });
});

describe('reemitirCertificado — reemisión', () => {
  it('genera con el factor corregido, en la versión siguiente, y registra la versión y el evento', async () => {
    const { db, insertados } = baseFalsa([VIAJE], [METRICAS]);
    const r = await reemitir(db);

    expect(r).toEqual({
      ok: true,
      version: 2,
      certificadoId: 'c2',
      sha256Anterior: sha('a'),
      sha256Nuevo: sha('b'),
      pdfUri: 'gs://b/x.v2.pdf',
    });
    expect(m.armarDatosEmision.mock.calls[0]?.[0].metrics.emissionFactorUsed).toBe('3.24000');
    expect(m.emitirCertificado).toHaveBeenCalledWith(
      expect.objectContaining({
        version: 2,
        viaje: {
          trackingCode: 'X',
          version: {
            numero: 2,
            reemplazaA: 1,
            reemplazaEmitidoEn: EMITIDO_V1,
            motivo: 'factor_impreso_no_corresponde',
          },
        },
      }),
    );
    expect(m.crearVersionEnTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sha256: sha('b'), pdfUrl: 'gs://b/x.v2.pdf' }),
      'factor_impreso_no_corresponde',
      'c1',
    );
    expect(insertados[0]).toMatchObject({
      eventType: 'certificado_reemitido',
      recordedByUserId: 'po',
      payload: { version_anterior: 1, version_nueva: 2 },
    });
  });

  it('si las métricas cambiaron antes de la transacción, falla como concurrente', async () => {
    const { db } = baseFalsa([VIAJE], [METRICAS], []);
    await expect(reemitir(db)).rejects.toBeInstanceOf(ReemisionConcurrenteError);
    expect(m.crearVersionEnTx).not.toHaveBeenCalled();
  });

  it('si la versión vigente cambió, falla como concurrente', async () => {
    m.crearVersionEnTx.mockRejectedValueOnce(new VersionVigenteCambioError('cambió'));
    const { db } = baseFalsa([VIAJE], [METRICAS]);
    await expect(reemitir(db)).rejects.toBeInstanceOf(ReemisionConcurrenteError);
  });

  it('pide la versión siguiente a la mayor registrada, no a la vigente', async () => {
    m.siguienteVersion.mockResolvedValueOnce(3);
    m.crearVersionEnTx.mockResolvedValueOnce({ id: 'c3', version: 3 });
    const { db } = baseFalsa([VIAJE], [METRICAS]);
    await expect(reemitir(db)).resolves.toMatchObject({ ok: true, version: 3 });
    expect(m.emitirCertificado.mock.calls[0]?.[0]).toMatchObject({ version: 3 });
  });

  it('si la versión registrada no es la del PDF subido, deshace todo', async () => {
    m.crearVersionEnTx.mockResolvedValueOnce({ id: 'c3', version: 3 });
    const { db, insertados } = baseFalsa([VIAJE], [METRICAS]);
    await expect(reemitir(db)).rejects.toBeInstanceOf(ReemisionConcurrenteError);
    expect(insertados).toHaveLength(0);
  });

  it('si el PDF de esa versión ya estaba subido, falla como concurrente sin abrir la transacción', async () => {
    m.emitirCertificado.mockRejectedValueOnce(
      new ArtefactoYaSubidoError('certificates/e/X.v2.pdf'),
    );
    const { db } = baseFalsa([VIAJE], [METRICAS]);
    await expect(reemitir(db)).rejects.toBeInstanceOf(ReemisionConcurrenteError);
    expect(
      (db as unknown as { transaction: ReturnType<typeof vi.fn> }).transaction,
    ).not.toHaveBeenCalled();
  });

  it('otros errores de la transacción se propagan tal cual', async () => {
    m.crearVersionEnTx.mockRejectedValueOnce(new Error('otra cosa'));
    const { db } = baseFalsa([VIAJE], [METRICAS]);
    await expect(reemitir(db)).rejects.toThrow('otra cosa');
  });

  it('si firmar o subir falla, no abre la transacción', async () => {
    m.emitirCertificado.mockRejectedValueOnce(new Error('KMS'));
    const { db } = baseFalsa([VIAJE], [METRICAS]);
    await expect(reemitir(db)).rejects.toThrow('KMS');
    expect(
      (db as unknown as { transaction: ReturnType<typeof vi.fn> }).transaction,
    ).not.toHaveBeenCalled();
  });
});

describe('reemitirCertificado — solicitante', () => {
  it('si el solicitante no existe, no firma ni sube', async () => {
    const { db } = baseFalsa([VIAJE], [METRICAS], [{ tripId: 'v' }], []);
    await expect(reemitir(db)).resolves.toMatchObject({
      ok: false,
      code: 'solicitante_no_existe',
    });
    expect(m.emitirCertificado).not.toHaveBeenCalled();
  });

  it('sin solicitante no lo busca', async () => {
    const { db } = baseFalsa([VIAJE], [METRICAS]);
    await expect(reemitir(db, { solicitadoPorUserId: null })).resolves.toMatchObject({ ok: true });
    expect((db as unknown as { select: ReturnType<typeof vi.fn> }).select).toHaveBeenCalledTimes(2);
  });
});

describe('simularReemision — en seco', () => {
  const simular = (db: never) =>
    simularReemision({
      db,
      logger,
      tripId: 'v',
      correccion: CORRECCION,
      solicitadoPorUserId: 'po',
      verifyBaseUrl: 'https://api/',
    });

  beforeEach(() => {
    m.armarDatosEmision.mockResolvedValue({
      ok: true,
      datos: {
        viaje: { trackingCode: 'BOO-X' },
        metricas: {},
        empresaShipper: { id: 'e', legalName: 'E', rut: null },
      },
    });
    m.generarPdfBase.mockResolvedValue(new Uint8Array(1500));
  });

  it('informa la reemisión que haría y genera el PDF en memoria, sin firmar ni escribir', async () => {
    const { db } = baseFalsa([{ ...VIAJE, trackingCode: 'BOO-X' }], [METRICAS]);
    const r = await simular(db);

    expect(r).toEqual({
      ok: true,
      tripId: 'v',
      versionVigente: 1,
      versionNueva: 2,
      sha256Vigente: sha('a'),
      rutaPdf: 'certificates/e/BOO-X.v2.pdf',
      factorAnterior: 3.25,
      factorNuevo: 3.24,
      litros: 182.33,
      emisionesKg: 590.746,
      pdfBytes: 1500,
    });
    const pdf = m.generarPdfBase.mock.calls[0]?.[0];
    expect(pdf.verifyUrl).toBe('https://api/certificates/BOO-X/verify');
    expect(pdf.viaje.version).toMatchObject({ numero: 2, reemplazaA: 1 });
    expect(pdf).not.toHaveProperty('transportista');
    expect(m.emitirCertificado).not.toHaveBeenCalled();
    expect(
      (db as unknown as { transaction: ReturnType<typeof vi.fn> }).transaction,
    ).not.toHaveBeenCalled();
  });

  it('pasa el transportista al PDF cuando lo hay', async () => {
    m.armarDatosEmision.mockResolvedValueOnce({
      ok: true,
      datos: {
        viaje: { trackingCode: 'BOO-X' },
        metricas: {},
        empresaShipper: { id: 'e', legalName: 'E', rut: null },
        transportista: { legalName: 'T', rut: null, vehiclePlate: null },
      },
    });
    const { db } = baseFalsa([{ ...VIAJE, trackingCode: 'BOO-X' }], [METRICAS]);
    await simular(db);
    expect(m.generarPdfBase.mock.calls[0]?.[0].transportista).toEqual({
      legalName: 'T',
      rut: null,
      vehiclePlate: null,
    });
  });

  it('una corrección que no cuadra se informa sin generar el PDF', async () => {
    const { db } = baseFalsa([VIAJE], [{ ...METRICAS, emissionFactorUsed: '3.30000' }]);
    await expect(simular(db)).resolves.toMatchObject({
      ok: false,
      code: 'correccion_no_corresponde',
    });
    expect(m.generarPdfBase).not.toHaveBeenCalled();
  });
});
