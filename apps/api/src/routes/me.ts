import type { Logger } from '@booster-ai/logger';
import { profileUpdateInputSchema } from '@booster-ai/shared-schemas';
import { zValidator } from '@hono/zod-validator';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { config as appConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { carrierMemberships, empresas, memberships, users } from '../db/schema.js';
import type { FirebaseClaims } from '../middleware/firebase-auth.js';

/**
 * GET /me — endpoint que el cliente web llama post-login con Firebase.
 * No usa userContext middleware porque el user puede no existir todavía.
 *
 * PATCH /me/profile — actualización parcial. RUT inmutable si ya está
 * declarado.
 */
export function createMeRoutes(opts: { db: Db; logger: Logger }) {
  const app = new Hono();

  app.get('/', async (c) => {
    const claims = c.get('firebaseClaims') as FirebaseClaims | undefined;
    if (!claims) {
      opts.logger.error({ path: c.req.path }, '/me hit without firebaseClaims');
      return c.json({ error: 'internal_server_error' }, 500);
    }

    const userRows = await opts.db
      .select()
      .from(users)
      .where(eq(users.firebaseUid, claims.uid))
      .limit(1);
    let user = userRows[0];

    // ---------------------------------------------------------------------
    // Account linking automático: si no hay match por firebase_uid PERO
    // hay match por email Y el provider verificó el email (Google, etc),
    // actualizamos el firebase_uid del user existente al nuevo y lo usamos.
    //
    // Por qué es seguro: el provider OAuth (Google, Apple, etc) ya
    // demostró control del email. Si Felipe se registró con email/password
    // el martes y hoy se loguea con Google del mismo email verificado,
    // confiamos en el provider y linkeamos.
    //
    // Riesgo NO mitigado: email/password con email_verified=false. Por eso
    // restringimos a email_verified=true (Google y otros OAuth lo dan
    // siempre; email/password requiere flow explícito de verificación).
    //
    // Nota: si en el futuro permitimos email/password sin verificación,
    // habría que NO linkear desde provider verificado a email/password no
    // verificado para prevenir hijack.
    // ---------------------------------------------------------------------
    if (!user && claims.email && claims.emailVerified) {
      const byEmail = await opts.db
        .select()
        .from(users)
        .where(eq(users.email, claims.email))
        .limit(1);
      const existing = byEmail[0];
      if (existing) {
        opts.logger.info(
          {
            userId: existing.id,
            email: claims.email,
            oldFirebaseUid: existing.firebaseUid,
            newFirebaseUid: claims.uid,
          },
          'account linking: actualizando firebase_uid del user existente',
        );
        const linkedRows = await opts.db
          .update(users)
          .set({ firebaseUid: claims.uid, updatedAt: new Date() })
          .where(eq(users.id, existing.id))
          .returning();
        user = linkedRows[0] ?? existing;
      }
    }

    // ---------------------------------------------------------------------
    // Platform admin auto-provisioning. Si el email Firebase está en la
    // allowlist `BOOSTER_PLATFORM_ADMIN_EMAILS`, el user opera como admin
    // de plataforma — no tiene empresa propia, su único hub es
    // /app/platform-admin. Auto-creamos el row en `usuarios` la primera
    // vez para que `/me` devuelva `needs_onboarding=false` y no quede
    // bloqueado en el flow tenant de /onboarding.
    //
    // Trust boundary: la allowlist (env var) es la fuente de autoridad;
    // mismo patrón que `requirePlatformAdmin` en admin-seed.ts. Si el
    // email cambia o sale de la allowlist, el `is_platform_admin=true`
    // queda como caché en BD (no se revoca automáticamente — eso
    // requiere intervención manual o un job periódico).
    // ---------------------------------------------------------------------
    if (!user && claims.email) {
      const adminAllowlist = appConfig.BOOSTER_PLATFORM_ADMIN_EMAILS;
      const isAdminEmail = adminAllowlist.includes(claims.email.toLowerCase());
      if (isAdminEmail) {
        const fullName = claims.name?.trim() ?? claims.email.split('@')[0] ?? 'Platform Admin';
        const inserted = await opts.db
          .insert(users)
          .values({
            firebaseUid: claims.uid,
            email: claims.email,
            fullName,
            isPlatformAdmin: true,
            status: 'activo',
          })
          .returning();
        user = inserted[0];
        opts.logger.info(
          { email: claims.email, userId: user?.id },
          'platform admin auto-provisioned from allowlist',
        );
      }
    }

    if (!user) {
      return c.json({
        needs_onboarding: true,
        firebase: {
          uid: claims.uid,
          email: claims.email,
          name: claims.name,
          picture: claims.picture,
          email_verified: claims.emailVerified,
        },
      });
    }

    const rows = await opts.db
      .select({ membership: memberships, empresa: empresas })
      .from(memberships)
      .innerJoin(empresas, eq(memberships.empresaId, empresas.id))
      .where(eq(memberships.userId, user.id));

    const membershipsPayload = rows.map((r) => ({
      id: r.membership.id,
      role: r.membership.role,
      status: r.membership.status,
      joined_at: r.membership.joinedAt,
      empresa: {
        id: r.empresa.id,
        legal_name: r.empresa.legalName,
        rut: r.empresa.rut,
        is_generador_carga: r.empresa.isGeneradorCarga,
        is_transportista: r.empresa.isTransportista,
        status: r.empresa.status,
      },
    }));

    const requestedEmpresaId = c.req.header('x-empresa-id');
    const activeMembershipsList = membershipsPayload.filter((m) => m.status === 'activa');
    let active: (typeof membershipsPayload)[number] | null = null;
    if (requestedEmpresaId) {
      active = activeMembershipsList.find((m) => m.empresa.id === requestedEmpresaId) ?? null;
    }
    // Fallback al primer activeMembership si:
    //   - no hay requestedEmpresaId (no header), o
    //   - el header tiene un UUID que NO matchea ninguna membership del user
    //     (caso típico: localStorage stale del browser después de cambiar de
    //     cuenta, ej. user A logueado deja activeEmpresaId=X, después
    //     user B se loguea y X no es suya → null sin fallback dejaba la
    //     PWA en "Sin empresa activa" cuando el user SÍ tiene empresa).
    // El fallback no es silencioso para el frontend: el frontend debería
    // detectar que active.empresa.id !== requestedEmpresaId y actualizar
    // localStorage. Pero la PWA no se rompe mientras tanto.
    if (!active && activeMembershipsList.length > 0) {
      active = activeMembershipsList[0] ?? null;
    }

    // La allowlist env-var es la fuente de autoridad para platform admin
    // (mismo patrón que requirePlatformAdmin). Si el email está en la
    // allowlist, lo devolvemos true aunque el column en BD sea stale.
    const adminAllowlist = appConfig.BOOSTER_PLATFORM_ADMIN_EMAILS;
    const isPlatformAdmin =
      user.isPlatformAdmin || adminAllowlist.includes(user.email.toLowerCase());

    return c.json({
      needs_onboarding: false,
      user: {
        id: user.id,
        email: user.email,
        full_name: user.fullName,
        phone: user.phone,
        whatsapp_e164: user.whatsappE164,
        rut: user.rut,
        is_platform_admin: isPlatformAdmin,
        status: user.status,
      },
      memberships: membershipsPayload,
      active_membership: active,
    });
  });

  app.patch('/profile', zValidator('json', profileUpdateInputSchema), async (c) => {
    const claims = c.get('firebaseClaims') as FirebaseClaims | undefined;
    if (!claims) {
      opts.logger.error({ path: c.req.path }, '/me/profile hit without firebaseClaims');
      return c.json({ error: 'internal_server_error' }, 500);
    }

    const userRows = await opts.db
      .select()
      .from(users)
      .where(eq(users.firebaseUid, claims.uid))
      .limit(1);
    const user = userRows[0];
    if (!user) {
      return c.json(
        {
          error: 'user_not_found',
          message: 'El usuario no existe en la DB. Completa onboarding primero.',
        },
        404,
      );
    }

    const input = c.req.valid('json');

    if (input.rut !== undefined && user.rut !== null) {
      return c.json(
        {
          error: 'rut_immutable',
          message: 'El RUT ya está declarado. Para cambiarlo, contacta soporte.',
        },
        409,
      );
    }

    const patch: Partial<typeof users.$inferInsert> = { updatedAt: new Date() };
    if (input.full_name !== undefined) {
      patch.fullName = input.full_name;
    }
    if (input.phone !== undefined) {
      patch.phone = input.phone;
    }
    if (input.whatsapp_e164 !== undefined) {
      patch.whatsappE164 = input.whatsapp_e164;
    }
    if (input.rut !== undefined) {
      patch.rut = input.rut;
    }

    const updatedRows = await opts.db
      .update(users)
      .set(patch)
      .where(eq(users.id, user.id))
      .returning();
    const updated = updatedRows[0];
    if (!updated) {
      opts.logger.error({ userId: user.id }, '/me/profile UPDATE returning empty');
      return c.json({ error: 'internal_server_error' }, 500);
    }

    return c.json({
      user: {
        id: updated.id,
        email: updated.email,
        full_name: updated.fullName,
        phone: updated.phone,
        whatsapp_e164: updated.whatsappE164,
        rut: updated.rut,
        is_platform_admin: updated.isPlatformAdmin,
        status: updated.status,
      },
    });
  });

  /**
   * POST /me/consent/terms-v2 — registra la aceptación de T&Cs v2
   * por parte del carrier (ADR-031 §4).
   *
   * Resuelve la empresa activa del user vía el header `X-Empresa-Id`
   * (mismo patrón que el resto de endpoints). Si esa empresa tiene una
   * `carrier_memberships` activa, popula `consent_terms_v2_aceptado_en`
   * con `now()` + IP + user-agent.
   *
   * Idempotente: si ya hay consent (no-null), retorna 200 con el
   * timestamp original (no se sobrescribe — la fecha del primer
   * consent es la legalmente vinculante).
   */
  app.post('/consent/terms-v2', async (c) => {
    const claims = c.get('firebaseClaims') as FirebaseClaims | undefined;
    if (!claims) {
      return c.json({ error: 'internal_server_error' }, 500);
    }

    const empresaIdHeader = c.req.header('x-empresa-id');
    if (!empresaIdHeader) {
      return c.json(
        {
          error: 'no_active_empresa',
          message: 'Header X-Empresa-Id requerido',
        },
        400,
      );
    }

    // Verificar que el user pertenece a esa empresa con membership
    // activa (RLS aplicación-enforced).
    const userRows = await opts.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.firebaseUid, claims.uid))
      .limit(1);
    const user = userRows[0];
    if (!user) {
      return c.json({ error: 'user_not_found' }, 404);
    }

    const memshipRows = await opts.db
      .select({ id: memberships.id })
      .from(memberships)
      .where(
        and(
          eq(memberships.userId, user.id),
          eq(memberships.empresaId, empresaIdHeader),
          eq(memberships.status, 'activa'),
        ),
      )
      .limit(1);
    if (!memshipRows[0]) {
      return c.json(
        {
          error: 'forbidden_no_membership',
          message: 'No tienes membership activa en esta empresa',
        },
        403,
      );
    }

    // Lookup carrier_memberships activa de la empresa.
    const carrierMemRows = await opts.db
      .select({
        id: carrierMemberships.id,
        consentTermsV2AceptadoEn: carrierMemberships.consentTermsV2AceptadoEn,
      })
      .from(carrierMemberships)
      .where(
        and(
          eq(carrierMemberships.empresaId, empresaIdHeader),
          eq(carrierMemberships.status, 'activa'),
        ),
      )
      .limit(1);
    const carrierMem = carrierMemRows[0];
    if (!carrierMem) {
      return c.json(
        {
          error: 'no_carrier_membership',
          message:
            'Tu empresa no tiene una membresía de transportista activa. Esta funcionalidad es solo para transportistas.',
        },
        409,
      );
    }

    // Idempotencia: si ya hay consent, no sobrescribir.
    if (carrierMem.consentTermsV2AceptadoEn) {
      return c.json({
        ok: true,
        accepted_at: carrierMem.consentTermsV2AceptadoEn.toISOString(),
        already_accepted: true,
      });
    }

    const now = new Date();
    const ip =
      c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? c.req.header('x-real-ip') ?? null;
    const userAgent = c.req.header('user-agent') ?? null;

    await opts.db
      .update(carrierMemberships)
      .set({
        consentTermsV2AceptadoEn: now,
        consentTermsV2Ip: ip,
        consentTermsV2UserAgent: userAgent,
        updatedAt: now,
      })
      .where(eq(carrierMemberships.id, carrierMem.id));

    opts.logger.info(
      {
        userId: user.id,
        empresaId: empresaIdHeader,
        carrierMembershipId: carrierMem.id,
        ip,
      },
      'consent terms-v2 aceptado',
    );

    return c.json({
      ok: true,
      accepted_at: now.toISOString(),
      already_accepted: false,
    });
  });

  /**
   * GET /me/consent/terms-v2 — consulta si el carrier ya aceptó.
   * Útil para que el frontend decida mostrar el banner.
   */
  app.get('/consent/terms-v2', async (c) => {
    const empresaIdHeader = c.req.header('x-empresa-id');
    if (!empresaIdHeader) {
      return c.json({ accepted: false, reason: 'no_active_empresa' });
    }

    const carrierMemRows = await opts.db
      .select({
        consentTermsV2AceptadoEn: carrierMemberships.consentTermsV2AceptadoEn,
      })
      .from(carrierMemberships)
      .where(
        and(
          eq(carrierMemberships.empresaId, empresaIdHeader),
          eq(carrierMemberships.status, 'activa'),
        ),
      )
      .limit(1);
    const carrierMem = carrierMemRows[0];
    if (!carrierMem) {
      // No es carrier → no aplica T&Cs v2; reportar accepted=true para
      // que el frontend no muestre banner a empresas no-transportistas.
      return c.json({ accepted: true, reason: 'not_a_carrier' });
    }

    if (carrierMem.consentTermsV2AceptadoEn) {
      return c.json({
        accepted: true,
        accepted_at: carrierMem.consentTermsV2AceptadoEn.toISOString(),
      });
    }
    return c.json({ accepted: false, reason: 'pending' });
  });

  return app;
}
