/**
 * Servidor HTTP del worker TED: probes de Cloud Run y endpoint push de
 * `document.uploaded` (ADR-085).
 *
 *   GET  /health                     → 200 (startup y liveness probes).
 *   POST /pubsub/document-uploaded   → push de Pub/Sub. 204 = ack; 500 = nack
 *                                      (reintento con backoff, DLQ tras 5);
 *                                      401 = token inválido (también reintenta).
 *
 * Un sobre o un mensaje fuera de contrato se confirma (204) y se registra como
 * error: es un dato malo que ningún reintento arregla, igual que en modo pull.
 */

import type { IncomingMessage, RequestListener, ServerResponse } from 'node:http';
import type { Logger } from '@booster-ai/logger';
import { z } from 'zod';
import type { DocumentUploadedHandler } from './handle-document-uploaded.js';
import type { PushTokenVerifier } from './push-auth.js';

export const PUSH_PATH = '/pubsub/document-uploaded';

/**
 * Tope del body. Un `document.uploaded` pesa ~250 bytes (4 campos); el sobre de
 * Pub/Sub lo pasa a base64 y agrega metadatos. Lo que exceda esto no es un
 * mensaje del api.
 */
export const MAX_PUSH_BODY_BYTES = 64 * 1024;

/** Sobre JSON del push "con wrapper" de Pub/Sub. */
export const pushEnvelopeSchema = z.object({
  message: z.object({
    /** Payload en base64. */
    data: z.string(),
    messageId: z.string().min(1),
    publishTime: z.string().optional(),
    attributes: z.record(z.string()).optional(),
  }),
  subscription: z.string().min(1),
  /** Presente cuando la suscripción tiene DLQ (messaging.tf). */
  deliveryAttempt: z.number().int().positive().optional(),
});

export interface HttpHandlerOptions {
  logger: Logger;
  /** Sin esta opción el endpoint push responde 404 (no hay SA contra el cual validar). */
  push?: {
    verifyToken: PushTokenVerifier;
    handleMessage: DocumentUploadedHandler;
  };
}

type BodyResult = { tooLarge: false; body: string } | { tooLarge: true; bytes: number };

/** Lee el body entero; pasado el tope sigue drenando pero descarta los bytes. */
function readBody(req: IncomingMessage, maxBytes: number): Promise<BodyResult> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    req.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes <= maxBytes) {
        chunks.push(chunk);
      }
    });
    req.on('end', () => {
      resolve(
        bytes > maxBytes
          ? { tooLarge: true, bytes }
          : { tooLarge: false, body: Buffer.concat(chunks).toString('utf-8') },
      );
    });
    req.on('error', reject);
  });
}

function send(res: ServerResponse, status: number, body?: unknown): void {
  if (body === undefined) {
    res.writeHead(status);
    res.end();
    return;
  }
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function handlePush(
  req: IncomingMessage,
  res: ServerResponse,
  logger: Logger,
  push: NonNullable<HttpHandlerOptions['push']>,
): Promise<void> {
  // Autenticar antes de leer el body: un request ajeno no consume memoria.
  if (!(await push.verifyToken(req.headers.authorization))) {
    send(res, 401, { error: 'unauthorized' });
    return;
  }

  const read = await readBody(req, MAX_PUSH_BODY_BYTES);
  if (read.tooLarge) {
    logger.error(
      { bytes: read.bytes, maxBytes: MAX_PUSH_BODY_BYTES },
      'push document.uploaded excede el tope, ack para descartar (no reintentar)',
    );
    send(res, 204);
    return;
  }

  let crudo: unknown;
  try {
    crudo = JSON.parse(read.body);
  } catch {
    crudo = undefined;
  }
  const envelope = pushEnvelopeSchema.safeParse(crudo);
  if (!envelope.success) {
    logger.error(
      { errors: envelope.error.issues, bodyPreview: read.body.slice(0, 200) },
      'push document.uploaded con sobre inválido, ack para descartar (no reintentar)',
    );
    send(res, 204);
    return;
  }

  const decision = await push.handleMessage({
    data: Buffer.from(envelope.data.message.data, 'base64'),
    messageId: envelope.data.message.messageId,
    deliveryAttempt: envelope.data.deliveryAttempt,
  });
  send(res, decision === 'ack' ? 204 : 500);
}

export function createHttpHandler(opts: HttpHandlerOptions): RequestListener {
  const { logger, push } = opts;

  return (req, res) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;

    if (req.method === 'GET' && path === '/health') {
      send(res, 200, { status: 'ok', service: 'document-service' });
      return;
    }

    if (req.method === 'POST' && path === PUSH_PATH && push !== undefined) {
      handlePush(req, res, logger, push).catch((err: unknown) => {
        // El handler de mensajes no lanza (decide ack/nack); esto cubre un
        // fallo del propio transporte (socket cortado, verificador roto).
        logger.error({ err }, 'push document.uploaded: error inesperado, nack para reintento');
        if (!res.headersSent) {
          send(res, 500, { error: 'internal' });
        }
      });
      return;
    }

    send(res, 404);
  };
}
