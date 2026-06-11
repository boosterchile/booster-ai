import { TraceExporter } from '@google-cloud/opentelemetry-cloud-trace-exporter';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import type { SpanExporter } from '@opentelemetry/sdk-trace-base';
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

  const exporter = opts.exporter ?? new TraceExporter();
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
