/**
 * HC-004 T2 (ux.md, criterios 1–10): lee el TEXTO real del PDF con pdfjs.
 */
import { describe, expect, it } from 'vitest';
import { generarPdfBase } from '../src/generar-pdf-base.js';
import type { DatosMetricasCertificado, DatosViajeCertificado } from '../src/tipos.js';
import { plano, textoPorPagina } from './texto-pdf.js';

const viaje: DatosViajeCertificado = {
  trackingCode: 'BOO-TEST01',
  origenDireccion: 'Av. Apoquindo 5400, Las Condes',
  origenRegionCode: 'XIII',
  destinoDireccion: 'Calle 1 Norte 123, Concepción',
  destinoRegionCode: 'VIII',
  cargoTipo: 'carga_seca',
  cargoPesoKg: 12000,
  pickupAt: new Date('2026-05-01T10:00:00Z'),
  deliveredAt: null,
};

const base: DatosMetricasCertificado = {
  distanciaKmEstimated: 468.76,
  distanciaKmActual: 468.76,
  kgco2eWtwEstimated: 429.246,
  kgco2eWtwActual: null,
  kgco2eTtw: 353.73,
  kgco2eWtt: 75.515,
  combustibleConsumido: 132.48,
  combustibleUnidad: 'L',
  intensidadGco2ePorTonKm: 183.14,
  precisionMethod: 'modelado',
  glecVersion: 'v3.0',
  emissionFactorUsado: 3.24,
  fuenteFactores: 'GLEC v2.0 (2019), Tabla 32',
  calculatedAt: new Date('2026-11-02T19:00:00Z'),
  routeDataSource: 'teltonika_gps',
  coveragePct: 60.9,
  certificationLevel: 'secundario_modeled',
  uncertaintyFactor: 0.05,
};

const primario: DatosMetricasCertificado = {
  ...base,
  precisionMethod: 'exacto_canbus',
  coveragePct: 98.7,
  certificationLevel: 'primario_verificable',
  kgco2eWtwActual: 699.84,
};

const emp = {
  id: '00000000-0000-4000-8000-000000000001',
  legalName: 'Logística del Sur SpA',
  rut: '76.123.456-K',
};

async function texto(metricas: DatosMetricasCertificado, v: DatosViajeCertificado = viaje) {
  const bytes = await generarPdfBase({
    viaje: v,
    metricas,
    empresaShipper: emp,
    verifyUrl: 'https://x/verify',
  });
  const paginas = await textoPorPagina(bytes);
  return { paginas, todo: plano(paginas.join(' ')) };
}

/** El sello lleva tracking: pdfjs puede devolver «E S T I M A D O». */
const SELLO = /E ?S ?T ?I ?M ?A ?D ?O/;
const ISO = 'Estos resultados han sido establecidos de acuerdo con ISO 14083:2023.';

describe('plantilla v2 — estimado (criterios 2, 3, 5, 6, 9)', () => {
  it('título único, las tres señales, pie Estimado y versión reemplazada', async () => {
    const { paginas, todo } = await texto(base, {
      ...viaje,
      version: { numero: 2, reemplazaA: 1 },
    });
    expect(todo).toContain('Certificado de huella de carbono');
    expect(todo.toLowerCase()).not.toContain('reporte estimativo');
    expect(todo).toMatch(SELLO);
    expect(todo).toContain('Estimado · datos secundarios modelados · 60% telemetría');
    expect(todo).toContain('IMPORTANTE — DATOS SECUNDARIOS MODELADOS');
    expect(todo).toContain(
      'Cálculo basado en datos secundarios modelados (Google Routes API + factores GLEC v2.0 (2019), Tabla 32 + GLEC Framework v3.0).',
    );
    expect(todo).toContain('NO auditable como dato primario bajo SBTi, CDP o CSRD assurance.');
    expect(todo).toContain('Versión 2 · reemplaza a v1');
    for (const [i, p] of paginas.entries()) {
      expect(plano(p)).toContain('BOO-TEST01 · v2 · Estimado');
      expect(plano(p)).toContain(`Página ${i + 1} de ${paginas.length}`);
    }
    expect(todo).toContain(
      'GLEC Framework v3.0 · ISO 14083:2023 · Well-to-Wheel (combustión + upstream)',
    );
    expect(todo.split(ISO).length - 1).toBeGreaterThanOrEqual(2);
    expect(todo).toContain('kg CO\u2082e');
    expect(todo).toContain('429,25');
    expect(todo).toContain('(± 21,46 kg)');
  });

  it('el disclaimer va en la página 1 (junto al número)', async () => {
    const { paginas } = await texto(base);
    expect(plano(paginas[0] ?? '')).toContain('IMPORTANTE — DATOS SECUNDARIOS MODELADOS');
  });

  it('sin nivel guardado (legacy) también es Estimado: solo el primario explícito es primario', async () => {
    const { certificationLevel: _n, ...legacy } = base;
    const { todo } = await texto(legacy);
    expect(todo).toMatch(SELLO);
  });
});

