/**
 * Casos golden para regresión del prompt Gemini (Phase 3 PR-J4).
 *
 * Cada caso es un input (`ParametrosCoaching`) + las propiedades
 * cualitativas que el output debe cumplir. NO comparamos texto exacto
 * (sería frágil con un modelo no-determinístico aunque corra
 * `temperature=0`); validamos invariantes.
 *
 * Cobertura:
 *   - 1 caso por foco principal (felicitacion, frenado, aceleracion,
 *     curvas, velocidad, multiple) × 2 niveles de severidad.
 *   - Edge cases: trip corto, trip largo, carga frágil, carga perecible.
 *
 * Uso:
 *   - Hermetic test (CI): src/evals/index.test.ts con genFn stubbed que
 *     devuelve outputs realistas; testea que las propiedades se evalúen
 *     correctamente.
 *   - Live test (opt-in): scripts/run-live-evals.ts con genFn real
 *     contra Gemini API si GEMINI_API_KEY está seteado. Imprime un
 *     reporte por caso + cost estimado.
 */

import type { FocoPrincipal, ParametrosCoaching } from '../tipos.js';

/**
 * Propiedades evaluables sobre el output del modelo. Son funciones puras
 * que reciben el texto y devuelven `{ ok, message }`. Granular para
 * que el reporte muestre QUÉ propiedad falló (no solo "este caso falló").
 */
export interface PropiedadEval {
  /** Identificador legible para el reporte. */
  id: string;
  /** Descripción humana de qué chequea. */
  desc: string;
  /** Evaluador. Devuelve `{ ok: true }` o `{ ok: false, message }`. */
  check: (output: string) => { ok: true } | { ok: false; message: string };
}

export interface CasoGolden {
  /** Identificador único, snake_case. */
  id: string;
  /** Una línea explicando el escenario que cubre. */
  escenario: string;
  /** Input para el prompt. */
  params: ParametrosCoaching;
  /** Foco esperado (debe coincidir con `determinarFocoPrincipal(params.desglose)`). */
  focoEsperado: FocoPrincipal;
  /** Propiedades que el output debe cumplir. */
  propiedades: PropiedadEval[];
}

// ---------------------------------------------------------------------------
// Propiedades comunes (re-usadas por casos)
// ---------------------------------------------------------------------------

// Términos de dialecto no-chileno. Usamos regex con word boundary (\b)
// para no matchear sub-strings ("che" en "noche", "mae" en "maestro").
// 'che' es controvertido porque puede ser argentino o lunfardo; en
// contexto chileno coaching es señal de tono inapropiado.
const PROHIBIDOS_DIALECTO_RE = /\b(guey|güey|tío|tía|pibe|che|mae|huevón|weón)\b/i;
const PROHIBIDOS_TONO_RE = /(deberías|tienes que |es tu culpa|mal manejaste|pésimo)/i;

const propLongitud: PropiedadEval = {
  id: 'longitud_max_320',
  desc: 'Mensaje ≤ 320 chars (cabe en SMS / WhatsApp y deja slack para el wrapper)',
  check: (out) =>
    out.length <= 320 ? { ok: true } : { ok: false, message: `${out.length} chars > 320` },
};

const propLongitudMin: PropiedadEval = {
  id: 'longitud_min_30',
  desc: 'Mensaje ≥ 30 chars (no acepta respuestas tipo "ok")',
  check: (out) =>
    out.trim().length >= 30
      ? { ok: true }
      : { ok: false, message: `${out.trim().length} chars < 30` },
};

const propSinEmojis: PropiedadEval = {
  id: 'sin_emojis',
  desc: 'Sin emojis (regla 7 del system prompt)',
  check: (out) => {
    // Range Unicode aproximado de emojis.
    const re = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
    return re.test(out)
      ? { ok: false, message: `emoji detectado: ${out.match(re)?.[0]}` }
      : { ok: true };
  },
};

const propSinBullets: PropiedadEval = {
  id: 'sin_bullets',
  desc: 'Sin bullets ni numeración (regla 7)',
  check: (out) => {
    const reBullet = /(^|\n)\s*[-*•]\s/;
    const reNumber = /(^|\n)\s*\d+[.)]\s/;
    if (reBullet.test(out)) {
      return { ok: false, message: 'bullet (-, *, •) detectado' };
    }
    if (reNumber.test(out)) {
      return { ok: false, message: 'numeración detectada' };
    }
    return { ok: true };
  },
};

