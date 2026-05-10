import type { Logger } from '@booster-ai/logger';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { z } from 'zod';
import { config as appConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { adelantosCarrier } from '../db/schema.js';
import type { UserContext } from '../services/user-context.js';

/**
 * Endpoints admin de "Booster Cobra Hoy" (ADR-029 + ADR-032).
 *
 * Audiencia: operadores de Booster Chile SpA, NO admins de empresa
 * carrier. Auth se hace contra `BOOSTER_PLATFORM_ADMIN_EMAILS` (allowlist
 * por email — ver config.ts).
 *
 *   GET  /admin/cobra-hoy/adelantos?status=...&empresa_carrier_id=...
 *   POST /admin/cobra-hoy/adelantos/:id/transicionar
 *        body { target_status, notas? }
 *
 * Las transiciones soportadas modelan el flujo manual mientras el
 * partner real (Toctoc/Mafin/etc) no esté integrado:
 *   - solicitado    → aprobado | rechazado | cancelado
 *   - aprobado      → desembolsado | cancelado | rechazado
 *   - desembolsado  → cobrado_a_shipper | mora
 *   - mora          → cobrado_a_shipper | cancelado
 *
 * `desembolsado` y `cobrado_a_shipper` capturan timestamp automático
 * (`desembolsado_en`, `cobrado_a_shipper_en`).
 */

type AdelantoStatus =
  | 'solicitado'
  | 'aprobado'
  | 'desembolsado'
  | 'cobrado_a_shipper'
  | 'mora'
  | 'cancelado'
  | 'rechazado';

const TRANSICIONES_VALIDAS: Record<AdelantoStatus, AdelantoStatus[]> = {
  solicitado: ['aprobado', 'rechazado', 'cancelado'],
  aprobado: ['desembolsado', 'cancelado', 'rechazado'],
  desembolsado: ['cobrado_a_shipper', 'mora'],
  cobrado_a_shipper: [],
  mora: ['cobrado_a_shipper', 'cancelado'],
  cancelado: [],
  rechazado: [],
};

const transicionarBodySchema = z.object({
  target_status: z.enum([
    'aprobado',
    'desembolsado',
    'cobrado_a_shipper',
    'mora',
    'cancelado',
    'rechazado',
  ]),
  notas: z.string().min(1).max(1000).optional(),
});

const statusQuerySchema = z.enum([
  'solicitado',
  'aprobado',
  'desembolsado',
  'cobrado_a_shipper',
  'mora',
  'cancelado',
  'rechazado',
]);

export function createAdminCobraHoyRoutes(opts: { db: Db; logger: Logger }) {
  const app = new Hono();

  // biome-ignore lint/suspicious/noExplicitAny: hono Context genéricos.
  function requirePlatformAdmin(c: Context<any, any, any>) {
    if (!appConfig.FACTORING_V1_ACTIVATED) {
      return {
        ok: false as const,
        response: c.json({ error: 'feature_disabled' }, 503),
      };
    }
    const userContext = c.get('userContext') as UserContext | undefined;
    if (!userContext) {
      return { ok: false as const, response: c.json({ error: 'unauthorized' }, 401) };
    }
    const email = userContext.user.email?.toLowerCase();
    const allowlist = appConfig.BOOSTER_PLATFORM_ADMIN_EMAILS;
    if (!email || !allowlist.includes(email)) {
      return {
        ok: false as const,
        response: c.json({ error: 'forbidden_platform_admin' }, 403),
      };
    }
    return { ok: true as const, userContext, adminEmail: email };
  }

  // GET /admin/cobra-hoy/adelantos
  app.get('/adelantos', async (c) => {
    const auth = requirePlatformAdmin(c);
    if (!auth.ok) {
      return auth.response;
    }

    const statusParam = c.req.query('status');
    const empresaCarrierIdParam = c.req.query('empresa_carrier_id');
    const empresaShipperIdParam = c.req.query('empresa_shipper_id');

    let statusFilter: AdelantoStatus | undefined;
    if (statusParam) {
      const parsed = statusQuerySchema.safeParse(statusParam);
      if (!parsed.success) {
        return c.json({ error: 'invalid_status' }, 400);
      }
      statusFilter = parsed.data;
    }

    const conditions = [] as ReturnType<typeof eq>[];
    if (statusFilter) {
      conditions.push(eq(adelantosCarrier.status, statusFilter));
    }
    if (empresaCarrierIdParam) {
      conditions.push(eq(adelantosCarrier.empresaCarrierId, empresaCarrierIdParam));
    }
    if (empresaShipperIdParam) {
      conditions.push(eq(adelantosCarrier.empresaShipperId, empresaShipperIdParam));
    }

    // rls-allowlist: admin platform-wide query — solo accesible vía requirePlatformAdmin allowlist.
    const baseQuery = opts.db.select().from(adelantosCarrier);
    const filteredQuery = conditions.length > 0 ? baseQuery.where(and(...conditions)) : baseQuery;
    const rows = await filteredQuery.orderBy(desc(adelantosCarrier.createdAt)).limit(500);

    return c.json({
      adelantos: rows.map((r) => ({
        id: r.id,
        asignacion_id: r.asignacionId,
        liquidacion_id: r.liquidacionId,
        empresa_carrier_id: r.empresaCarrierId,
        empresa_shipper_id: r.empresaShipperId,
        monto_neto_clp: r.montoNetoClp,
        plazo_dias_shipper: r.plazoDiasShipper,
        tarifa_pct: Number(r.tarifaPct),
        tarifa_clp: r.tarifaClp,
        monto_adelantado_clp: r.montoAdelantadoClp,
        status: r.status,
        factoring_methodology_version: r.factoringMethodologyVersion,
        desembolsado_en: r.desembolsadoEn?.toISOString() ?? null,
        cobrado_a_shipper_en: r.cobradoAShipperEn?.toISOString() ?? null,
        notas_admin: r.notasAdmin,
        creado_en: r.createdAt.toISOString(),
      })),
    });
  });

  // POST /admin/cobra-hoy/adelantos/:id/transicionar
  app.post('/adelantos/:id/transicionar', async (c) => {
    const auth = requirePlatformAdmin(c);
    if (!auth.ok) {
      return auth.response;
    }
    const adelantoId = c.req.param('id');
    let body: z.infer<typeof transicionarBodySchema>;
    try {
      const json = await c.req.json();
      const parsed = transicionarBodySchema.safeParse(json);
      if (!parsed.success) {
        return c.json({ error: 'invalid_body', details: parsed.error.format() }, 400);
      }
      body = parsed.data;
    } catch {
      return c.json({ error: 'invalid_json' }, 400);
    }

    const rows = await opts.db
      .select({
        id: adelantosCarrier.id,
        status: adelantosCarrier.status,
      })
      // rls-allowlist: admin platform-wide query — protegido por requirePlatformAdmin.
      .from(adelantosCarrier)
      .where(eq(adelantosCarrier.id, adelantoId))
      .limit(1);
    const current = rows[0];
    if (!current) {
      return c.json({ error: 'adelanto_not_found' }, 404);
    }

    const currentStatus = current.status as AdelantoStatus;
    const allowedTargets = TRANSICIONES_VALIDAS[currentStatus];
    if (!allowedTargets.includes(body.target_status)) {
      return c.json(
        {
          error: 'transicion_invalida',
          current_status: currentStatus,
          target_status: body.target_status,
          allowed_targets: allowedTargets,
        },
        409,
      );
    }

    const now = new Date();
    const updates: Record<string, unknown> = {
      status: body.target_status,
      updatedAt: now,
    };
    if (body.target_status === 'desembolsado') {
      updates.desembolsadoEn = now;
    }
    if (body.target_status === 'cobrado_a_shipper') {
      updates.cobradoAShipperEn = now;
    }
    if (body.notas !== undefined) {
      const tag = `[${now.toISOString()} ${auth.adminEmail}]`;
      updates.notasAdmin = sql`coalesce(${adelantosCarrier.notasAdmin} || E'\n', '') || ${`${tag} ${body.notas}`}`;
    }

    // rls-allowlist: admin platform-wide update — protegido por requirePlatformAdmin.
    const updated = await opts.db
      .update(adelantosCarrier)
      .set(updates)
      .where(eq(adelantosCarrier.id, adelantoId))
      .returning({
        id: adelantosCarrier.id,
        status: adelantosCarrier.status,
        desembolsadoEn: adelantosCarrier.desembolsadoEn,
        cobradoAShipperEn: adelantosCarrier.cobradoAShipperEn,
      });
    const after = updated[0];
    if (!after) {
      return c.json({ error: 'update_failed' }, 500);
    }

    opts.logger.info(
      {
        adelantoId,
        from: currentStatus,
        to: after.status,
        adminEmail: auth.adminEmail,
      },
      'admin cobra-hoy: transición aplicada',
    );

    return c.json({
      ok: true,
      adelanto_id: after.id,
      status: after.status,
      desembolsado_en: after.desembolsadoEn?.toISOString() ?? null,
      cobrado_a_shipper_en: after.cobradoAShipperEn?.toISOString() ?? null,
    });
  });

  return app;
}
