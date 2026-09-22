import type { Logger } from '@booster-ai/logger';
import {
  empresaCarbonMeasurementPatchSchema,
  empresaUmbralesRoboCombustiblePatchSchema,
} from '@booster-ai/shared-schemas';
import { zValidator } from '@hono/zod-validator';
import { eq } from 'drizzle-orm';
import type { Context } from 'hono';
import { Hono } from 'hono';
import type { Db } from '../db/client.js';
import { empresas } from '../db/schema.js';
import { getBusinessCounter } from '../observability/business-metrics.js';
import { setResultAttributes, withBusinessSpan } from '../observability/business-span.js';
import type { UserContext } from '../services/user-context.js';

/**
 * Opt-in de medición de huella a nivel empresa.
 *
 *   GET   /me/empresa  → lee `carbon_measurement_enabled` de la empresa activa
 *   PATCH /me/empresa  → activa/desactiva el flag (dueno|admin)
 *
 * El `empresa_id` sale de la membresía activa. Nunca del cliente: así no hay
 * forma de mutar el opt-in de otra empresa ni conociendo su UUID. Cierra el
 * hueco de Task 13 (`.specs/activar-opt-in-huella/`): sin este boundary el
 * cómputo T11–T13 queda siempre OFF en prod salvo SQL.
 */

const ROLES_QUE_GESTIONAN = new Set(['dueno', 'admin']);

const huellaOptInCounter = getBusinessCounter('huella_opt_in_cambios_total');
const umbralesRoboCounter = getBusinessCounter('umbrales_robo_combustible_cambios_total');

