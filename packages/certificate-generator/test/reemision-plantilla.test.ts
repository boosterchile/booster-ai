/**
 * Reemisión, parte 4 (`.specs/reemision-certificado/` §8-2 y criterio 5): un
 * certificado de versión mayor que 1 dice, en una línea, a qué versión
 * reemplaza, de qué fecha es esa versión y por qué se reemitió.
 */
import { describe, expect, it } from 'vitest';
import { generarPdfBase } from '../src/generar-pdf-base.js';
import { MOTIVOS_REEMISION, TEXTO_MOTIVO_REEMISION } from '../src/index.js';
import type { DatosMetricasCertificado, DatosViajeCertificado } from '../src/tipos.js';
import { suitePdf } from './pdf-suite.js';
import { itemsPorPagina, plano, textoPorPagina } from './texto-pdf.js';

suitePdf();

const viaje: DatosViajeCertificado = {
  trackingCode: 'BOO-REEM01',
  origenDireccion: 'Av. Apoquindo 5400, Las Condes',
  origenRegionCode: 'XIII',
  destinoDireccion: 'Calle 1 Norte 123, Concepción',
  destinoRegionCode: 'VIII',
  cargoTipo: 'carga_seca',
  cargoPesoKg: 12000,
  pickupAt: null,
  deliveredAt: null,
};

/** Las cifras del certificado afectado (hallazgo del 2026-11-11), con el factor corregido. */
const corregido: DatosMetricasCertificado = {
  distanciaKmEstimated: 512.4,
  distanciaKmActual: 512.4,
  kgco2eWtwEstimated: 545.764,
  kgco2eWtwActual: 590.746,
  kgco2eTtw: null,
  kgco2eWtt: null,
  combustibleConsumido: 182.33,
  combustibleUnidad: 'L',
  intensidadGco2ePorTonKm: null,
  precisionMethod: 'modelado',
  glecVersion: 'v3.0',
  emissionFactorUsado: 3.24,
  fuenteFactores: 'SEC Chile 2024 + GLEC v3.0',
  calculatedAt: new Date('2026-11-03T06:00:00Z'),
  certificationLevel: 'secundario_modeled',
};

const emp = { id: 'e', legalName: 'Logística del Sur SpA', rut: '76.123.456-K' };

const REEMPLAZO = {
  numero: 2,
  reemplazaA: 1,
  // 03:18 en Santiago: la fecha impresa es la de Chile, no la de UTC.
  reemplazaEmitidoEn: new Date('2026-11-03T06:18:23Z'),
  motivo: 'factor_impreso_no_corresponde',
} as const;

const LINEA =
  'Reemplaza a la versión 1, emitida el 03-11-2026. Motivo: el factor de emisión impreso no era el usado en el cálculo.';

async function pdf(v: DatosViajeCertificado, metricas = corregido) {
  return generarPdfBase({ viaje: v, metricas, empresaShipper: emp, verifyUrl: 'https://x/verify' });
}

async function texto(v: DatosViajeCertificado, metricas = corregido) {
  const paginas = await textoPorPagina(await pdf(v, metricas));
  return plano(paginas.join(' '));
}