describe('plantilla v2 — primario (criterios 3, 5, 8, 10)', () => {
  it('badge ✓ con % piso y sin ninguna señal de Estimado', async () => {
    const { todo } = await texto(primario);
    expect(todo).toContain('\u2713 Dato primario medido · 98% telemetría');
    expect(todo).not.toMatch(SELLO);
    expect(todo).not.toContain('IMPORTANTE');
    expect(todo).not.toContain('Estimado');
    expect(todo).toContain('BOO-TEST01 · v1');
    expect(todo).toContain('Versión 1');
    expect(todo).toContain('Certificado de huella de carbono');
  });

  it('fechas null → «—» (no cae a la ventana de retiro)', async () => {
    const { todo } = await texto(primario);
    expect(todo).toMatch(/Fecha del viaje\s*—/);
    expect(todo).toMatch(/Salida · Llegada\s*—/);
  });
});

describe('PR-B — factores, referencia HuellaChile y versión (criterios 7, 11, 12, 14, 15)', () => {
  const conFactores: DatosMetricasCertificado = {
    ...base,
    fuenteFactores:
      'GLEC Framework v2.0 (2019), ISBN 978-90-82-68790-3, Módulo 1, Tabla 32 (EU), p. 87',
    factoresLinea: { etiqueta: 'GLEC v2.0 (2019), Tabla 32', ttw: 2.67, wtt: 0.57, wtw: 3.24 },
    referencia: { ttw: 2.74, wtt: 0.624, fuente: 'HuellaChile 2025, MMA' },
  };

  it('etiquetas fijas y valores de la emisión', async () => {
    const { todo } = await texto(conFactores);
    expect(todo).toMatch(/Metodología GLEC\s+v3\.0/);
    expect(todo).toContain(
      'Factores: WTW 3,24 kg CO\u2082e/L · TTW 2,67 kg CO\u2082e/L · WTT 0,57 kg CO\u2082e/L',
    );
    expect(todo).toContain('Fuente de factores: GLEC v2.0 (2019), Tabla 32');
    expect(todo).toContain('factores GLEC v2.0 (2019), Tabla 32 + GLEC Framework v3.0');
    // criterio 14: kg_ref = 132,48 L × (2,740 + 0,624) = 445,66
    expect(todo).toContain('Referencia HuellaChile 2025: 445,66 kg CO\u2082e WTW');
    expect(todo).toContain(
      'Calculado con los mismos 132,48 L y los factores MMA 2025 (TTW 2,740 + WTT 0,624 kg CO\u2082e/L). Solo referencia: el resultado de este certificado es el de arriba.',
    );
  });

  it('otros factores o versión guardados → el PDF los imprime (nada fijo)', async () => {
    const { todo } = await texto({
      ...conFactores,
      glecVersion: 'v3.1',
      factoresLinea: { etiqueta: 'Otra tabla', ttw: 2.5, wtt: 0.5, wtw: 3 },
      referencia: { ttw: 2.8, wtt: 0.7, fuente: 'HuellaChile 2025, MMA' },
    });
    expect(todo).toContain(
      'Factores: WTW 3,00 kg CO\u2082e/L · TTW 2,50 kg CO\u2082e/L · WTT 0,50 kg CO\u2082e/L',
    );
    expect(todo).toContain('GLEC Framework v3.1 · ISO 14083:2023');
    expect(todo).toContain('TTW 2,800 + WTT 0,700');
    expect(todo).toContain('463,68'); // 132,48 × 3,5
    // Subtítulo y disclaimer usan la versión de la emisión (la línea de método ADR-077 es aparte).
    expect(todo).toContain('GLEC Framework v3.1).');
    expect(todo).not.toContain('GLEC Framework v3.0');
  });

  it('criterios 12 y 15: sin SEC Chile ni «certificado/verificado HuellaChile»', async () => {
    const { todo } = await texto({ ...conFactores, fuenteFactores: null, factoresLinea: null });
    expect(todo).not.toContain('SEC Chile');
    expect(todo.toLowerCase()).not.toMatch(/(certificado|verificado) huellachile/);
    expect(todo).toContain('(Google Routes API + GLEC Framework v3.0)');
  });

  it('sin fila de factores no hay línea de factores; sin litros no hay referencia', async () => {
    const { todo } = await texto({
      ...conFactores,
      factoresLinea: null,
      combustibleConsumido: null,
    });
    expect(todo).not.toContain('Factores:');
    expect(todo).not.toContain('Referencia HuellaChile');
  });
});

describe('HC-004: ningún «v3.0» fijo en el PDF (sin backhaul)', () => {
  it('con otra versión guardada, el PDF no contiene v3.0 en ninguna parte', async () => {
    const { todo } = await texto({ ...base, glecVersion: 'v9.9' });
    expect(todo).toContain('Consumo modelado según GLEC v9.9');
    expect(todo).not.toContain('v3.0');
  });
});
