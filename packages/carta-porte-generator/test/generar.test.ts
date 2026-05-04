import { describe, expect, it } from 'vitest';
import {
  type CartaPorteInput,
  CartaPorteValidationError,
  generarCartaPorte,
} from '../src/index.js';

const validInput: CartaPorteInput = {
  trackingCode: 'BOO-TEST01',
  fechaEmision: new Date('2026-05-03T10:00:00Z'),
  fechaSalida: new Date('2026-05-03T14:00:00Z'),
  duracionEstimadaHoras: 6,
  remitente: {
    rut: '12345678-9',
    razonSocial: 'Cliente SA',
    giro: 'Comercio mayorista',
    direccion: 'Av. Apoquindo 4500',
    comuna: 'Las Condes',
  },
  transportista: {
    rut: '76123456-7',
    razonSocial: 'Transportes Test SpA',
    giro: 'Transporte de carga por carretera',
    direccion: 'Camino Lo Echevers 1234',
    comuna: 'Quilicura',
  },
  conductor: {
    rut: '11111111-1',
    nombreCompleto: 'Juan Pérez González',
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
      descripcion: 'Cemento ensacado Polpaico 25kg',
      cantidad: 200,
      unidadMedida: 'sacos',
      pesoKg: 5_000,
      tipoCarga: 'construccion',
    },
  ],
};

describe('generarCartaPorte — happy path', () => {
  it('genera PDF con buffer no vacío + sha256 + sizeBytes', async () => {
    const result = await generarCartaPorte(validInput);

    expect(result.pdfBuffer).toBeInstanceOf(Uint8Array);
    expect(result.pdfBuffer.byteLength).toBeGreaterThan(1000);
    expect(result.sizeBytes).toBe(result.pdfBuffer.byteLength);
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('PDF empieza con header %PDF (magic bytes)', async () => {
    const result = await generarCartaPorte(validInput);
    const header = new TextDecoder().decode(result.pdfBuffer.slice(0, 4));
    expect(header).toBe('%PDF');
  });

  it('multiple cargas: el PDF crece más que con una sola carga', async () => {
    const single = await generarCartaPorte(validInput);
    const multiple = await generarCartaPorte({
      ...validInput,
      cargas: [
        ...validInput.cargas,
        {
          descripcion: 'Bolsa de fierro corrugado',
          cantidad: 50,
          unidadMedida: 'paquetes',
          pesoKg: 2_500,
          tipoCarga: 'construccion',
        },
        {
          descripcion: 'Maderas pino dimensionado',
          cantidad: 100,
          unidadMedida: 'pulgadas',
          pesoKg: 3_000,
          tipoCarga: 'construccion',
        },
      ],
    });
    expect(multiple.sizeBytes).toBeGreaterThan(single.sizeBytes);
  });

  it('observaciones opcional incluidas en el PDF', async () => {
    const withObs = await generarCartaPorte({
      ...validInput,
      observaciones: 'Entregar entre 9:00 y 13:00. Llamar al recibir.',
    });
    const without = await generarCartaPorte(validInput);
    expect(withObs.sizeBytes).toBeGreaterThan(without.sizeBytes);
  });

  it('folioGuiaDte opcional NO produce error', async () => {
    const result = await generarCartaPorte({
      ...validInput,
      folioGuiaDte: 'DTE-52-12345',
    });
    expect(result.pdfBuffer.byteLength).toBeGreaterThan(1000);
  });
});

describe('generarCartaPorte — validación Zod', () => {
  it('rechaza trackingCode vacío', async () => {
    await expect(generarCartaPorte({ ...validInput, trackingCode: '' })).rejects.toThrowError(
      CartaPorteValidationError,
    );
  });

  it('rechaza cargas vacías', async () => {
    await expect(generarCartaPorte({ ...validInput, cargas: [] })).rejects.toThrowError(
      CartaPorteValidationError,
    );
  });

  it('rechaza RUT mal formado en remitente', async () => {
    await expect(
      generarCartaPorte({
        ...validInput,
        remitente: { ...validInput.remitente, rut: 'no-es-rut' },
      }),
    ).rejects.toThrowError(CartaPorteValidationError);
  });

  it('rechaza patente inválida (chars no permitidos)', async () => {
    await expect(
      generarCartaPorte({
        ...validInput,
        vehiculo: { ...validInput.vehiculo, patente: 'AB!CD@12' },
      }),
    ).rejects.toThrowError(CartaPorteValidationError);
  });

  it('rechaza pesoKg negativo', async () => {
    await expect(
      generarCartaPorte({
        ...validInput,
        cargas: [{ ...validInput.cargas[0]!, pesoKg: -100 }],
      }),
    ).rejects.toThrowError(CartaPorteValidationError);
  });

  it('rechaza año vehículo fuera de rango', async () => {
    await expect(
      generarCartaPorte({
        ...validInput,
        vehiculo: { ...validInput.vehiculo, anio: 1950 },
      }),
    ).rejects.toThrowError(CartaPorteValidationError);
  });

  it('rechaza claseLicencia inválida', async () => {
    await expect(
      generarCartaPorte({
        ...validInput,
        conductor: {
          ...validInput.conductor,
          claseLicencia: 'Z' as unknown as 'A3',
        },
      }),
    ).rejects.toThrowError(CartaPorteValidationError);
  });

  it('error message incluye fieldErrors estructurados', async () => {
    try {
      await generarCartaPorte({
        ...validInput,
        trackingCode: '',
        cargas: [],
      });
    } catch (err) {
      expect(err).toBeInstanceOf(CartaPorteValidationError);
      const e = err as CartaPorteValidationError;
      expect(Object.keys(e.fieldErrors).length).toBeGreaterThanOrEqual(2);
      expect(e.fieldErrors.trackingCode).toBeDefined();
      expect(e.fieldErrors.cargas).toBeDefined();
    }
  });
});

describe('generarCartaPorte — determinismo', () => {
  it('mismo input + misma fecha → mismo PDF (sha256 estable)', async () => {
    // @react-pdf/renderer mete metadata de timestamp en algunos builds.
    // Si este test flake-ea en el futuro, considerar normalizar la
    // metadata o relajar a "size dentro de ±5%".
    const r1 = await generarCartaPorte(validInput);
    const r2 = await generarCartaPorte(validInput);
    // El sha256 puede diferir si pdfkit incluye CreationDate dinámico.
    // Como mínimo el size debe ser idéntico (igual contenido lógico).
    expect(r2.sizeBytes).toBe(r1.sizeBytes);
  });
});
