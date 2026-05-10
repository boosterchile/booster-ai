/**
 * Runner para la eval suite (Phase 3 PR-J4).
 *
 * Recibe una `GenerarTextoFn` (stubbed o real-Gemini) y los casos
 * golden, ejecuta el flow completo (`generarCoachingConduccion`) por
 * cada caso, evalúa todas las propiedades, y devuelve un reporte
 * estructurado.
 *
 * Diseñado para 2 surfaces:
 *   1. Test unit hermético (vitest): genFn stubbed con outputs canned;
 *      verifica que las propiedades pasen para outputs "buenos" y
 *      fallen para outputs "malos" (tests negativos).
 *   2. CLI live (`pnpm eval:live`): genFn real contra Gemini API.
 *      Imprime el reporte en formato consumible por humanos +
 *      JSON file para tracking de regresión.
 */

import { determinarFocoPrincipal } from '../foco.js';
import { generarCoachingConduccion } from '../generar-coaching.js';
import type { GenerarTextoFn } from '../tipos.js';
import { CASOS_GOLDEN, type CasoGolden } from './casos.js';

export interface ResultadoPropiedad {
  /** ID de la propiedad. */
  id: string;
  desc: string;
  ok: boolean;
  /** Mensaje cuando ok=false. */
  message?: string;
}

export interface ResultadoCaso {
  /** ID del caso. */
  id: string;
  escenario: string;
  /** Output que generó el modelo (o el fallback). */
  output: string;
  /** Fuente reportada por generarCoachingConduccion: gemini | plantilla. */
  fuente: 'gemini' | 'plantilla';
  /** Foco esperado vs detectado por determinarFocoPrincipal. */
  focoEsperado: string;
  focoDetectado: string;
  /** Propiedades evaluadas, una entry por propiedad. */
  propiedades: ResultadoPropiedad[];
  /** Cuántas propiedades pasaron (de total). */
  pass: number;
  total: number;
  /** Caso pasa si TODAS las propiedades pasan + foco coincide. */
  ok: boolean;
}

export interface ReporteEval {
  /** Total de casos ejecutados. */
  totalCasos: number;
  /** Casos que pasaron 100%. */
  casosOk: number;
  /** Casos con al menos 1 propiedad fallida. */
  casosFallidos: number;
  /** Si TODOS pasaron. */
  ok: boolean;
  resultados: ResultadoCaso[];
}

export async function ejecutarEvals(opts: {
  genFn: GenerarTextoFn;
  modelo?: string;
  casos?: CasoGolden[];
}): Promise<ReporteEval> {
  const { genFn, modelo = 'gemini-2.0-flash-exp', casos = CASOS_GOLDEN } = opts;

  const resultados: ResultadoCaso[] = [];
  for (const caso of casos) {
    // Validar consistencia interna del caso: el foco esperado debe
    // coincidir con lo que produce determinarFocoPrincipal.
    const focoDetectado = determinarFocoPrincipal(caso.params.desglose);

    // Llamamos al flow completo (mismo path que prod) — esto incluye
    // fallback automático a plantilla si el genFn falla.
    const r = await generarCoachingConduccion(caso.params, { genFn, modelo });

    const propiedades: ResultadoPropiedad[] = caso.propiedades.map((p) => {
      const res = p.check(r.mensaje);
      return res.ok
        ? { id: p.id, desc: p.desc, ok: true }
        : { id: p.id, desc: p.desc, ok: false, message: res.message };
    });

    const pass = propiedades.filter((p) => p.ok).length;
    const total = propiedades.length;
    const focoOk = focoDetectado === caso.focoEsperado;
    const allPropsOk = pass === total;

    resultados.push({
      id: caso.id,
      escenario: caso.escenario,
      output: r.mensaje,
      fuente: r.fuente,
      focoEsperado: caso.focoEsperado,
      focoDetectado,
      propiedades,
      pass,
      total,
      ok: focoOk && allPropsOk,
    });
  }

  const casosOk = resultados.filter((r) => r.ok).length;
  return {
    totalCasos: resultados.length,
    casosOk,
    casosFallidos: resultados.length - casosOk,
    ok: casosOk === resultados.length,
    resultados,
  };
}

/**
 * Formatea un reporte para output legible (CLI). Devuelve string
 * multi-línea listo para `console.log` o write a file.
 *
 * No usa colores ANSI — el caller decide si quiere envolver en chalk.
 */
export function formatearReporte(reporte: ReporteEval): string {
  const lines: string[] = [];
  lines.push('═════════════════════════════════════════════════════════════════');
  lines.push(' Coaching Generator — Eval Suite Report');
  lines.push('═════════════════════════════════════════════════════════════════');
  lines.push('');
  lines.push(
    `Casos: ${reporte.totalCasos}  OK: ${reporte.casosOk}  Fallidos: ${reporte.casosFallidos}`,
  );
  lines.push(`Estado: ${reporte.ok ? '✓ TODO PASA' : '✗ HAY REGRESIONES'}`);
  lines.push('');

  for (const r of reporte.resultados) {
    const status = r.ok ? '✓' : '✗';
    lines.push(`${status} [${r.id}]  ${r.escenario}`);
    lines.push(
      `    fuente=${r.fuente}  foco_esperado=${r.focoEsperado}  foco_detectado=${r.focoDetectado}`,
    );
    lines.push(
      `    output (${r.output.length} chars): ${r.output.slice(0, 180)}${r.output.length > 180 ? '…' : ''}`,
    );
    lines.push(`    propiedades: ${r.pass}/${r.total}`);
    for (const p of r.propiedades.filter((x) => !x.ok)) {
      lines.push(`      ✗ ${p.id}: ${p.message}`);
    }
    lines.push('');
  }

  lines.push('═════════════════════════════════════════════════════════════════');
  return lines.join('\n');
}