describe('certificado reemitido — la línea de reemplazo', () => {
  it('dice versión anterior, su fecha en hora de Chile y el motivo', async () => {
    const todo = await texto({ ...viaje, version: REEMPLAZO });
    expect(todo).toContain(LINEA);
    expect(todo).toContain('Versión 2 · reemplaza a v1');
  });

  it('va en una sola línea, en la página 1', async () => {
    const items = await itemsPorPagina(await pdf({ ...viaje, version: REEMPLAZO }));
    const linea = items.filter((i) => i.str.startsWith('Reemplaza a la versión'));
    expect(linea).toHaveLength(1);
    expect(linea[0]?.str).toBe(LINEA);
    expect(linea[0]?.pagina).toBe(0);
  });

  it('una versión 3 que reemplaza a la 1 (tras revertir la 2) nombra a la 1', async () => {
    const todo = await texto({ ...viaje, version: { ...REEMPLAZO, numero: 3 } });
    expect(todo).toContain('Versión 3 · reemplaza a v1');
    expect(todo).toContain('Reemplaza a la versión 1, emitida el 03-11-2026.');
  });

  it('la versión 1 no lleva línea de reemplazo', async () => {
    for (const v of [viaje, { ...viaje, version: { numero: 1 } as const }]) {
      const todo = await texto(v);
      expect(todo).not.toContain('Reemplaza a la versión');
      expect(todo).not.toContain('Motivo:');
    }
  });

  it('una versión mayor que 1 sin los datos del reemplazo no se genera', async () => {
    await expect(pdf({ ...viaje, version: { numero: 2 } } as never)).rejects.toThrow(
      /versión 2.*reemplaz/i,
    );
    await expect(
      pdf({ ...viaje, version: { ...REEMPLAZO, motivo: 'otro' } } as never),
    ).rejects.toThrow(/motivo/i);
    await expect(
      pdf({ ...viaje, version: { ...REEMPLAZO, reemplazaA: 2 } } as never),
    ).rejects.toThrow(/reemplaz/i);
    await expect(
      pdf({ ...viaje, version: { ...REEMPLAZO, reemplazaEmitidoEn: new Date('x') } } as never),
    ).rejects.toThrow(/fecha/i);
    for (const numero of [0, 1.5, Number.NaN]) {
      await expect(pdf({ ...viaje, version: { numero } } as never)).rejects.toThrow(
        /versión de certificado inválida/,
      );
    }
  });

  it('cada motivo de la lista cerrada tiene su texto y cabe entero en una línea', async () => {
    expect(Object.keys(TEXTO_MOTIVO_REEMISION).sort()).toEqual([...MOTIVOS_REEMISION].sort());
    for (const motivo of MOTIVOS_REEMISION) {
      // Números de dos dígitos: el texto más largo que puede salir hoy.
      const version = { ...REEMPLAZO, numero: 11, reemplazaA: 10, motivo };
      const items = await itemsPorPagina(await pdf({ ...viaje, version }));
      const linea = items.filter((i) => i.str.startsWith('Reemplaza a la versión'));
      expect(linea).toHaveLength(1);
      expect(linea[0]?.str).toBe(
        `Reemplaza a la versión 10, emitida el 03-11-2026. Motivo: ${TEXTO_MOTIVO_REEMISION[motivo]}.`,
      );
    }
  });

  it('si la línea de reemplazo no cabe en una línea, no genera el PDF', async () => {
    const version = { ...REEMPLAZO, numero: 10 ** 60, reemplazaA: 10 ** 59 };
    await expect(pdf({ ...viaje, version })).rejects.toThrow(/no cabe en una línea/);
  });
});

describe('certificado reemitido — criterio 5: la cifra se explica con lo impreso', () => {
  const numero = (s: string | undefined) => Number((s ?? '').replace(/\./g, '').replace(',', '.'));

  it('imprime el factor corregido, y litros × factor dan las emisiones impresas', async () => {
    const todo = await texto({ ...viaje, version: REEMPLAZO });
    const factor = numero(todo.match(/Factor de emisión usado\s+([\d.,]+) kg CO₂e/)?.[1]);
    const litros = numero(todo.match(/Combustible: ([\d.,]+) L/)?.[1]);
    const emisiones = numero(todo.match(/Emisiones totales WTW\s+([\d.,]+)/)?.[1]);

    expect(factor).toBe(3.24);
    expect(litros).toBe(182.33);
    expect(emisiones).toBe(590.75);
    // Lo impreso va a 2 decimales: la diferencia tolerada es la de ese redondeo.
    expect(Math.abs(litros * factor - emisiones)).toBeLessThanOrEqual(0.005 * factor + 0.005);
  });

  it('con el factor viejo la cuenta no cierra (es el defecto que se corrige)', async () => {
    const todo = await texto(viaje, { ...corregido, emissionFactorUsado: 3.25 });
    const factor = numero(todo.match(/Factor de emisión usado\s+([\d.,]+) kg CO₂e/)?.[1]);
    expect(Math.abs(182.33 * factor - 590.75)).toBeGreaterThan(0.005 * factor + 0.005);
  });
});
