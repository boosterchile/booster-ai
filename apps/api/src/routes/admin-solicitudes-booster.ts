import type { Logger } from '@booster-ai/logger';
import { fuenteCombustibleCanSchema } from '@booster-ai/shared-schemas';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { requirePlatformAdmin } from '../middleware/require-platform-admin.js';
import { getBusinessCounter } from '../observability/business-metrics.js';
import { setResultAttributes, withBusinessSpan } from '../observability/business-span.js';
import { listarSolicitudesAbiertas, resolverSolicitud } from '../services/solicitudes-booster.js';

/**
 * Solicitudes «Pedir a Booster» en el panel de plataforma
 * (`.specs/frente2-cierre` §3.4, decisión D3 del PO).
 *
 *   GET  /admin/plataforma/solicitudes               las abiertas de todas las empresas
 *   POST /admin/plataforma/solicitudes/:id/resolver  la marca resuelta (quién y cuándo)
 */
const idSchema = z.string().uuid();
const consultas = getBusinessCounter('solicitudes_booster_consultas_total');
const resueltas = getBusinessCounter('solicitud_booster_resuelta_total');

const resolverBodySchema = z
  .object({ fuente_combustible_can: fuenteCombustibleCanSchema.optional() })
  .strict();

export function createAdminSolicitudesBoosterRoutes(opts: { db: Db; logger: Logger }): Hono {
  const app = new Hono();

  app.get('/', async (c) => {
    const admin = requirePlatformAdmin(c);
    if (!admin.ok) {
      return admin.response;
    }
    return withBusinessSpan({ name: 'solicitudes_booster.lista' }, async (span) => {
      const filas = await listarSolicitudesAbiertas(opts.db);
      setResultAttributes(span, { 'booster.solicitudes_booster.abiertas': filas.length });
      consultas.add(1, { vista: 'lista' });
      return c.json({
        solicitudes: filas.map((f) => ({
          id: f.id,
          tipo: f.tipo,
          empresa: { id: f.empresaId, nombre: f.empresaNombre },
          vehiculo:
            f.vehiculoId && f.patente != null ? { id: f.vehiculoId, patente: f.patente } : null,
          creada_en: f.creadaEn.toISOString(),
        })),
      });
    });
  });

  app.post('/:id/resolver', async (c) => {
    const admin = requirePlatformAdmin(c);
    if (!admin.ok) {
      return admin.response;
    }
    const noExiste = () =>
      c.json({ error: 'solicitud_not_found', code: 'solicitud_not_found' }, 404);
    const id = idSchema.safeParse(c.req.param('id'));
    if (!id.success) {
      return noExiste();
    }
    // Cuerpo opcional (`.specs/frente2-cierre` D3): la fuente CAN que el
    // personal de Booster configuró; se escribe en el camión al resolver.
    const crudo = await c.req.text();
    let json: unknown = {};
    if (crudo.trim() !== '') {
      try {
        json = JSON.parse(crudo);
      } catch {
        return c.json({ error: 'cuerpo_invalido', code: 'cuerpo_invalido' }, 400);
      }
    }
    const cuerpo = resolverBodySchema.safeParse(json);
    if (!cuerpo.success) {
      return c.json(
        { error: 'cuerpo_invalido', code: 'cuerpo_invalido', issues: cuerpo.error.issues },
        400,
      );
    }
    const fuente = cuerpo.data.fuente_combustible_can;
    return withBusinessSpan(
      { name: 'solicitudes_booster.resolver', attributes: { 'booster.solicitud_id': id.data } },
      async (span) => {
        const resueltaPor = admin.userContext.user.id;
        const r = await resolverSolicitud({
          db: opts.db,
          id: id.data,
          resueltaPor,
          ...(fuente ? { fuenteCombustibleCan: fuente } : {}),
        });
        setResultAttributes(span, { 'booster.solicitud.resultado': r.resultado });
        if (r.resultado === 'no_existe') {
          return noExiste();
        }
        if (r.resultado === 'ya_resuelta') {
          return c.json(
            {
              error: 'solicitud_ya_resuelta',
              code: 'solicitud_ya_resuelta',
              message: 'Otra persona de Booster ya marcó resuelta esta solicitud.',
            },
            409,
          );
        }
        const s = r.solicitud;
        resueltas.add(1, { tipo: s.tipo });
        opts.logger.info(
          { adminEmail: admin.adminEmail, solicitudId: s.id, tipo: s.tipo, empresaId: s.empresaId },
          'panel de plataforma: solicitud a Booster resuelta',
        );
        return c.json({
          solicitud: {
            id: s.id,
            tipo: s.tipo,
            estado: s.estado,
            resuelta_en: s.resueltaEn ? s.resueltaEn.toISOString() : null,
            resuelta_por: s.resueltaPor,
          },
        });
      },
    );
  });

  return app;
}
