import { TraceExporter } from '@google-cloud/opentelemetry-cloud-trace-exporter';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import type { ExportResult } from '@opentelemetry/core';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

/**
 * Bootstrap de OpenTelemetry para los servicios Booster (spec
 * feat-otel-bootstrap; auditoría 2026-06-09: las deps OTel existían sin
 * un solo import — la regla "cada endpoint tiene span" no se cumplía en
 * ninguno).
 *
 * USO (obligatorio así, no de otra forma): cada servicio tiene un
 * `src/instrumentation.ts` que llama `initOtel(...)`, compilado como
 * entry propio, y el Dockerfile arranca con
 * `node --import ./dist/instrumentation.js dist/main.js`. En ESM la
 * auto-instrumentación DEBE cargarse antes de que los módulos a
 * instrumentar evalúen — importarla dentro de main.ts NO funciona (esa
 * era exactamente la causa raíz de que nunca se inicializara).
 *
 * Exporta directo a Cloud Trace vía ADC (cero collector, cero API keys —
 * consistente con ADR-037/038). Sin GOOGLE_CLOUD_PROJECT es no-op:
 * dev/CI no requieren GCP. El SA runtime ya tiene roles/cloudtrace.agent
 * (infrastructure/iam.tf).
 */

export interface InitOtelOptions {
  serviceName: string;
  serviceVersion?: string;
  /** Override para tests — evita instanciar el exporter real de GCP. */
  exporter?: SpanExporter;
}

export interface InitOtelResult {
  started: boolean;
  reason?: string;
}

/**
 * Credenciales en query strings que la auto-instrumentación HTTP captura
 * en atributos de URL (http.url/http.target/url.query/url.full). El caso
 * real del repo: el SSE del chat pasa el Firebase ID token como
 * `?auth=<JWT>` (EventSource no soporta headers) — sin scrubbing, cada
 * request al stream exportaría una credencial bearer viva a Cloud Trace
 * (review security 2026-06-11, BLOQUEANTE). Se redacta el VALOR de los
 * params sensibles en todo atributo string antes de exportar.
 */
const SENSITIVE_QUERY_PARAMS =
  /((?:^|[?&])(?:auth|token|access_token|key|signature|code)=)[^&\s"']+/gi;

export class RedactingSpanExporter implements SpanExporter {
  constructor(private readonly inner: SpanExporter) {}

  export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
    for (const span of spans) {
      const attrs = span.attributes as Record<string, unknown>;
      for (const [k, v] of Object.entries(attrs)) {
        if (typeof v === 'string' && v.includes('=')) {
          attrs[k] = v.replace(SENSITIVE_QUERY_PARAMS, '$1[REDACTED]');
        }
      }
    }
    this.inner.export(spans, resultCallback);
  }

  shutdown(): Promise<void> {
    return this.inner.shutdown();
  }

  forceFlush(): Promise<void> {
    return this.inner.forceFlush?.() ?? Promise.resolve();
  }
}

let sdk: NodeSDK | null = null;

export function initOtel(opts: InitOtelOptions): InitOtelResult {
  if (sdk) {
    return { started: true, reason: 'already_started' };
  }
  const project = process.env.GOOGLE_CLOUD_PROJECT;
  if (!project && !opts.exporter) {
    // Dev/test sin GCP: no-op deliberado, jamás romper el arranque.
    return { started: false, reason: 'no_google_cloud_project' };
  }

  const exporter = new RedactingSpanExporter(opts.exporter ?? new TraceExporter());
  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: opts.serviceName,
      [ATTR_SERVICE_VERSION]: opts.serviceVersion ?? process.env.SERVICE_VERSION ?? '0.0.0-dev',
    }),
    traceExporter: exporter,
    instrumentations: [
      getNodeAutoInstrumentations({
        // Ruidosas y sin valor en este stack — fuera del hot path.
        '@opentelemetry/instrumentation-fs': { enabled: false },
        '@opentelemetry/instrumentation-dns': { enabled: false },
      }),
    ],
  });
  sdk.start();

  // Flush de spans pendientes en el shutdown de Cloud Run/GKE.
  process.once('SIGTERM', () => {
    void sdk?.shutdown().catch(() => {
      /* el shutdown best-effort jamás bloquea la salida */
    });
  });

  return { started: true };
}

/** Solo para tests: resetea el singleton. */
export async function shutdownOtelForTests(): Promise<void> {
  if (sdk) {
    await sdk.shutdown().catch(() => undefined);
    sdk = null;
  }
}
