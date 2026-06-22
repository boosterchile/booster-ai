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
import type Redis from 'ioredis';
import type pg from 'pg';
import { config as appConfig } from '../config.js';
import type { Db } from '../db/client.js';
import {
  DEFAULT_MAX_DELETES_PER_RUN,
  type PoolLike,
  fetchReaperFacts,
  reapInertIdpAccounts,
} from '../jobs/reap-inert-idp-accounts.js';
import { procesarMensajesNoLeidos } from '../services/chat-whatsapp-fallback.js';
import { cobrarMembershipsMensual } from '../services/cobrar-memberships-mensual.js';
import { runDemoTtlAlerter } from '../services/demo-account-ttl-alerter.js';
import {
  type MembershipPaymentGateway,
  noopMembershipPaymentGateway,
} from '../services/membership-payment-gateway.js';
import { procesarCobranzaCobraHoy } from '../services/procesar-cobranza-cobra-hoy.js';
import { purgarPosicionesMovil } from '../services/purgar-posiciones-movil.js';
import { DEFAULT_REAPER_GRACE_DAYS } from '../services/reaper-predicate.js';

export function createAdminJobsRoutes(opts: {
  db: Db;
  logger: Logger;
  twilioClient: TwilioWhatsAppClient | null;
  contentSidChatUnread: string | null;
  webAppUrl: string;
  /** T6a SEC-001 Sprint 2a — para POST /demo-account-ttl-alert. Null en tests sin Firebase. */
  firebaseAuth?: Auth | null;
  /** T6a SEC-001 Sprint 2a — para dedup Redis del TTL alerter. */
  redis?: Redis | null;
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
   * T6a SEC-001 Sprint 2a (spec §3 H1.1 SC-1.1.6) — TTL alerter daily
   * tick. Cloud Scheduler invoca a 06:00 America/Santiago. Emite
   * structured log `demo.ttl_low` solo cuando una cuenta demo activa
   * tiene ≤7 días de TTL restante; Redis dedup por día evita
   * re-alertar.
   *
   * Si Firebase Auth o Redis no están inyectados (tests / dev sin
   * config), retorna 503 + skipped: true (Cloud Scheduler considera
   * no-error pero el log queda).
   */
  app.post('/demo-account-ttl-alert', async (c) => {
    if (!opts.firebaseAuth || !opts.redis) {
      opts.logger.warn('demo-account-ttl-alert: firebaseAuth o redis no inyectado, skip');
      return c.json({ ok: true, skipped: true, reason: 'deps_missing' }, 503);
    }
    const result = await runDemoTtlAlerter({
      db: opts.db,
      firebaseAuth: opts.firebaseAuth,
      redis: opts.redis,
      logger: opts.logger,
    });
    return c.json({ ok: true, ...result });
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
    const pool = opts.pool as unknown as PoolLike;
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

  return app;
}
