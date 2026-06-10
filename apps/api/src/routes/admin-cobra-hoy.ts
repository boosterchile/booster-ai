import type { Logger } from '@booster-ai/logger';
import { and, desc, eq, gt, sql } from 'drizzle-orm';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { z } from 'zod';
import { config as appConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { adelantosCarrier, shipperCreditDecisions } from '../db/schema.js';
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

    const now = new Date();

    // Transacción con locks de fila (review 2026-06-10, hallazgo ALTO de
    // security-auditor + code-reviewer): la validación de transición y el
    // delta de exposición corren sobre el estado LEÍDO BAJO LOCK — dos
    // requests concurrentes (doble click, retry) no pueden aplicar el
    // delta dos veces. Orden de locks: adelanto → decisión (cobraHoy no
    // lockea en orden inverso; sin AB-BA).
    //
    // Exposición crediticia (ADR-029 §3, spec fix-factoring-exposicion-y-flag):
    // `desembolsado` consume cupo del shipper y EXIGE decisión vigente
    // (sin ella → 422, el crédito no se puede consumir contra nada);
    // `cobrado_a_shipper` libera cupo con piso 0 (si no hay decisión
    // vigente, el dinero igual volvió: warn y seguir). La decisión vigente
    // es única por shipper (unique parcial uq_shipper_credit_decisions_vigente).
    const txResult = await opts.db.transaction(async (tx) => {
      // rls-allowlist: admin platform-wide query — protegido por requirePlatformAdmin.
      const lockedRows = await tx
        .select({
          id: adelantosCarrier.id,
          status: adelantosCarrier.status,
          empresaShipperId: adelantosCarrier.empresaShipperId,
          montoAdelantadoClp: adelantosCarrier.montoAdelantadoClp,
        })
        .from(adelantosCarrier)
        .where(eq(adelantosCarrier.id, adelantoId))
        .for('update')
        .limit(1);
      const locked = lockedRows[0];
      if (!locked) {
        return { kind: 'not_found' as const };
      }

      const lockedStatus = locked.status as AdelantoStatus;
      const allowedTargets = TRANSICIONES_VALIDAS[lockedStatus];
      if (!allowedTargets.includes(body.target_status)) {
        return {
          kind: 'conflict' as const,
          currentStatus: lockedStatus,
          allowedTargets,
        };
      }

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

      // CAS: el WHERE re-exige el status leído bajo lock. Con el FOR
      // UPDATE es redundante en Postgres, pero deja el invariante en el
      // SQL (defensa si alguien quita el lock).
      // rls-allowlist: admin platform-wide update — protegido por requirePlatformAdmin.
      const updated = await tx
        .update(adelantosCarrier)
        .set(updates)
        .where(and(eq(adelantosCarrier.id, adelantoId), eq(adelantosCarrier.status, lockedStatus)))
        .returning({
          id: adelantosCarrier.id,
          status: adelantosCarrier.status,
          desembolsadoEn: adelantosCarrier.desembolsadoEn,
          cobradoAShipperEn: adelantosCarrier.cobradoAShipperEn,
        });
      const after = updated[0];
      if (!after) {
        return { kind: 'conflict' as const, currentStatus: lockedStatus, allowedTargets };
      }

      if (body.target_status !== 'desembolsado' && body.target_status !== 'cobrado_a_shipper') {
        return { kind: 'ok' as const, after, lockedStatus, locked, exposure: null };
      }

      // rls-allowlist: admin platform-wide query — protegido por requirePlatformAdmin.
      const decisionRows = await tx
        .select({
          id: shipperCreditDecisions.id,
          currentExposureClp: shipperCreditDecisions.currentExposureClp,
        })
        .from(shipperCreditDecisions)
        .where(
          and(
            eq(shipperCreditDecisions.empresaShipperId, locked.empresaShipperId),
            eq(shipperCreditDecisions.approved, true),
            gt(shipperCreditDecisions.expiresAt, sql`now()`),
          ),
        )
        .for('update')
        .limit(1);
      const decision = decisionRows[0];

      if (!decision) {
        if (body.target_status === 'desembolsado') {
          // Consumir crédito sin decisión vigente = desembolso sin tope.
          // Tx aborta (rollback del cambio de estado) → 422.
          return { kind: 'no_decision' as const, locked };
        }
        return { kind: 'ok' as const, after, lockedStatus, locked, exposure: { updated: false } };
      }

      const monto = locked.montoAdelantadoClp;
      const before = decision.currentExposureClp;
      const afterExposure =
        body.target_status === 'desembolsado' ? before + monto : Math.max(0, before - monto);
      // Piso 0 al cobrar: si recorta (decisión rotada entre desembolso y
      // cobro), queda registrado — un clamp silencioso esconde sub-conteo.
      const clamped = body.target_status === 'cobrado_a_shipper' && before < monto;

      // rls-allowlist: admin platform-wide update — protegido por requirePlatformAdmin.
      await tx
        .update(shipperCreditDecisions)
        .set({ currentExposureClp: afterExposure, updatedAt: now })
        .where(eq(shipperCreditDecisions.id, decision.id));

      return {
        kind: 'ok' as const,
        after,
        lockedStatus,
        locked,
        exposure: { updated: true, before, after: afterExposure, clamped },
      };
    });

    if (txResult.kind === 'not_found') {
      return c.json({ error: 'adelanto_not_found' }, 404);
    }
    if (txResult.kind === 'conflict') {
      return c.json(
        {
          error: 'transicion_invalida',
          current_status: txResult.currentStatus,
          target_status: body.target_status,
          allowed_targets: txResult.allowedTargets,
        },
        409,
      );
    }
    if (txResult.kind === 'no_decision') {
      opts.logger.warn(
        {
          adelantoId,
          empresaShipperId: txResult.locked.empresaShipperId,
          montoAdelantadoClp: txResult.locked.montoAdelantadoClp,
        },
        'admin cobra-hoy: desembolso RECHAZADO — shipper sin decisión crediticia vigente',
      );
      return c.json(
        {
          error: 'shipper_sin_decision_vigente',
          code: 'shipper_sin_decision_vigente',
          detail:
            'No se puede desembolsar sin una decisión crediticia aprobada y vigente del shipper (el límite no tendría contra qué validarse).',
        },
        422,
      );
    }

    const { after, lockedStatus, locked, exposure } = txResult;

    if (exposure && exposure.updated === false) {
      // Cobro sin decisión vigente: el dinero volvió igual; el cupo no
      // tenía fila donde reflejarse.
      opts.logger.warn(
        {
          adelantoId,
          empresaShipperId: locked.empresaShipperId,
          targetStatus: body.target_status,
          montoAdelantadoClp: locked.montoAdelantadoClp,
        },
        'admin cobra-hoy: transición sin decisión crediticia vigente; exposición NO actualizada',
      );
    }
    if (exposure?.updated === true && exposure.clamped) {
      opts.logger.warn(
        {
          adelantoId,
          empresaShipperId: locked.empresaShipperId,
          exposureBefore: exposure.before,
          montoAdelantadoClp: locked.montoAdelantadoClp,
          exposureAfter: exposure.after,
        },
        'admin cobra-hoy: decremento de exposición RECORTADO por piso 0 (decisión rotada entre desembolso y cobro) — revisar libros',
      );
    }

    opts.logger.info(
      {
        adelantoId,
        from: lockedStatus,
        to: after.status,
        adminEmail: auth.adminEmail,
        ...(exposure?.updated === true
          ? { exposureBefore: exposure.before, exposureAfter: exposure.after }
          : {}),
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
