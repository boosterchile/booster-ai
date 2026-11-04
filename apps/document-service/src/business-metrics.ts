import { type Meter, metrics } from '@opentelemetry/api';

/**
 * Métrica de negocio del worker TED (ADR-085, principio 6 de CLAUDE.md).
 *
 * `otel-bootstrap` exporta a Cloud Monitoring (`workload.googleapis.com/`) solo
 * los meters cuyo nombre termina en `/business`. Sin `MeterProvider` registrado
 * (dev, tests) el meter es no-op.
 *
 * Con CPU solo durante requests (modo push), el export periódico puede
 * demorarse entre requests; el shutdown de OTel en SIGTERM vacía lo pendiente,
 * igual que en el api.
 */
export const BUSINESS_METER_NAME = 'booster-ai-document-service/business';

export const ENTREGAS_METRIC_NAME = 'documentos_entregas_total';

export type Transporte = 'pull' | 'push';

/**
 * Resultado de una entrega de `document.uploaded`. Los tres primeros son el
 * `ProcessOutcome` del procesamiento; los demás, rechazos antes de procesar o
 * errores que piden reintento.
 */
export type ResultadoEntrega =
  | 'decodificado'
  | 'fallido'
  | 'skipped'
  | 'malformado'
  | 'error_transitorio'
  | 'no_autorizado'
  | 'sobre_invalido';

export type RegistrarEntrega = (entrega: {
  transporte: Transporte;
  resultado: ResultadoEntrega;
}) => void;

/** Contador `documentos_entregas_total{transporte, resultado}`. */
export function createRegistrarEntrega(
  meter: Pick<Meter, 'createCounter'> = metrics.getMeter(BUSINESS_METER_NAME),
): RegistrarEntrega {
  const counter = meter.createCounter(ENTREGAS_METRIC_NAME, {
    description:
      'Entregas de document.uploaded al worker TED, por transporte (pull|push) y resultado.',
  });
  return ({ transporte, resultado }) => {
    counter.add(1, { transporte, resultado });
  };
}
