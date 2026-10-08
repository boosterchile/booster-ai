import { z } from 'zod';

/**
 * CONTRATO CANÓNICO del topic Pub/Sub `notification-events` (T10-21).
 *
 * Productor: apps/api (enrutador de WhatsApp, flags
 * `NOTIFICATIONS_VIA_MICROSERVICE` / `NOTIFICATIONS_SHADOW`). Consumidor:
 * apps/notification-service.
 *
 *   - `modo: 'enviar'`: el servicio entrega el template vía Twilio.
 *   - `modo: 'sombra'`: el api ya lo envió directo; el servicio arma su
 *     request con su propia config y compara el hash con `hashEsperado`
 *     (`hashTwilioContentForm` de @booster-ai/whatsapp-client). Nunca envía.
 */
export const notificationEventSchema = z
  .object({
    version: z.literal(1),
    idempotencyKey: z.string().uuid(),
    canal: z.literal('whatsapp_template'),
    modo: z.enum(['enviar', 'sombra']),
    destinatario: z.string().regex(/^(whatsapp:)?\+\d+$/),
    contentSid: z.string().regex(/^HX[0-9a-fA-F]{32}$/),
    variables: z.record(z.string(), z.string()),
    hashEsperado: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional(),
    emitidoEn: z.string().datetime(),
  })
  .refine((e) => e.modo !== 'sombra' || e.hashEsperado !== undefined, {
    message: 'modo sombra exige hashEsperado',
    path: ['hashEsperado'],
  });

export type NotificationEvent = z.infer<typeof notificationEventSchema>;
