/**
 * huella-consolidada parte 5 (ADR-089, spec §3.10 y criterio 7): el
 * certificado de una carga que viajó con otras dice que viajó consolidada, el
 * método de reparto y su versión, la participación de la carga y la huella
 * total de la ruta. No identifica a los otros generadores ni dice cuántos son.
 */
import { describe, expect, it } from 'vitest';
import { generarPdfBase } from '../src/generar-pdf-base.js';
import type { DatosMetricasCertificado, DatosViajeCertificado } from '../src/tipos.js';
import { suitePdf } from './pdf-suite.js';
import { itemsPorPagina, plano, textoPorPagina } from './texto-pdf.js';

suitePdf();

const viaje: DatosViajeCertificado = {
  trackingCode: 'BOO-CONS01',
  origenDireccion: 'Av. Apoquindo 5400, Las Condes',
  origenRegionCode: 'XIII',
  destinoDireccion: 'Calle 1 Norte 123, Viña del Mar',
  destinoRegionCode: 'V',
  cargoTipo: 'carga_seca',
  cargoPesoKg: 2000,
  pickupAt: null,
  deliveredAt: null,
};

/** La parte de una carga: 62,5 % de una ruta de 80,000 kg CO₂e. */
const sola: DatosMetricasCertificado = {
  distanciaKmEstimated: 120,
  distanciaKmActual: null,
  kgco2eWtwEstimated: 48.2,
  kgco2eWtwActual: 50,
  kgco2eTtw: 40.5,
  kgco2eWtt: 9.5,
  combustibleConsumido: 15.43,
  combustibleUnidad: 'L',
  intensidadGco2ePorTonKm: 208.33,
  precisionMethod: 'modelado',
  glecVersion: 'v3.0',
  emissionFactorUsado: 3.24,
  fuenteFactores: 'SEC Chile 2024 + GLEC v3.0',
  calculatedAt: new Date('2026-11-11T15:00:00Z'),
  routeDataSource: 'teltonika_gps',
  coveragePct: 96.4,
  certificationLevel: 'secundario_modeled',
  uncertaintyFactor: 0.05,
};
const CONSOLIDACION = {
  participacionPct: 62.5,
  kgco2eWtwRuta: 80,
  versionMetodo: 'tkm-distancia-directa-v1',
} as const;
const consolidada: DatosMetricasCertificado = { ...sola, consolidacion: CONSOLIDACION };

const emp = { id: 'e', legalName: 'Logística del Sur SpA', rut: '76.123.456-K' };

async function texto(metricas: DatosMetricasCertificado) {
  const pdf = await generarPdfBase({
    viaje,
    metricas,
    empresaShipper: emp,
    transportista: {
      legalName: 'Transportes Andes Ltda.',
      rut: '77.111.222-3',
      vehiclePlate: 'ABCD12',
    },
    verifyUrl: 'https://x/verify',
  });
  return plano((await textoPorPagina(pdf)).join(' '));
}

describe('certificado de una carga consolidada', () => {
  it('dice que viajó consolidada, el método, su versión, la participación y el total de la ruta', async () => {
    const todo = await texto(consolidada);
    expect(todo).toContain('Carga consolidada');
    expect(todo).toContain('Esta carga viajó con otras cargas en la misma ruta');
    expect(todo).toMatch(/Método de reparto\s+.*Toneladas-kilómetro, distancia directa/);
    expect(todo).toContain('tkm-distancia-directa-v1');
    expect(todo).toMatch(/Participación de esta carga\s+.*62,50 %/);
    expect(todo).toMatch(/Huella total de la ruta\s+.*80,00 kg CO₂e/);
  });

  it('la sección no se parte entre dos páginas', async () => {
    const pdf = await generarPdfBase({
      viaje,
      metricas: consolidada,
      empresaShipper: emp,
      verifyUrl: 'https://x/verify',
    });
    const items = await itemsPorPagina(pdf);
    const pagina = (inicio: string) => items.find((i) => i.str.startsWith(inicio))?.pagina;
    const titulo = pagina('Carga consolidada');
    expect(titulo).toBeDefined();
    expect(pagina('Esta carga viajó')).toBe(titulo);
    expect(pagina('Método de reparto')).toBe(titulo);
    expect(pagina('Huella total de la ruta')).toBe(titulo);
  });

  it('la cifra principal sigue siendo la parte de la carga, no el total de la ruta', async () => {
    const todo = await texto(consolidada);
    expect(todo).toMatch(/Emisiones totales WTW\s+50,00/);
  });

  it('la distancia que publica es la directa, y no se presenta como medida', async () => {
    const todo = await texto(consolidada);
    expect(todo).toContain('Distancia directa: 120,0 km');
    expect(todo).not.toMatch(/Distancia: 120,0 km \(medido/);
  });

  it('con la ruta medida por Teltonika va sin sello y la nota habla de la distancia de la ruta (ADR-091)', async () => {
    const todo = await texto(consolidada);
    expect(todo).not.toMatch(/E ?S ?T ?I ?M ?A ?D ?O/);
    expect(todo).not.toContain('Estimado');
    expect(todo).toContain('Distancia medida con Teltonika · consumo modelado · 96% telemetría');
    expect(todo).toContain(
      'La distancia de la ruta fue medida por el dispositivo Teltonika instalado en el vehículo.',
    );
    expect(todo).not.toContain('La distancia fue medida');
  });

  it('con la ruta estimada por Google Maps conserva el sello', async () => {
    const todo = await texto({
      ...consolidada,
      routeDataSource: 'maps_directions',
      coveragePct: 0,
    });
    expect(todo).toMatch(/E ?S ?T ?I ?M ?A ?D ?O/);
    expect(todo).toContain('IMPORTANTE — DATOS SECUNDARIOS MODELADOS');
  });

  it('no dice cuántas cargas más había ni de quién eran', async () => {
    const todo = await texto(consolidada);
    expect(todo).not.toMatch(/\b\d+ (cargas|servicios|generadores)\b/i);
    expect(todo).not.toMatch(/otros? generador/i);
  });

  it('una carga que viajó sola no lleva nada de esto', async () => {
    const todo = await texto(sola);
    expect(todo).not.toContain('Carga consolidada');
    expect(todo).not.toContain('Participación de esta carga');
    expect(todo).not.toContain('Huella total de la ruta');
    expect(todo).not.toContain('tkm-distancia-directa');
    expect(todo).toContain('Distancia: 120,0 km');
  });

  it('con datos de consolidación incoherentes no genera el PDF', async () => {
    const con = (c: object) => texto({ ...sola, consolidacion: { ...CONSOLIDACION, ...c } });
    await expect(con({ participacionPct: 0 })).rejects.toThrow(/participación/i);
    await expect(con({ participacionPct: 100 })).rejects.toThrow(/participación/i);
    await expect(con({ participacionPct: Number.NaN })).rejects.toThrow(/participación/i);
    // La parte de la carga (50 kg) no puede ser mayor que la ruta.
    await expect(con({ kgco2eWtwRuta: 49.99 })).rejects.toThrow(/huella de la ruta/i);
    await expect(con({ versionMetodo: '' })).rejects.toThrow(/versión del método/i);
  });
});
