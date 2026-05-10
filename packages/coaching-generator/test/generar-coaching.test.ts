import { describe, expect, it, vi } from 'vitest';
import { determinarFocoPrincipal } from '../src/foco.js';
import {
  generarCoachingConduccion,
  generarCoachingDeterministicoFromBreakdown,
} from '../src/index.js';
import type { GenerarTextoFn, ParametrosCoaching } from '../src/tipos.js';

/**
 * Tests del coaching generator (Phase 3 PR-J1).
 *
 * Cubre:
 *   1. determinarFocoPrincipal: cada bucket + casos múltiples + felicitación.
 *   2. Plantilla determinística: mensaje válido por foco, contiene los counts.
 *   3. generarCoachingConduccion con genFn:
 *      - Happy path (genFn devuelve texto válido)
 *      - Fallback cuando genFn devuelve null
 *      - Fallback cuando genFn throws
 *      - Fallback cuando genFn devuelve > MAX_CHARS
 *      - Fallback cuando no se pasa genFn
 *   4. Invariantes del prompt (system prompt + user prompt incluyen los datos).
 */

const PARAMS_BASE: ParametrosCoaching = {
  score: 78,
  nivel: 'bueno',
  desglose: {
    aceleracionesBruscas: 0,
    frenadosBruscos: 4,
    curvasBruscas: 0,
    excesosVelocidad: 0,
    eventosPorHora: 4,
  },
  trip: {
    distanciaKm: 250,
    duracionMinutos: 180,
    tipoCarga: 'carga_seca',
  },
};

describe('determinarFocoPrincipal', () => {
  it('sin eventos → felicitacion', () => {
    expect(
      determinarFocoPrincipal({
        aceleracionesBruscas: 0,
        frenadosBruscos: 0,
        curvasBruscas: 0,
        excesosVelocidad: 0,
        eventosPorHora: 0,
      }),
    ).toBe('felicitacion');
  });

  it('solo frenados → frenado', () => {
    expect(
      determinarFocoPrincipal({
        aceleracionesBruscas: 0,
        frenadosBruscos: 5,
        curvasBruscas: 0,
        excesosVelocidad: 0,
        eventosPorHora: 5,
      }),
    ).toBe('frenado');
  });

  it('solo aceleraciones → aceleracion', () => {
    expect(
      determinarFocoPrincipal({
        aceleracionesBruscas: 3,
        frenadosBruscos: 0,
        curvasBruscas: 0,
        excesosVelocidad: 0,
        eventosPorHora: 3,
      }),
    ).toBe('aceleracion');
  });

  it('solo curvas → curvas', () => {
    expect(
      determinarFocoPrincipal({
        aceleracionesBruscas: 0,
        frenadosBruscos: 0,
        curvasBruscas: 2,
        excesosVelocidad: 0,
        eventosPorHora: 2,
      }),
    ).toBe('curvas');
  });

  it('solo excesos → velocidad', () => {
    expect(
      determinarFocoPrincipal({
        aceleracionesBruscas: 0,
        frenadosBruscos: 0,
        curvasBruscas: 0,
        excesosVelocidad: 8,
        eventosPorHora: 8,
      }),
    ).toBe('velocidad');
  });

  it('múltiples tipos → multiple', () => {
    expect(
      determinarFocoPrincipal({
        aceleracionesBruscas: 1,
        frenadosBruscos: 5,
        curvasBruscas: 0,
        excesosVelocidad: 0,
        eventosPorHora: 6,
      }),
    ).toBe('multiple');
  });

  it('three tipos → multiple', () => {
    expect(
      determinarFocoPrincipal({
        aceleracionesBruscas: 1,
        frenadosBruscos: 1,
        curvasBruscas: 1,
        excesosVelocidad: 0,
        eventosPorHora: 3,
      }),
    ).toBe('multiple');
  });
});

describe('generarCoachingDeterministicoFromBreakdown — plantilla', () => {
  it('felicitacion mantiene tono positivo + menciona km', () => {
    const r = generarCoachingDeterministicoFromBreakdown({
      ...PARAMS_BASE,
      score: 100,
      nivel: 'excelente',
      desglose: {
        aceleracionesBruscas: 0,
        frenadosBruscos: 0,
        curvasBruscas: 0,
        excesosVelocidad: 0,
        eventosPorHora: 0,
      },
    });
    expect(r.fuente).toBe('plantilla');
    expect(r.focoPrincipal).toBe('felicitacion');
    expect(r.mensaje).toMatch(/[Ee]xcelente|sin eventos/);
    expect(r.mensaje).toContain('250 km');
  });

  it('frenado plantilla incluye el count exacto', () => {
    const r = generarCoachingDeterministicoFromBreakdown(PARAMS_BASE);
    expect(r.focoPrincipal).toBe('frenado');
    expect(r.mensaje).toMatch(/4 frenados/);
  });

  it('mensaje plantilla siempre ≤ 320 chars (cabe en SMS/WhatsApp)', () => {
    const cases: ParametrosCoaching[] = [
      { ...PARAMS_BASE, desglose: { ...PARAMS_BASE.desglose, frenadosBruscos: 99 } },
      {
        ...PARAMS_BASE,
        desglose: {
          aceleracionesBruscas: 50,
          frenadosBruscos: 50,
          curvasBruscas: 50,
          excesosVelocidad: 50,
          eventosPorHora: 200,
        },
        score: 0,
        nivel: 'malo',
      },
    ];
    for (const params of cases) {
      const r = generarCoachingDeterministicoFromBreakdown(params);
      expect(r.mensaje.length).toBeLessThanOrEqual(320);
    }
  });

  it('multiple plantilla menciona total + score', () => {
    const r = generarCoachingDeterministicoFromBreakdown({
      ...PARAMS_BASE,
      score: 60,
      nivel: 'regular',
      desglose: {
        aceleracionesBruscas: 2,
        frenadosBruscos: 3,
        curvasBruscas: 1,
        excesosVelocidad: 5,
        eventosPorHora: 11,
      },
    });
    expect(r.focoPrincipal).toBe('multiple');
    expect(r.mensaje).toContain('60');
    expect(r.mensaje).toMatch(/11 eventos/);
  });
});

