/**
 * Endpoints internos disparados por Cloud Scheduler (P3.d y futuros).
 *
 * Auth: OIDC token con `email` claim == INTERNAL_CRON_CALLER_SA. El
 * middleware se aplica externamente en server.ts (mismo
 * createAuthMiddleware que usamos para el bot, distinta env var).
 *
 * Endpoints disponibles:
 *   - POST /chat-whatsapp-fallback — tick del cron de fallback WhatsApp
 *     para mensajes de chat no leídos > 5 min.
 *
 * Convenciones:
 *   - Devolver 200 con body resumen (counts) cuando todo OK, incluso si
 *     no había trabajo (Cloud Scheduler considera 200 como success y no
 *     reintenta).
 *   - Devolver 503 si la feature no está configurada (no es un error
 *     ejecutar el cron sin Twilio; logueamos warn y retornamos
 *     skipped:true).
 *   - 5xx solo si hay un crash inesperado.
 */

import type { Logger } from '@booster-ai/logger';
import type { TwilioWhatsAppClient } from '@booster-ai/whatsapp-client';
import type { Auth } from 'firebase-admin/auth';
import { Hono } from 'hono';
import type pg from 'pg';
import { config as appConfig } from '../config.js';
import type { Db } from '../db/client.js';
import {
  DEFAULT_MAX_DELETES_PER_RUN,
  type PoolLike,
  fetchReaperFacts,
  reapInertIdpAccounts,
} from '../jobs/reap-inert-idp-accounts.js';
import {
  DEFAULT_ORPHAN_MAX_DELETES_PER_RUN,
  type PoolLike as OrphanPoolLike,
  listOnboardingOrphans,
  markOnboardingOrphanReaped,
  reapOrphanOnboardingFirebaseUsers,
} from '../jobs/reap-orphan-onboarding-firebase.js';
import { setResultAttributes, withBusinessSpan } from '../observability/business-span.js';
import { procesarMensajesNoLeidos } from '../services/chat-whatsapp-fallback.js';
import { cobrarMembershipsMensual } from '../services/cobrar-memberships-mensual.js';
import { cobrarSuscripcionesUf } from '../services/cobrar-suscripciones-uf.js';
import { leerConfiguracionPublicada } from '../services/configuracion-comercial.js';
import {
  type MembershipPaymentGateway,
  noopMembershipPaymentGateway,
} from '../services/membership-payment-gateway.js';
import { procesarCobranzaCobraHoy } from '../services/procesar-cobranza-cobra-hoy.js';
import { purgarPosicionesMovil } from '../services/purgar-posiciones-movil.js';
import { DEFAULT_REAPER_GRACE_DAYS } from '../services/reaper-predicate.js';
import {
  ValorUfNoDisponibleError,
  fechaChile,
  obtenerValorUf,
  proveedoresUfPorDefecto,
} from '../services/valor-uf.js';

/**
 * `pg.Pool` con la firma mínima que piden los reapers (`PoolLike`). Las
 * sobrecargas de `pg.Pool.query` no calzan estructuralmente con esa interfaz;
 * este adaptador las reduce a la única forma que usan, sin casts.
 */
function adaptarPool(pool: pg.Pool): PoolLike & OrphanPoolLike {
  return {
    async query(sql: string, params?: unknown[]) {
      const resultado = await pool.query(sql, params);
      return { rows: resultado.rows, rowCount: resultado.rowCount };
    },
  };
}