const propSinDialecto: PropiedadEval = {
  id: 'sin_dialecto_no_chileno',
  desc: 'No contiene términos de dialecto no-chileno (regla 1)',
  check: (out) => {
    const m = out.match(PROHIBIDOS_DIALECTO_RE);
    return m ? { ok: false, message: `término no-chileno: "${m[0]}"` } : { ok: true };
  },
};

const propTonoRespetuoso: PropiedadEval = {
  id: 'tono_respetuoso',
  desc: 'No usa frases culpabilizadoras (regla 3)',
  check: (out) => {
    const m = out.match(PROHIBIDOS_TONO_RE);
    return m ? { ok: false, message: `tono agresivo: "${m[0]}"` } : { ok: true };
  },
};

const propSinFabricacion: PropiedadEval = {
  id: 'sin_fabricacion',
  desc: 'No inventa detalles del viaje no presentes en el input (regla 6)',
  check: (out) => {
    const lower = out.toLowerCase();
    // Patrones que el modelo a veces alucina cuando no tiene contexto:
    const inventados = [
      /\d{1,2}:\d{2}/, // hora específica
      /\b(lunes|martes|miércoles|jueves|viernes|sábado|domingo)\b/i, // día de la semana
      /\b(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\b/i,
      // clima (no está en el input). \b evita matchear "sol" dentro de
      // "soltar", "sole(dad)", etc.
      /\b(lluvia|niebla|nieve|sol|soleado|nublado)\b/i,
      /\b(tráfico|congestión|atasco)\b/i, // tráfico (no está en el input)
    ];
    for (const re of inventados) {
      if (re.test(lower)) {
        return { ok: false, message: `posible alucinación: "${out.match(re)?.[0]}"` };
      }
    }
    return { ok: true };
  },
};

const propEspañol: PropiedadEval = {
  id: 'es_espanol',
  desc: 'Detecta contenido en español (heurística simple por keywords frecuentes)',
  check: (out) => {
    const lower = ` ${out.toLowerCase()} `;
    const espTokens = [
      ' el ',
      ' la ',
      ' los ',
      ' las ',
      ' tu ',
      ' tus ',
      ' que ',
      ' con ',
      ' por ',
      ' para ',
      ' un ',
      ' una ',
      ' de ',
      ' del ',
      ' al ',
      ' en ',
      ' es ',
      ' y ',
      ' o ',
      ' se ',
      ' su ',
      ' sus ',
      ' este ',
      ' esta ',
    ];
    return espTokens.some((t) => lower.includes(t))
      ? { ok: true }
      : { ok: false, message: 'no se detectaron tokens del español' };
  },
};

/** Propiedades base que aplican a TODOS los casos. */
const propsBase: PropiedadEval[] = [
  propLongitud,
  propLongitudMin,
  propSinEmojis,
  propSinBullets,
  propSinDialecto,
  propTonoRespetuoso,
  propSinFabricacion,
  propEspañol,
];

/**
 * Propiedad foco-específica: si el caso tiene `frenado` como foco
 * principal, el mensaje debería mencionar frenado/anticipar/distancia o
 * sinónimos. Esto detecta degradación cuando el modelo "se va por las
 * ramas" ignorando la dimensión problemática.
 */
function propFocoMencionado(foco: FocoPrincipal): PropiedadEval {
  const KEYWORDS: Record<FocoPrincipal, string[]> = {
    felicitacion: ['felicit', 'excelente', 'buen trabajo', 'sigu', 'mantén', 'mantienes'],
    frenado: ['fren', 'anticip', 'distanc', 'suav'],
    aceleracion: ['aceler', 'arranq', 'gradual', 'progresiv', 'suav'],
    curvas: ['curv', 'velocidad en curva', 'reduce antes', 'inclin', 'gir'],
    velocidad: ['velocidad', 'límite', 'limit', 'exceso', 'speed'],
    multiple: ['varios', 'múltipl', 'general', 'global', 'frenado', 'aceler'],
  };
  return {
    id: `foco_keyword_${foco}`,
    desc: `Menciona al menos una palabra clave del foco "${foco}"`,
    check: (out) => {
      const lower = out.toLowerCase();
      const kws = KEYWORDS[foco];
      const hit = kws.find((kw) => lower.includes(kw));
      return hit
        ? { ok: true }
        : { ok: false, message: `ninguna keyword del foco "${foco}" en el output` };
    },
  };
}

// ---------------------------------------------------------------------------
// Casos golden
// ---------------------------------------------------------------------------

export const CASOS_GOLDEN: CasoGolden[] = [
  {
    id: 'excelente_sin_eventos_distancia_media',
    escenario: 'Viaje 250km sin eventos de conducción, score 100',
    params: {
      score: 100,
      nivel: 'excelente',
      desglose: {
        aceleracionesBruscas: 0,
        frenadosBruscos: 0,
        curvasBruscas: 0,
        excesosVelocidad: 0,
        eventosPorHora: 0,
      },
      trip: { distanciaKm: 250, duracionMinutos: 180, tipoCarga: 'carga_seca' },
    },
    focoEsperado: 'felicitacion',
    propiedades: [...propsBase, propFocoMencionado('felicitacion')],
  },
  {
    id: 'frenado_score_alto_un_solo_evento',
    escenario:
      'Score 92 con 1 solo frenado brusco — foco=frenado pero el coaching debe ser positivo',
    params: {
      score: 92,
      nivel: 'excelente',
      desglose: {
        aceleracionesBruscas: 0,
        frenadosBruscos: 1,
        curvasBruscas: 0,
        excesosVelocidad: 0,
        eventosPorHora: 0.3,
      },
      trip: { distanciaKm: 200, duracionMinutos: 200, tipoCarga: 'carga_seca' },
    },
    focoEsperado: 'frenado',
    propiedades: [...propsBase, propFocoMencionado('frenado')],
  },
  {
    id: 'frenado_bueno',
    escenario: 'Score bueno (78) con foco claro en frenados (4 eventos)',
    params: {
      score: 78,
      nivel: 'bueno',
      desglose: {
        aceleracionesBruscas: 0,
        frenadosBruscos: 4,
        curvasBruscas: 0,
        excesosVelocidad: 0,
        eventosPorHora: 1.3,
      },
      trip: { distanciaKm: 250, duracionMinutos: 180, tipoCarga: 'carga_seca' },
    },
    focoEsperado: 'frenado',
    propiedades: [...propsBase, propFocoMencionado('frenado')],
  },
  {
    id: 'frenado_regular_severo',
    escenario: 'Score regular (55) con muchos frenados (8) — más severo',
    params: {
      score: 55,
      nivel: 'regular',
      desglose: {
        aceleracionesBruscas: 0,
        frenadosBruscos: 8,
        curvasBruscas: 0,
        excesosVelocidad: 0,
        eventosPorHora: 2.7,
      },
      trip: { distanciaKm: 300, duracionMinutos: 180, tipoCarga: 'carga_seca' },
    },
    focoEsperado: 'frenado',
    propiedades: [...propsBase, propFocoMencionado('frenado')],
  },
  {
    id: 'aceleracion_bueno',
    escenario: 'Score bueno con foco en aceleraciones bruscas (5 eventos)',
    params: {
      score: 75,
      nivel: 'bueno',
      desglose: {
        aceleracionesBruscas: 5,
        frenadosBruscos: 0,
        curvasBruscas: 0,
        excesosVelocidad: 0,
        eventosPorHora: 1.7,
      },
      trip: { distanciaKm: 280, duracionMinutos: 180, tipoCarga: 'carga_seca' },
    },
    focoEsperado: 'aceleracion',
    propiedades: [...propsBase, propFocoMencionado('aceleracion')],
  },
  {
    id: 'curvas_bueno',
    escenario: 'Score bueno con foco en curvas bruscas (4 eventos)',
    params: {
      score: 76,
      nivel: 'bueno',
      desglose: {
        aceleracionesBruscas: 0,
        frenadosBruscos: 0,
        curvasBruscas: 4,
        excesosVelocidad: 0,
        eventosPorHora: 1.3,
      },
      trip: { distanciaKm: 220, duracionMinutos: 180, tipoCarga: 'carga_fragil' },
    },
    focoEsperado: 'curvas',
    propiedades: [...propsBase, propFocoMencionado('curvas')],
  },
  {
    id: 'velocidad_bueno',
    escenario: 'Score bueno con foco en exceso velocidad (3 eventos)',
    params: {
      score: 80,
      nivel: 'bueno',
      desglose: {
        aceleracionesBruscas: 0,
        frenadosBruscos: 0,
        curvasBruscas: 0,
        excesosVelocidad: 3,
        eventosPorHora: 1,
      },
      trip: { distanciaKm: 350, duracionMinutos: 240, tipoCarga: 'carga_seca' },
    },
    focoEsperado: 'velocidad',
    propiedades: [...propsBase, propFocoMencionado('velocidad')],
  },
  {
    id: 'multiple_malo_score_bajo',
    escenario: 'Score malo (35) con eventos en varios tipos — máxima alerta',
    params: {
      score: 35,
      nivel: 'malo',
      desglose: {
        aceleracionesBruscas: 6,
        frenadosBruscos: 7,
        curvasBruscas: 3,
        excesosVelocidad: 2,
        eventosPorHora: 6,
      },
      trip: { distanciaKm: 300, duracionMinutos: 180, tipoCarga: 'carga_seca' },
    },
    focoEsperado: 'multiple',
    propiedades: [...propsBase, propFocoMencionado('multiple')],
  },
  {
    id: 'edge_trip_corto_excelente',
    escenario: 'Trip muy corto (40km, 45min) sin eventos — el coaching debe sentirse natural',
    params: {
      score: 100,
      nivel: 'excelente',
      desglose: {
        aceleracionesBruscas: 0,
        frenadosBruscos: 0,
        curvasBruscas: 0,
        excesosVelocidad: 0,
        eventosPorHora: 0,
      },
      trip: { distanciaKm: 40, duracionMinutos: 45, tipoCarga: 'carga_seca' },
    },
    focoEsperado: 'felicitacion',
    propiedades: [...propsBase, propFocoMencionado('felicitacion')],
  },
  {
    id: 'edge_trip_largo_regular',
    escenario: 'Trip 800km / 12h con muchos frenados — el feedback debe ser proporcional',
    params: {
      score: 60,
      nivel: 'regular',
      desglose: {
        aceleracionesBruscas: 0,
        frenadosBruscos: 10,
        curvasBruscas: 0,
        excesosVelocidad: 0,
        eventosPorHora: 0.83,
      },
      trip: { distanciaKm: 800, duracionMinutos: 720, tipoCarga: 'carga_seca' },
    },
    focoEsperado: 'frenado',
    propiedades: [...propsBase, propFocoMencionado('frenado')],
  },
  {
    id: 'edge_carga_fragil',
    escenario: 'Carga frágil con curvas bruscas — el modelo debería reconocer la sensibilidad',
    params: {
      score: 70,
      nivel: 'bueno',
      desglose: {
        aceleracionesBruscas: 0,
        frenadosBruscos: 0,
        curvasBruscas: 5,
        excesosVelocidad: 0,
        eventosPorHora: 1.7,
      },
      trip: { distanciaKm: 250, duracionMinutos: 180, tipoCarga: 'carga_fragil' },
    },
    focoEsperado: 'curvas',
    propiedades: [...propsBase, propFocoMencionado('curvas')],
  },
  {
    id: 'edge_carga_perecible',
    escenario: 'Carga perecible con velocidad — clima de urgencia, debe seguir respetuoso',
    params: {
      score: 70,
      nivel: 'bueno',
      desglose: {
        aceleracionesBruscas: 0,
        frenadosBruscos: 0,
        curvasBruscas: 0,
        excesosVelocidad: 4,
        eventosPorHora: 1.3,
      },
      trip: { distanciaKm: 320, duracionMinutos: 180, tipoCarga: 'carga_perecible' },
    },
    focoEsperado: 'velocidad',
    propiedades: [...propsBase, propFocoMencionado('velocidad')],
  },
];
