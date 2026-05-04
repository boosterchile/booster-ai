import { describe, expect, it } from 'vitest';
import { generarPdfCartaPorte } from './generar-pdf.js';
import type { CartaPorteInput } from './tipos.js';

const VALID_INPUT: CartaPorteInput = {
  folio: 'cp-trip-001',
  emittedAt: '2026-05-04T10:00:00.000Z',
  porteador: {
    nombre: 'Transportes ACME SpA',
    rut: '76543210-3',
    direccion: 'Av. Las Industrias 100',
    comuna: 'Quilicura',
    region: 'XIII',
    email: 'contacto@acme.cl',
    telefono: '+56222223333',
  },
  cargador: {
    nombre: 'Distribuidora Norte Ltda',
    rut: '11111111-1',
    direccion: 'Camino Principal 200',
    comuna: 'Antofagasta',
    region: 'II',
  },
  consignatario: {
    nombre: 'Bodega Central S.A.',
    rut: '11111111-1',
    direccion: 'Calle Comercio 300',
    comuna: 'Santiago',
    region: 'XIII',
  },
  origen: {
    direccion: 'Camino Principal 200',
    comuna: 'Antofagasta',
    region: 'II',
  },
  destino: {
    direccion: 'Calle Comercio 300',
    comuna: 'Santiago',
    region: 'XIII',
  },
  carga: {
    naturaleza: 'Materiales eléctricos',
    cantidad: 50,
    unidad: 'cajas',
    pesoKg: 1200,
    volumenM3: 8,
    embalaje: 'Pallet de madera',
    observaciones: 'Manipular con cuidado',
  },
  vehiculo: {
    patente: 'AB1234',
    tipo: 'Camión mediano',
    anioModelo: 2024,
    color: 'Blanco',
  },
  conductor: {
    nombre: 'Juan Pérez González',
    rut: '11111111-1',
    licenciaNumero: 'A-12345',
    licenciaClase: 'A4',
  },
  precioFleteClp: 850000,
  verifyUrl: 'https://api.boosterchile.com/cartas-porte/cp-trip-001/verify',
};

/**
 * El PDF generado tiene un placeholder PAdES embebido — pdf-lib NO puede
 * re-parsearlo (xref roto a propósito por @signpdf/placeholder-plain).
 * Los tests inspeccionan los bytes raw para verificar contenido.
 */
describe('generarPdfCartaPorte', () => {
  it('produce un PDF con header válido', async () => {
    const bytes = await generarPdfCartaPorte(VALID_INPUT);
    expect(bytes.byteLength).toBeGreaterThan(2000);
    const header = new TextDecoder('latin1').decode(bytes.slice(0, 8));
    expect(header).toMatch(/^%PDF-/);
  });

  it('embebe placeholder PAdES con ETSI.CAdES.detached', async () => {
    const bytes = await generarPdfCartaPorte(VALID_INPUT);
    const text = new TextDecoder('latin1').decode(bytes);
    expect(text).toContain('/Type /Sig');
    expect(text).toContain('/SubFilter /ETSI.CAdES.detached');
    expect(text).toContain('/ByteRange');
  });

  it('omite campos opcionales sin fallar', async () => {
    const minimal: CartaPorteInput = {
      ...VALID_INPUT,
      vehiculo: { patente: 'XY9876', tipo: 'Furgón' },
      carga: {
        naturaleza: 'Carga seca',
        cantidad: 10,
        unidad: 'unidades',
        pesoKg: 100,
        embalaje: 'Caja',
      },
      precioFleteClp: undefined,
      verifyUrl: undefined,
    };
    const bytes = await generarPdfCartaPorte(minimal);
    expect(bytes.byteLength).toBeGreaterThan(2000);
    const header = new TextDecoder('latin1').decode(bytes.slice(0, 8));
    expect(header).toMatch(/^%PDF-/);
  });
});