export function createAdminJobsRoutes(opts: {
  db: Db;
  logger: Logger;
  twilioClient: TwilioWhatsAppClient | null;
  contentSidChatUnread: string | null;
  webAppUrl: string;
  /** Para el reaper de cuentas IdP. Null en tests sin Firebase. */
  firebaseAuth?: Auth | null;
  /** T9 SEC-001 boundary-closure — pool pg para el reaper (fetchReaperFacts). Null en tests sin DB. */
  pool?: pg.Pool | null;
  /**
   * Gap B5 — gateway de pago para el cron de membresías. ⚠️ STUBEADO: por
   * default es `noopMembershipPaymentGateway` (NO mueve dinero). Inyectable para
   * tests y para enchufar el provider real cuando exista `payment-provider`.
   */
  membershipPaymentGateway?: MembershipPaymentGateway;
}) {
  const app = new Hono();

  /** ADR-079 §4 — valor UF: CMF (si hay `CMF_API_KEY`) con respaldo SII. */
  const valorUfDe = (fecha: string) =>
    obtenerValorUf({
      db: opts.db,
      logger: opts.logger,
      fecha,
      proveedores: proveedoresUfPorDefecto(appConfig.CMF_API_KEY),
    });

  /**
   * ADR-079 §4 — tick diario: deja guardado el valor UF del día en
   * `valores_uf` (caché auditada con su fuente). 503 si ninguna fuente
   * responde, para que Cloud Scheduler reintente.
   */
  app.post('/valor-uf', async (c) => {
    try {
      const r = await withBusinessSpan({ name: 'pricing.valor_uf.obtener' }, async (span) => {
        const v = await valorUfDe(fechaChile(Date.now()));
        setResultAttributes(span, { 'booster.valor_uf.fuente': v.fuente });
        return v;
      });
      return c.json({
        ok: true,
        fecha: r.fecha,
        valor_clp: r.valorClp,
        fuente: r.fuente,
        desde_cache: r.desdeCache,
      });
    } catch (err) {
      if (err instanceof ValorUfNoDisponibleError) {
        opts.logger.error({ fecha: err.fecha, causas: err.causas }, 'valor UF no disponible');
        return c.json({ error: 'valor_uf_no_disponible', fecha: err.fecha }, 503);
      }
      throw err;
    }
  });

  app.post('/chat-whatsapp-fallback', async (c) => {
    const result = await procesarMensajesNoLeidos({
      db: opts.db,
      logger: opts.logger,
      twilioClient: opts.twilioClient,
      contentSid: opts.contentSidChatUnread,
      webAppUrl: opts.webAppUrl,
    });

    return c.json({
      ok: true,
      ...result,
    });
  });

  /**
   * ADR-029 v1 / ADR-032 — tick diario de cobranza Cobra Hoy.
   *
   * Detecta adelantos `desembolsado` cuyo plazo del shipper venció y
   * los transiciona a `mora`. Idempotente, seguro de re-correr.
   *
   * Si `FACTORING_V1_ACTIVATED=false`, retorna 200 con `skipped:true`
   * (no es un error — el cron sigue activo aunque la feature esté off
   * por entornos de staging).
   */
  app.post('/purgar-posiciones-movil', async (c) => {
    const result = await purgarPosicionesMovil({ db: opts.db, logger: opts.logger });
    return c.json({ ok: true, deleted: result.deleted, retention_days: result.retentionDays });
  });

  app.post('/cobra-hoy-cobranza', async (c) => {
    if (!appConfig.FACTORING_V1_ACTIVATED) {
      opts.logger.debug('cobra-hoy-cobranza: FACTORING_V1_ACTIVATED=false, skip');
      return c.json({ ok: true, skipped: true, reason: 'feature_disabled' });
    }
    const result = await procesarCobranzaCobraHoy({
      db: opts.db,
      logger: opts.logger,
    });
    return c.json({
      ok: true,
      moras_creadas: result.morasCreadas,
      adelantos: result.adelantos.map((a) => ({
        adelanto_id: a.adelantoId,
        empresa_carrier_id: a.empresaCarrierId,
        empresa_shipper_id: a.empresaShipperId,
        dias_vencidos: a.diasVencidos,
      })),
    });
  });

  /**
   * Gap B5 (ADR-030 §7 + ADR-031) — tick MENSUAL del cobro de cuotas de
   * membresía de los carriers en tier pagado (Standard/Pro/Premium).
   *
   * ⚠️ EL RAIL DE PAGO ESTÁ STUBEADO. El gateway default
   * (`noopMembershipPaymentGateway`) NO mueve dinero: factura, deja la
   * factura en `pending_payment_provider` y aplica el dunning (hasta 3
   * reintentos; al agotarlos → `morosa`). El cobro real llega cuando exista
   * `payment-provider` y se inyecte un gateway real.
   *
   * Gating: si `PRICING_V2_ACTIVATED=false`, 200 con `skipped:true` (no es
   * error correr el cron con la feature off — Cloud Scheduler lo trata como
   * success). Idempotente: re-correr el tick no cobra dos veces el mismo ciclo.
   */
  app.post('/cobrar-memberships-mensual', async (c) => {
    // ADR-079 §4: con v3 encendido el cobro mensual es de suscripciones en
    // UF; la membresía v2 deja de habilitar cobro alguno.
    if (appConfig.PRICING_V3_ACTIVATED) {
      const gateway = opts.membershipPaymentGateway ?? noopMembershipPaymentGateway(opts.logger);
      try {
        const r = await withBusinessSpan(
          { name: 'pricing.suscripciones_uf.cobrar' },
          async (span) => {
            const res = await cobrarSuscripcionesUf({
              db: opts.db,
              logger: opts.logger,
              gateway,
              obtenerUf: valorUfDe,
              leerConfiguracion: () => leerConfiguracionPublicada(opts.db),
            });
            setResultAttributes(span, {
              'booster.suscripciones_uf.facturas_creadas': res.facturasCreadas,
            });
            return res;
          },
        );
        return c.json({
          ok: true,
          modelo: 'v3_suscripciones_uf',
          periodo_mes: r.periodoMes,
          fecha_uf: r.fechaUf,
          uf_valor_clp: r.ufValorClp,
          uf_fuente: r.ufFuente,
          configuracion_version: r.configuracionVersion,
          evaluadas: r.evaluadas,
          facturas_creadas: r.facturasCreadas,
          reintentos: r.reintentos,
          pending_provider: r.pendingProvider,
          cobradas: r.cobradas,
          morosas: r.morosas,
          ya_facturadas: r.yaFacturadas,
          exentas: r.exentas,
          payment_rail_stubbed: true,
        });
      } catch (err) {
        if (err instanceof ValorUfNoDisponibleError) {
          opts.logger.error({ fecha: err.fecha, causas: err.causas }, 'cobro UF sin valor UF');
          return c.json({ error: 'valor_uf_no_disponible', fecha: err.fecha }, 503);
        }
        throw err;
      }
    }
    if (!appConfig.PRICING_V2_ACTIVATED) {
      opts.logger.debug('cobrar-memberships-mensual: PRICING_V2_ACTIVATED=false, skip');
      return c.json({ ok: true, skipped: true, reason: 'feature_disabled' });
    }
    const gateway = opts.membershipPaymentGateway ?? noopMembershipPaymentGateway(opts.logger);
    const result = await cobrarMembershipsMensual({
      db: opts.db,
      logger: opts.logger,
      gateway,
      pricingV2Activated: appConfig.PRICING_V2_ACTIVATED,
    });
    if (result.status === 'skipped_flag_disabled') {
      return c.json({ ok: true, skipped: true, reason: 'feature_disabled' });
    }
    return c.json({
      ok: true,
      periodo_mes: result.periodoMes,
      evaluadas: result.evaluadas,
      facturas_creadas: result.facturasCreadas,
      reintentos: result.reintentos,
      pending_provider: result.pendingProvider,
      cobradas: result.cobradas,
      morosas: result.morosas,
      ya_facturadas: result.yaFacturadas,
      // Recordatorio explícito en la respuesta: el cobro real está stubeado.
      payment_rail_stubbed: true,
    });
  });

  /**
   * T9 SEC-001 boundary-closure (SC-G5, ADR-057) — reaper de cuentas IdP
   * Google inertes. Cloud Scheduler invoca diariamente.
   *
   * **dry-run por defecto**: el modo destructivo está gateado por
   * `REAPER_DESTRUCTIVE` (config server-side, NO por el request del
   * scheduler). Con el flag OFF solo loguea/cuenta lo que haría.
   *
   * never-reapable = platform-admins (`BOOSTER_PLATFORM_ADMIN_EMAILS`) +
   * `dev@boosterchile.com`. El hard-guard real (dual-match uid+email vs
   * `usuarios`) vive en el predicado (T7).
   *
   * 503 skipped si faltan deps (firebaseAuth o pool) — Cloud Scheduler lo
   * trata como no-error pero el log queda.
   */
  app.post('/reap-inert-idp-accounts', async (c) => {
    if (!opts.firebaseAuth || !opts.pool) {
      opts.logger.warn('reap-inert-idp-accounts: firebaseAuth o pool no inyectado, skip');
      return c.json({ ok: true, skipped: true, reason: 'deps_missing' }, 503);
    }
    const pool: PoolLike = adaptarPool(opts.pool);
    const neverReapable = new Set<string>([
      ...appConfig.BOOSTER_PLATFORM_ADMIN_EMAILS,
      'dev@boosterchile.com',
    ]);
    const summary = await reapInertIdpAccounts(
      {
        auth: opts.firebaseAuth,
        fetchFacts: (account) => fetchReaperFacts(pool, account),
        logger: opts.logger,
      },
      {
        destructive: appConfig.REAPER_DESTRUCTIVE,
        graceDays: DEFAULT_REAPER_GRACE_DAYS,
        secondGraceDays: DEFAULT_REAPER_GRACE_DAYS,
        neverReapable,
        now: new Date(),
        maxDeletesPerRun: DEFAULT_MAX_DELETES_PER_RUN,
      },
    );
    return c.json({ ok: true, destructive: appConfig.REAPER_DESTRUCTIVE, ...summary });
  });

  /**
   * W1.5 (runbook activación onboarding, onboarding-flow-redesign T1.7,
   * spec §9) — reaper del usuario Firebase huérfano del onboarding
   * admin-provisioned. Antes de este handler el job solo corría como script
   * `tsx` MANUAL (higiene operacional, no una mitigación automática); este
   * endpoint es lo que permite cablearlo a Cloud Scheduler (scheduling.tf,
   * job `reap-orphan-onboarding-firebase`, arranca `paused = true`).
   *
   * **dry-run por defecto**: el modo destructivo está gateado por
   * `ONBOARDING_ORPHAN_REAPER_DESTRUCTIVE` (config server-side, NO por el
   * request del scheduler). Con el flag OFF solo loguea/cuenta lo que haría.
   *
   * 503 skipped si faltan deps (firebaseAuth o pool) — Cloud Scheduler lo
   * trata como no-error pero el log queda.
   */
  app.post('/reap-orphan-onboarding-firebase', async (c) => {
    if (!opts.firebaseAuth || !opts.pool) {
      opts.logger.warn('reap-orphan-onboarding-firebase: firebaseAuth o pool no inyectado, skip');
      return c.json({ ok: true, skipped: true, reason: 'deps_missing' }, 503);
    }
    const pool: OrphanPoolLike = adaptarPool(opts.pool);
    const summary = await reapOrphanOnboardingFirebaseUsers(
      {
        auth: opts.firebaseAuth,
        listOrphans: () => listOnboardingOrphans(pool),
        markReaped: (id) => markOnboardingOrphanReaped(pool, id),
        logger: opts.logger,
      },
      {
        destructive: appConfig.ONBOARDING_ORPHAN_REAPER_DESTRUCTIVE,
        maxDeletesPerRun: DEFAULT_ORPHAN_MAX_DELETES_PER_RUN,
      },
    );
    return c.json({
      ok: true,
      destructive: appConfig.ONBOARDING_ORPHAN_REAPER_DESTRUCTIVE,
      ...summary,
    });
  });

  return app;
}