export function createMeEmpresaRoutes(opts: { db: Db; logger: Logger }): Hono {
  const app = new Hono();

  // biome-ignore lint/suspicious/noExplicitAny: hono Context genéricos.
  function requireEmpresaAdmin(c: Context<any, any, any>) {
    const userContext = c.get('userContext') as UserContext | undefined;
    if (!userContext) {
      return { ok: false as const, response: c.json({ error: 'unauthorized' }, 401) };
    }
    const activa = userContext.activeMembership;
    if (!activa) {
      return {
        ok: false as const,
        response: c.json({ error: 'forbidden', code: 'no_active_empresa' }, 403),
      };
    }
    // `empresa_id` es nullable por el CHECK XOR del schema (ADR-034).
    const empresaId = activa.membership.empresaId;
    if (!empresaId) {
      return {
        ok: false as const,
        response: c.json({ error: 'forbidden', code: 'no_es_empresa' }, 403),
      };
    }
    if (!ROLES_QUE_GESTIONAN.has(activa.membership.role)) {
      return {
        ok: false as const,
        response: c.json({ error: 'forbidden', code: 'admin_required' }, 403),
      };
    }
    return {
      ok: true as const,
      empresaId,
      actorUserId: userContext.user.id,
    };
  }

  app.get('/', async (c) => {
    const auth = requireEmpresaAdmin(c);
    if (!auth.ok) {
      return auth.response;
    }

    // rls-allowlist: scoped a la empresa de la membresía activa del caller.
    const rows = await opts.db
      .select({
        id: empresas.id,
        legalName: empresas.legalName,
        carbonMeasurementEnabled: empresas.carbonMeasurementEnabled,
        umbralRoboGolpeL: empresas.umbralRoboGolpeL,
        umbralRoboHormigaL: empresas.umbralRoboHormigaL,
      })
      .from(empresas)
      .where(eq(empresas.id, auth.empresaId))
      .limit(1);
    const row = rows[0];
    if (!row) {
      return c.json({ error: 'not_found', code: 'empresa_not_found' }, 404);
    }

    return c.json({
      id: row.id,
      legal_name: row.legalName,
      carbon_measurement_enabled: row.carbonMeasurementEnabled,
      umbral_robo_golpe_l: row.umbralRoboGolpeL ?? null,
      umbral_robo_hormiga_l: row.umbralRoboHormigaL ?? null,
    });
  });

  app.patch('/', zValidator('json', empresaCarbonMeasurementPatchSchema), async (c) => {
    const auth = requireEmpresaAdmin(c);
    if (!auth.ok) {
      return auth.response;
    }
    const body = c.req.valid('json');

    return await withBusinessSpan(
      {
        name: 'empresa.carbon_measurement',
        attributes: {
          'booster.empresa_id': auth.empresaId,
          'booster.carbon_measurement_enabled': body.carbon_measurement_enabled,
        },
      },
      async (span) => {
        // rls-allowlist: scoped a la empresa de la membresía activa del caller.
        const existingRows = await opts.db
          .select({
            id: empresas.id,
            carbonMeasurementEnabled: empresas.carbonMeasurementEnabled,
          })
          .from(empresas)
          .where(eq(empresas.id, auth.empresaId))
          .limit(1);
        const existing = existingRows[0];
        if (!existing) {
          return c.json({ error: 'not_found', code: 'empresa_not_found' }, 404);
        }

        const anterior = existing.carbonMeasurementEnabled;
        const nuevo = body.carbon_measurement_enabled;
        const unchanged = anterior === nuevo;

        if (!unchanged) {
          const updated = await opts.db
            .update(empresas)
            .set({ carbonMeasurementEnabled: nuevo, updatedAt: new Date() })
            .where(eq(empresas.id, auth.empresaId))
            .returning({
              id: empresas.id,
              carbonMeasurementEnabled: empresas.carbonMeasurementEnabled,
            });
          if (!updated[0]) {
            opts.logger.error(
              { empresaId: auth.empresaId, nuevo },
              'me-empresa: UPDATE carbon_measurement_enabled no devolvió fila',
            );
            return c.json(
              { error: 'internal_server_error', code: 'carbon_measurement_update_failed' },
              500,
            );
          }
        }

        opts.logger.info(
          {
            empresaId: auth.empresaId,
            carbonMeasurementEnabledAnterior: anterior,
            carbonMeasurementEnabledNuevo: nuevo,
            unchanged,
            actorUserId: auth.actorUserId,
          },
          unchanged
            ? 'me-empresa: opt-in huella sin cambio (idempotente)'
            : 'me-empresa: opt-in huella actualizado',
        );

        huellaOptInCounter.add(1, {
          enabled: String(nuevo),
          unchanged: String(unchanged),
        });
        setResultAttributes(span, {
          'booster.carbon_measurement_enabled_anterior': anterior,
          'booster.carbon_measurement.unchanged': unchanged,
        });

        return c.json({
          ok: true,
          id: auth.empresaId,
          carbon_measurement_enabled: nuevo,
          carbon_measurement_enabled_anterior: anterior,
          unchanged,
        });
      },
    );
  });

  app.patch(
    '/umbrales-combustible',
    zValidator('json', empresaUmbralesRoboCombustiblePatchSchema),
    async (c) => {
      const auth = requireEmpresaAdmin(c);
      if (!auth.ok) {
        return auth.response;
      }
      const body = c.req.valid('json');

      return await withBusinessSpan(
        {
          name: 'empresa.umbrales_robo_combustible',
          attributes: { 'booster.empresa_id': auth.empresaId },
        },
        async (span) => {
          // rls-allowlist: scoped a la empresa de la membresía activa del caller.
          const existingRows = await opts.db
            .select({
              id: empresas.id,
              umbralRoboGolpeL: empresas.umbralRoboGolpeL,
              umbralRoboHormigaL: empresas.umbralRoboHormigaL,
            })
            .from(empresas)
            .where(eq(empresas.id, auth.empresaId))
            .limit(1);
          const existing = existingRows[0];
          if (!existing) {
            return c.json({ error: 'not_found', code: 'empresa_not_found' }, 404);
          }

          const golpe =
            body.umbral_robo_golpe_l === undefined
              ? existing.umbralRoboGolpeL
              : body.umbral_robo_golpe_l;
          const hormiga =
            body.umbral_robo_hormiga_l === undefined
              ? existing.umbralRoboHormigaL
              : body.umbral_robo_hormiga_l;
          const unchanged =
            golpe === existing.umbralRoboGolpeL && hormiga === existing.umbralRoboHormigaL;

          if (!unchanged) {
            const updated = await opts.db
              .update(empresas)
              .set({
                umbralRoboGolpeL: golpe,
                umbralRoboHormigaL: hormiga,
                updatedAt: new Date(),
              })
              .where(eq(empresas.id, auth.empresaId))
              .returning({
                id: empresas.id,
                umbralRoboGolpeL: empresas.umbralRoboGolpeL,
                umbralRoboHormigaL: empresas.umbralRoboHormigaL,
              });
            if (!updated[0]) {
              opts.logger.error(
                { empresaId: auth.empresaId, golpe, hormiga },
                'me-empresa: UPDATE umbrales de robo no devolvió fila',
              );
              return c.json(
                { error: 'internal_server_error', code: 'umbrales_robo_update_failed' },
                500,
              );
            }
          }

          opts.logger.info(
            {
              empresaId: auth.empresaId,
              umbralRoboGolpeL: golpe,
              umbralRoboHormigaL: hormiga,
              unchanged,
              actorUserId: auth.actorUserId,
            },
            unchanged
              ? 'me-empresa: umbrales de robo sin cambio (idempotente)'
              : 'me-empresa: umbrales de robo actualizados',
          );
          umbralesRoboCounter.add(1, { unchanged: String(unchanged) });
          setResultAttributes(span, {
            'booster.umbral_robo_golpe_l': golpe ?? undefined,
            'booster.umbral_robo_hormiga_l': hormiga ?? undefined,
            'booster.umbrales_robo.unchanged': unchanged,
          });

          return c.json({
            ok: true,
            id: auth.empresaId,
            umbral_robo_golpe_l: golpe,
            umbral_robo_hormiga_l: hormiga,
            unchanged,
          });
        },
      );
    },
  );

  return app;
}
