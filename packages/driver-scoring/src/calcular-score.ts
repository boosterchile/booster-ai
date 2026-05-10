import type { EventoConduccion, NivelScore, ParametrosScore, ResultadoScore } from './tipos.js';

/**
 * Cálculo del score de conducción por viaje (Phase 2 PR-I3).
 *
 * v1 — fórmula simple, transparente, defendible ante un transportista
 * que cuestione su score:
 *
 *     score = max(0, 100 − Σ penalty(evento))
 *
 *     penalty(aceleracion_brusca) = 5
 *     penalty(frenado_brusco)     = 5
 *     penalty(curva_brusca)       = 5
 *     penalty(exceso_velocidad)   = 2
 *
 * **Por qué estos pesos**:
 *
 *   - **Harsh accel/brake/cornering = 5 cada uno**. Estudios SAE
 *     eco-driving muestran que evitar arrancadas/frenadas bruscas
 *     reduce 5–15% el consumo. Cada evento es proxy directo del
 *     impacto en huella de carbono — el feature original que motivó
 *     Phase 2 ("comportamiento en ruta para reducir huella").
 *
 *   - **Exceso velocidad = 2** (peso menor). Sobre el límite no
 *     consume MUCHO más combustible (curva consumo vs velocidad es
 *     plana entre 80-110 km/h). El peso menor refleja que es
 *     primariamente un riesgo de seguridad (multas, accidentes), no
 *     de eficiencia. Los carriers Verified pueden tener su propio
 *     incentivo de seguridad encima del de carbono.
 *
 *   - **Cap a 100 puntos de penalty**: un trip horrible no puede
 *     bajar el score bajo 0 (sería confuso al cliente). Si se
 *     acumulan >100 puntos, el score llega a 0 igual.
 *
 * **Ponderación por severidad — out of scope v1**:
 *
 * El campo `severity` (mG para harsh, km/h sobre límite para over)
 * NO afecta el score en v1. Justificación:
 *
 *   - El device aplica un threshold a nivel hardware antes de emitir
 *     el evento. Por construcción ya pasó el filtro "severity > X".
 *   - La distribución de severities post-threshold es aproximadamente
 *     log-normal con media cercana al threshold. Ponderar agrega
 *     complejidad sin ganancia clara para v1.
 *   - Un transportista que conteste "ese frenado fue suave" tiene
 *     argumento débil — el FMC150 ya filtró los suaves.
 *
 * Si en v2 se añade ponderación por severity, será aditivo (no rompe
 * v1): los carriers existentes verán sus scores moverse, lo cual
 * requiere comunicación pero es justificable.
 *
 * Función PURA. Sin I/O. Determinística para un input dado. Si el
 * caller quiere persistir el resultado, se hace fuera.
 */

/** Pesos por tipo de evento (puntos restados al baseline 100). */
const PESO_POR_TIPO: Readonly<Record<EventoConduccion['type'], number>> = {
  aceleracion_brusca: 5,
  frenado_brusco: 5,
  curva_brusca: 5,
  exceso_velocidad: 2,
};

/** Score baseline antes de penalizaciones. */
const SCORE_BASELINE = 100;

/** Score mínimo (cap inferior). */
const SCORE_MIN = 0;

/** Thresholds de los buckets cualitativos (UI). */
const THRESHOLD_EXCELENTE = 90;
const THRESHOLD_BUENO = 70;
const THRESHOLD_REGULAR = 50;

export function calcularScoreConduccion(input: ParametrosScore): ResultadoScore {
  const { events, tripDurationMinutes } = input;

  // Contadores por tipo. Inicializamos en 0 para garantizar shape
  // estable del desglose aunque no haya eventos de algún tipo.
  const counts = {
    aceleracionesBruscas: 0,
    frenadosBruscos: 0,
    curvasBruscas: 0,
    excesosVelocidad: 0,
  };

  let penalty = 0;
  for (const event of events) {
    penalty += PESO_POR_TIPO[event.type];
    switch (event.type) {
      case 'aceleracion_brusca':
        counts.aceleracionesBruscas += 1;
        break;
      case 'frenado_brusco':
        counts.frenadosBruscos += 1;
        break;
      case 'curva_brusca':
        counts.curvasBruscas += 1;
        break;
      case 'exceso_velocidad':
        counts.excesosVelocidad += 1;
        break;
    }
  }

  const score = Math.max(SCORE_MIN, SCORE_BASELINE - penalty);
  const nivel = bucketScore(score);

  // Eventos por hora — métrica para UI/dashboard, no para scoring.
  // Si tripDurationMinutes ≤ 0, retornamos NaN para que el caller
  // sepa "no aplica" vs un valor numérico engañoso.
  const eventosPorHora =
    tripDurationMinutes > 0 ? (events.length / tripDurationMinutes) * 60 : Number.NaN;

  return {
    score,
    nivel,
    desglose: {
      ...counts,
      penalizacionTotal: penalty,
      eventosPorHora,
    },
  };
}

function bucketScore(score: number): NivelScore {
  if (score >= THRESHOLD_EXCELENTE) {
    return 'excelente';
  }
  if (score >= THRESHOLD_BUENO) {
    return 'bueno';
  }
  if (score >= THRESHOLD_REGULAR) {
    return 'regular';
  }
  return 'malo';
}
