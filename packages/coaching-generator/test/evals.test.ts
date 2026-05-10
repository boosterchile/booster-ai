/**
 * Tests herméticos de la eval suite (Phase 3 PR-J4).
 *
 * Estos tests NO consultan Gemini. Usan un genFn stubbed que devuelve
 * outputs realistas. Validan dos cosas:
 *
 *   1. **Las propiedades discriminan correctamente**: outputs "buenos"
 *      pasan, outputs "malos" (con emoji, > 320 chars, dialecto, etc.)
 *      fallan en la propiedad correspondiente.
 *
 *   2. **El runner integra bien con generarCoachingConduccion**: el
 *      reporte refleja correctamente fuente, foco, propiedades.
 *
 * El test live (real Gemini) corre vía `pnpm eval:live` script — no
 * en vitest.
 */

import { describe, expect, it } from 'vitest';
import { CASOS_GOLDEN, ejecutarEvals, formatearReporte } from '../src/evals/index.js';
import type { GenerarTextoFn } from '../src/tipos.js';

/**
 * genFn que devuelve output "perfecto" para cada caso golden.
 * Útil como baseline — todos los casos deberían pasar 100%.
 */
const genFnPerfecto: GenerarTextoFn = async ({ userPrompt }) => {
  // Heurística simple para responder algo coherente con cada foco.
  // El test no busca perfección — busca que las propiedades pasen.
  if (userPrompt.includes('Excesos de velocidad: 0')) {
    if (userPrompt.includes('Aceleraciones bruscas: 5')) {
      return 'Buen viaje en general. Para bajar consumo, intenta acelerar de forma más gradual y progresiva al salir de detenciones.';
    }
    if (
      userPrompt.includes('Frenados bruscos: 4') ||
      userPrompt.includes('Frenados bruscos: 8') ||
      userPrompt.includes('Frenados bruscos: 9')
    ) {
      return 'Detectamos varios frenados bruscos. Trata de anticipar la distancia y soltar el acelerador antes para frenar suave.';
    }
    if (
      userPrompt.includes('Curvas tomadas con fuerza: 4') ||
      userPrompt.includes('Curvas tomadas con fuerza: 5')
    ) {
      return 'Notamos curvas tomadas con fuerza. Reduce velocidad antes de entrar a la curva para mantener la carga estable.';
    }
  }
  if (
    userPrompt.includes('Excesos de velocidad: 3') ||
    userPrompt.includes('Excesos de velocidad: 4')
  ) {
    return 'Detectamos algunos excesos de velocidad en ruta. Mantenerte cerca del límite reduce consumo de combustible y desgaste.';
  }
  if (userPrompt.includes('Score de conducción: 35/100')) {
    return 'Notamos varios eventos en este viaje: frenados, aceleraciones y curvas. Anticipa el tránsito para frenar y acelerar más suave.';
  }
  // Default: felicitación.
  return 'Excelente viaje. Mantienes un manejo suave que reduce consumo y mantiene la carga segura. Sigue así.';
};

/** genFn que devuelve siempre el mismo output, para tests negativos. */
function genFnFijo(text: string): GenerarTextoFn {
  return async () => text;
}

/** genFn que falla siempre — fuerza fallback a plantilla. */
const genFnQueFalla: GenerarTextoFn = async () => {
  throw new Error('simulated gemini error');
};