describe('generarCoachingConduccion — paths AI vs plantilla', () => {
  it('happy path: genFn devuelve texto válido → fuente="gemini"', async () => {
    const genFn: GenerarTextoFn = vi.fn(async () => 'Mensaje de coaching generado por AI.');
    const r = await generarCoachingConduccion(PARAMS_BASE, { genFn });
    expect(r.fuente).toBe('gemini');
    expect(r.mensaje).toBe('Mensaje de coaching generado por AI.');
    expect(r.modelo).toBe('gemini-2.0-flash-exp');
    expect(genFn).toHaveBeenCalledOnce();
  });

  it('genFn devuelve null → fallback plantilla', async () => {
    const genFn: GenerarTextoFn = async () => null;
    const r = await generarCoachingConduccion(PARAMS_BASE, { genFn });
    expect(r.fuente).toBe('plantilla');
    expect(r.mensaje).toMatch(/4 frenados/);
  });

  it('genFn devuelve string vacío → fallback plantilla', async () => {
    const genFn: GenerarTextoFn = async () => '   ';
    const r = await generarCoachingConduccion(PARAMS_BASE, { genFn });
    expect(r.fuente).toBe('plantilla');
  });

  it('genFn throws → fallback plantilla (no propaga error)', async () => {
    const genFn: GenerarTextoFn = async () => {
      throw new Error('Gemini API quota exceeded');
    };
    const r = await generarCoachingConduccion(PARAMS_BASE, { genFn });
    expect(r.fuente).toBe('plantilla');
  });

  it('genFn devuelve > 320 chars → fallback plantilla', async () => {
    const longText = 'Lorem ipsum '.repeat(50); // ~600 chars
    const genFn: GenerarTextoFn = async () => longText;
    const r = await generarCoachingConduccion(PARAMS_BASE, { genFn });
    expect(r.fuente).toBe('plantilla');
  });

  it('sin genFn → directo a plantilla', async () => {
    const r = await generarCoachingConduccion(PARAMS_BASE);
    expect(r.fuente).toBe('plantilla');
  });

  it('genFn=null → directo a plantilla', async () => {
    const r = await generarCoachingConduccion(PARAMS_BASE, { genFn: null });
    expect(r.fuente).toBe('plantilla');
  });

  it('modelo se reporta cuando se override en opts', async () => {
    const genFn: GenerarTextoFn = async () => 'OK';
    const r = await generarCoachingConduccion(PARAMS_BASE, {
      genFn,
      modelo: 'gemini-1.5-pro',
    });
    expect(r.modelo).toBe('gemini-1.5-pro');
  });
});

describe('prompts — invariantes', () => {
  it('user prompt incluye los datos del trip', async () => {
    const captured: Array<{ systemPrompt: string; userPrompt: string }> = [];
    const genFn: GenerarTextoFn = async (params) => {
      captured.push(params);
      return 'OK';
    };

    await generarCoachingConduccion(PARAMS_BASE, { genFn });

    expect(captured).toHaveLength(1);
    const userPrompt = captured[0]?.userPrompt ?? '';
    expect(userPrompt).toContain('250 km');
    expect(userPrompt).toContain('180 min');
    expect(userPrompt).toContain('carga_seca');
    expect(userPrompt).toContain('78/100');
    expect(userPrompt).toContain('bueno');
    expect(userPrompt).toContain('Frenados bruscos: 4');
  });

  it('system prompt incluye reglas obligatorias', async () => {
    const captured: Array<{ systemPrompt: string; userPrompt: string }> = [];
    const genFn: GenerarTextoFn = async (params) => {
      captured.push(params);
      return 'OK';
    };

    await generarCoachingConduccion(PARAMS_BASE, { genFn });

    const sys = captured[0]?.systemPrompt ?? '';
    // Reglas críticas que NO deben perderse en cambios futuros del prompt.
    expect(sys).toMatch(/español/i);
    expect(sys).toMatch(/280 caracteres/);
    expect(sys).toMatch(/respetuoso/i);
    expect(sys).toMatch(/NO uses emojis/i);
  });
});

describe('determinismo de la plantilla', () => {
  it('mismo input → mismo output', () => {
    const r1 = generarCoachingDeterministicoFromBreakdown(PARAMS_BASE);
    const r2 = generarCoachingDeterministicoFromBreakdown(PARAMS_BASE);
    expect(r1).toEqual(r2);
  });
});
