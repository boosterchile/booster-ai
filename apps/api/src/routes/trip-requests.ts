import type { Logger } from '@booster-ai/logger';
import {
  generateTrackingCode,
  trackingCodeSchema,
  whatsAppIntakeCreateInputSchema,
} from '@booster-ai/shared-schemas';
import { zValidator } from '@hono/zod-validator';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Db } from '../db/client.js';
import { whatsAppIntakeDrafts } from '../db/schema.js';

/**
 * Endpoints de trip requests — consumidos SOLO por apps/whatsapp-bot en el thin
 * slice. Ambos endpoints van protegidos por auth middleware aplicado en server.ts.
 *
 * POST /trip-requests      — crea un draft desde el intake del bot
 * GET  /trip-requests/:code — lookup por tracking code (para follow-up queries)
 */
export function createTripRequestsRoutes(opts: { db: Db; logger: Logger }) {
  const { db, logger } = opts;
  const app = new Hono();

  app.post('/', zValidator('json', whatsAppIntakeCreateInputSchema), async (c) => {
    const input = c.req.valid('json');

    // Retry loop para tracking code en caso de colisión UNIQUE (paradoja del
    // cumpleaños a ~47K TRs). Max 5 intentos antes de rendirnos.
    const MAX_RETRIES = 5;
    let lastError: unknown;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
      const trackingCode = generateTrackingCode();
      try {
        const [row] = await db
          .insert(whatsAppIntakeDrafts)
          .values({
            trackingCode,
            shipperWhatsapp: input.shipper_whatsapp,
            originAddressRaw: input.origin_address_raw,
            destinationAddressRaw: input.destination_address_raw,
            cargoType: input.cargo_type,
            pickupDateRaw: input.pickup_date_raw,
            status: 'captured',
          })
          .returning();

        if (!row) {
          // Imposible con Drizzle + returning(), pero TypeScript no lo sabe.
          throw new Error('Insert returned no rows');
        }

        logger.info(
          {
            trackingCode: row.trackingCode,
            cargoType: row.cargoType,
            // shipperWhatsapp NO se logea (redacted por logger.redactionPaths)
          },
          'WhatsApp intake draft created',
        );

        return c.json(
          {
            tracking_code: row.trackingCode,
            id: row.id,
            status: row.status,
            created_at: row.createdAt.toISOString(),
          },
          201,
        );
      } catch (err) {
        lastError = err;
        // Unique violation de Postgres → retry con nuevo code.
        // Cualquier otro error → abortar.
        if (!isUniqueViolation(err)) {
          logger.error({ err }, 'Failed to create intake draft');
          return c.json({ error: 'internal_server_error' }, 500);
        }
        logger.warn({ attempt }, 'Tracking code collision, retrying');
      }
    }
    logger.error({ lastError }, 'Exhausted tracking code retries');
    return c.json({ error: 'tracking_code_collision' }, 503);
  });

  app.get('/:code', async (c) => {
    const code = c.req.param('code');
    const parsed = trackingCodeSchema.safeParse(code);
    if (!parsed.success) {
      return c.json({ error: 'invalid_tracking_code_format' }, 400);
    }

    const rows = await db
      .select()
      .from(whatsAppIntakeDrafts)
      .where(eq(whatsAppIntakeDrafts.trackingCode, parsed.data))
      .limit(1);

    const row = rows[0];
    if (!row) {
      return c.json({ error: 'not_found' }, 404);
    }

    return c.json({
      id: row.id,
      tracking_code: row.trackingCode,
      cargo_type: row.cargoType,
      origin_address_raw: row.originAddressRaw,
      destination_address_raw: row.destinationAddressRaw,
      pickup_date_raw: row.pickupDateRaw,
      status: row.status,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString(),
    });
  });

  return app;
}

function isUniqueViolation(err: unknown): boolean {
  // pg error code 23505: unique_violation
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === '23505'
  );
}
