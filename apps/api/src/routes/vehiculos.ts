import type { Logger } from '@booster-ai/logger';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Db } from '../db/client.js';
import { vehicles } from '../db/schema.js';

/**
 * Endpoints de vehículos (lectura por ahora; CRUD completo viene después
 * con UI dedicada).
 *
 *   GET /vehiculos → lista los vehículos de la empresa activa
 */
export function createVehiculosRoutes(opts: { db: Db; logger: Logger }) {
  const app = new Hono();

  app.get('/', async (c) => {
    const userContext = c.get('userContext');
    if (!userContext) {
      return c.json({ error: 'unauthorized' }, 401);
    }
    const active = userContext.activeMembership;
    if (!active) {
      return c.json({ error: 'no_active_empresa', code: 'no_active_empresa' }, 403);
    }

    const rows = await opts.db
      .select({
        id: vehicles.id,
        plate: vehicles.plate,
        type: vehicles.vehicleType,
        capacity_kg: vehicles.capacityKg,
        year: vehicles.year,
        brand: vehicles.brand,
        model: vehicles.model,
        fuel_type: vehicles.fuelType,
        teltonika_imei: vehicles.teltonikaImei,
        status: vehicles.vehicleStatus,
      })
      .from(vehicles)
      .where(eq(vehicles.empresaId, active.empresa.id));

    return c.json({ vehicles: rows });
  });

  return app;
}
