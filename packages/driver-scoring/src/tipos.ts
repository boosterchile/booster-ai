/**
 * Tipos compartidos del package @booster-ai/driver-scoring.
 *
 * Naming espejo de la tabla DB `eventos_conduccion_verde`
 * (apps/api/src/db/schema.ts) — los string literals son el enum SQL
 * `tipo_evento_conduccion`. Si cambia un lado, actualizar el otro.
 */

/**
 * Tipo de evento de conducción capturado por el FMC150 vía IO 253/255.
 *
 *   - aceleracion_brusca: harsh acceleration (IO 253 value=1)
 *   - frenado_brusco: harsh braking (IO 253 value=2)
 *   - curva_brusca: harsh cornering (IO 253 value=3)
 *   - exceso_velocidad: over-speeding (IO 255)
 */
export type TipoEvento =
  | 'aceleracion_brusca'
  | 'frenado_brusco'
  | 'curva_brusca'
  | 'exceso_velocidad';

/**
 * Un evento individual ya cargado de la DB (o passed in para test).
 *
 * `severity` está en su unidad nativa (mG para harsh, km/h para over).
 * En esta versión del scoring v1 no se usa para ponderar — todos los
 * eventos del mismo tipo cuentan igual. Se persiste de todas formas
 * para análisis post-hoc + futuras versiones que ponderen por
 * intensidad.
 */
export interface EventoConduccion {
  type: TipoEvento;
  /** mG (harsh) o km/h (exceso). */
  severity: number;
  /** Timestamp del evento, epoch ms. Para ordering + análisis temporal. */
  timestampMs: number;
}

/**
 * Nivel cualitativo del score, derivado del número:
 *   - excelente: ≥ 90
 *   - bueno: 70–89
 *   - regular: 50–69
 *   - malo: < 50
 *
 * Útil para badges de UI sin que el dashboard tenga que duplicar la
 * lógica de bucketización.
 */
export type NivelScore = 'excelente' | 'bueno' | 'regular' | 'malo';

/**
 * Resultado del cálculo de score. Score normalizado a [0, 100], con
 * desglose para auditoría + UI.
 */
export interface ResultadoScore {
  /** Score 0–100. 100 = sin eventos, sin penalización. */
  score: number;

  nivel: NivelScore;

  /**
   * Desglose detallado para la UI y para auditoría del cálculo.
   * El cliente puede mostrar "12 frenados bruscos · 3 excesos de
   * velocidad" sin re-procesar la lista de eventos.
   */
  desglose: {
    aceleracionesBruscas: number;
    frenadosBruscos: number;
    curvasBruscas: number;
    excesosVelocidad: number;
    /** Suma de penalizaciones aplicadas (antes del cap a 100). */
    penalizacionTotal: number;
    /**
     * Eventos por hora del trip — métrica normalizada para comparar
     * trips de duraciones distintas. NaN si tripDurationMinutes ≤ 0.
     */
    eventosPorHora: number;
  };
}

/**
 * Parámetros de entrada del scoring.
 */
export interface ParametrosScore {
  /** Lista de eventos extraídos para el viaje (cualquier orden). */
  events: readonly EventoConduccion[];
  /**
   * Duración del viaje en minutos. Solo se usa para calcular
   * `eventosPorHora` (métrica de la UI, no afecta el score). Si es 0
   * o negativo, eventosPorHora = NaN para que el caller lo trate como
   * "no aplica".
   */
  tripDurationMinutes: number;
}