describe('eval suite (hermetic)', () => {
  it('CASOS_GOLDEN tiene >= 12 casos cubriendo todos los focos', () => {
    expect(CASOS_GOLDEN.length).toBeGreaterThanOrEqual(12);
    const focos = new Set(CASOS_GOLDEN.map((c) => c.focoEsperado));
    expect(focos).toContain('felicitacion');
    expect(focos).toContain('frenado');
    expect(focos).toContain('aceleracion');
    expect(focos).toContain('curvas');
    expect(focos).toContain('velocidad');
    expect(focos).toContain('multiple');
  });

  it('cada caso tiene foco esperado consistente con su desglose', async () => {
    // Indirectamente: ejecutar el runner y validar focoDetectado === focoEsperado.
    const reporte = await ejecutarEvals({ genFn: genFnPerfecto });
    for (const r of reporte.resultados) {
      expect(r.focoDetectado, `caso ${r.id}: foco mismatch`).toBe(r.focoEsperado);
    }
  });

  it('genFn perfecto → todos los casos pasan 100%', async () => {
    const reporte = await ejecutarEvals({ genFn: genFnPerfecto });
    expect(reporte.ok).toBe(true);
    expect(reporte.casosFallidos).toBe(0);
    // Cada caso debe haber consumido el genFn (fuente='gemini').
    for (const r of reporte.resultados) {
      expect(r.fuente, `caso ${r.id}: usar gemini, no plantilla`).toBe('gemini');
    }
  });

  it('genFn que falla → fallback a plantilla, propiedades base siguen pasando', async () => {
    const reporte = await ejecutarEvals({ genFn: genFnQueFalla });
    // Si la plantilla determinística fuera mala, este test lo expone.
    // Esperamos que el output de la plantilla pase las propiedades base
    // (longitud, sin emojis, sin bullets, etc.) — así se garantiza que
    // el fallback siempre da output válido.
    for (const r of reporte.resultados) {
      expect(r.fuente, `caso ${r.id}: debe ser plantilla`).toBe('plantilla');
      const propsBaseFalladas = r.propiedades.filter(
        (p) =>
          !p.ok &&
          [
            'longitud_max_320',
            'longitud_min_30',
            'sin_emojis',
            'sin_bullets',
            'sin_dialecto_no_chileno',
            'tono_respetuoso',
            'sin_fabricacion',
            'es_espanol',
          ].includes(p.id),
      );
      expect(propsBaseFalladas, `caso ${r.id}: plantilla viola props base`).toEqual([]);
    }
  });

  it('output con emoji → falla la propiedad sin_emojis', async () => {
    const reporte = await ejecutarEvals({
      genFn: genFnFijo(
        'Excelente viaje 🚛 sigue así con manejo suave para bajar consumo de combustible.',
      ),
    });
    // Cada caso debería fallar la propiedad sin_emojis.
    for (const r of reporte.resultados) {
      const propEmoji = r.propiedades.find((p) => p.id === 'sin_emojis');
      expect(propEmoji?.ok, `caso ${r.id}: sin_emojis debió fallar`).toBe(false);
    }
  });

  it('output > 320 chars → falla la propiedad longitud_max_320', async () => {
    const long = `Excelente trabajo en este viaje. ${'Mantén la distancia y anticipa frenadas. '.repeat(10)}`;
    const reporte = await ejecutarEvals({ genFn: genFnFijo(long) });
    // El runner integra con generarCoachingConduccion, que ya rechaza
    // textos > MAX_CHARS y cae a plantilla. Entonces fuente=plantilla
    // y la propiedad longitud_max_320 debería pasar (la plantilla es
    // corta). Verificamos que el fallback se activó.
    for (const r of reporte.resultados) {
      expect(r.fuente).toBe('plantilla');
      expect(r.output.length).toBeLessThanOrEqual(320);
    }
  });

  it('output muy corto (< 30 chars) → falla longitud_min_30', async () => {
    const reporte = await ejecutarEvals({ genFn: genFnFijo('Buen trabajo.') });
    for (const r of reporte.resultados) {
      const propMin = r.propiedades.find((p) => p.id === 'longitud_min_30');
      expect(propMin?.ok, `caso ${r.id}: longitud_min_30 debió fallar`).toBe(false);
    }
  });

  it('output con bullets → falla la propiedad sin_bullets', async () => {
    const conBullets = `Detectamos varios eventos:
- Frenados bruscos
- Aceleraciones
Trata de anticipar el tránsito.`;
    const reporte = await ejecutarEvals({ genFn: genFnFijo(conBullets) });
    for (const r of reporte.resultados) {
      const propBullets = r.propiedades.find((p) => p.id === 'sin_bullets');
      expect(propBullets?.ok, `caso ${r.id}: sin_bullets debió fallar`).toBe(false);
    }
  });

  it('output con dialecto no-chileno → falla sin_dialecto_no_chileno', async () => {
    const reporte = await ejecutarEvals({
      genFn: genFnFijo('Buen viaje che, mantén la calma y anticipa frenadas para bajar consumo.'),
    });
    for (const r of reporte.resultados) {
      const propDial = r.propiedades.find((p) => p.id === 'sin_dialecto_no_chileno');
      expect(propDial?.ok, `caso ${r.id}: sin_dialecto debió fallar`).toBe(false);
    }
  });

  it('output con tono agresivo → falla tono_respetuoso', async () => {
    const reporte = await ejecutarEvals({
      genFn: genFnFijo(
        'Pésimo manejo. Deberías frenar suave y anticipar para no destrozar el vehículo.',
      ),
    });
    for (const r of reporte.resultados) {
      const propTono = r.propiedades.find((p) => p.id === 'tono_respetuoso');
      expect(propTono?.ok, `caso ${r.id}: tono_respetuoso debió fallar`).toBe(false);
    }
  });

  it('output con fabricación (clima/hora) → falla sin_fabricacion', async () => {
    const reporte = await ejecutarEvals({
      genFn: genFnFijo(
        'Notamos que con la lluvia de las 14:30 hubo más frenados. Anticipa más en clima húmedo.',
      ),
    });
    for (const r of reporte.resultados) {
      const propFab = r.propiedades.find((p) => p.id === 'sin_fabricacion');
      expect(propFab?.ok, `caso ${r.id}: sin_fabricacion debió fallar`).toBe(false);
    }
  });

  it('formatearReporte produce string multi-línea con secciones', async () => {
    const reporte = await ejecutarEvals({ genFn: genFnPerfecto });
    const txt = formatearReporte(reporte);
    expect(txt).toContain('Eval Suite Report');
    expect(txt).toContain('Casos:');
    expect(txt).toContain('TODO PASA');
    // Debe incluir cada ID de caso en el output.
    for (const c of CASOS_GOLDEN) {
      expect(txt).toContain(c.id);
    }
  });
});
