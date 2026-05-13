import type { Logger } from '@booster-ai/logger';
import { and, eq, sql } from 'drizzle-orm';
import type { Auth } from 'firebase-admin/auth';
import type { ApiEnv } from '../config.js';
import type { Db } from '../db/client.js';
import { conductores, empresas, users } from '../db/schema.js';
import { DEMO_CONDUCTOR_RUT, DEMO_SHIPPER_RUT, seedDemo } from './seed-demo.js';

/**
 * Hook que corre en startup del api server cuando `DEMO_MODE_ACTIVATED=true`.
 *
 * Garantiza que las 4 personas demo (shipper, carrier, conductor,
 * stakeholder) existan en BD antes de que el primer request a
 * `POST /demo/login` llegue. Sin esto, el subdominio demo.boosterchile.com
 * recién deployado respondería 503 hasta que un operador corra manualmente
 * `POST /admin/seed/demo`.
 *
 * Comportamiento:
 *   - Flag OFF → no-op + log debug.
 *   - Empresa shipper demo ya existe (rut + es_demo) → skip + log info.
 *   - No existe → invoca `seedDemo` (idempotente) y luego promueve el
 *     conductor demo a un firebase user real (sino el endpoint
 *     /demo/login no podría emitir custom token para él).
 *   - Cualquier error captura y loguea con stack, **no propaga** —
 *     un seed fallido nunca debe matar el startup del api. El operador
 *     puede investigar via logs + reintentar con /admin/seed/demo.
 *
 * Credenciales: cuando se corre el seed, las loggeamos en nivel DEBUG
 * (no info/warn). Razón: son passwords sintéticas de demo, pero igual
 * son secretos en sentido amplio y no deberían quedar en logs
 * accessibles por defecto (Cloud Logging filtra debug por default).
 */
export async function ensureDemoSeeded(opts: {
  db: Db;
  firebaseAuth: Auth;
  logger: Logger;
  config: Pick<ApiEnv, 'DEMO_MODE_ACTIVATED'>;
}): Promise<void> {
  const { db, firebaseAuth, logger, config } = opts;

  if (config.DEMO_MODE_ACTIVATED !== true) {
    logger.debug('ensureDemoSeeded: flag DEMO_MODE_ACTIVATED=false, skip');
    return;
  }

  try {
    // Pista cheap: empresa shipper demo (rut canónico + es_demo=true).
    // Si existe, asumimos que el seed completo corrió antes. El seed
    // es idempotente, así que tampoco haría daño correrlo de nuevo —
    // pero evitar 7-10 queries innecesarias en cada boot es buena
    // higiene operacional.
    const existing = await db
      .select({ id: empresas.id })
      .from(empresas)
      .where(and(eq(empresas.rut, DEMO_SHIPPER_RUT), eq(empresas.isDemo, true)))
      .limit(1);

    if (existing.length > 0) {
      logger.info('ensureDemoSeeded: demo seed already provisioned, skipping');
      // Aunque ya esté seedeado, igual nos aseguramos de que el
      // conductor demo tenga firebase_uid real (sino el endpoint
      // /demo/login responde 503 para persona='conductor').
      await ensureConductorDemoActivated({ db, firebaseAuth, logger });
      return;
    }

    logger.info('ensureDemoSeeded: provisioning demo entities (first boot)');
    const credentials = await seedDemo({ db, firebaseAuth, logger });
    // Debug-only: estas son credenciales sintéticas de demo, pero
    // todavía son "secretos" en el sentido amplio. No queremos verlas
    // en Cloud Logging con nivel info por default.
    logger.debug(
      {
        shipper_email: credentials.shipper_owner.email,
        carrier_email: credentials.carrier_owner.email,
        stakeholder_email: credentials.stakeholder.email,
        conductor_rut: credentials.conductor.rut,
        activation_pin: credentials.conductor.activation_pin,
      },
      'ensureDemoSeeded: seed credentials (debug only)',
    );

    // Promover el conductor demo a un firebase user real. Sin esto,
    // /demo/login para persona='conductor' responde 503 porque el
    // firebase_uid sigue siendo `pending-rut:...`.
    await ensureConductorDemoActivated({ db, firebaseAuth, logger });
  } catch (err) {
    // NO propagar — un seed fallido no debe tumbar el startup. El api
    // sigue sirviendo todo lo demás; /demo/login responderá 503 hasta
    // que un operador investigue.
    logger.error({ err }, 'ensureDemoSeeded: failed (non-fatal, server continúa)');
  }
}

/**
 * Promueve el conductor demo de placeholder `pending-rut:*` a un
 * firebase user real con email sintético + password fijo de demo. Sin
 * esto, `/demo/login` para persona='conductor' no puede emitir un
 * custom token (createCustomToken exige un UID real Firebase).
 *
 * Idempotente: si el conductor ya tiene firebase_uid real, no-op.
 *
 * El password sintético `BoosterDemo2026!` es el mismo que usan los
 * otros owners demo (ver `DEMO_PASSWORD` en seed-demo.ts). El conductor
 * normalmente usaría su PIN como password tras activación; acá lo
 * sobreescribimos porque el flujo demo entra via custom token, no via
 * signInWithEmailAndPassword.
 */
async function ensureConductorDemoActivated(opts: {
  db: Db;
  firebaseAuth: Auth;
  logger: Logger;
}): Promise<void> {
  const { db, firebaseAuth, logger } = opts;

  // 1. Buscar el conductor demo y su user actual.
  const rows = await db
    .select({
      userId: users.id,
      firebaseUid: users.firebaseUid,
      email: users.email,
    })
    .from(conductores)
    .innerJoin(users, eq(users.id, conductores.userId))
    .where(eq(users.rut, DEMO_CONDUCTOR_RUT))
    .limit(1);
  const row = rows[0];
  if (!row) {
    logger.warn('ensureConductorDemoActivated: conductor demo no encontrado tras seed');
    return;
  }

  // Si ya está promovido (firebase_uid real), nada que hacer.
  if (!row.firebaseUid.startsWith('pending-rut:')) {
    return;
  }

  // 2. Crear (o reusar) el Firebase user. Email sintético determinístico
  //    en `.invalid` (RFC2606) para no rutear emails reales. Password
  //    fijo `BoosterDemo2026!` consistente con los owners demo.
  const syntheticEmail = `drivers+${DEMO_CONDUCTOR_RUT.replace(/[.\-]/g, '')}@boosterchile.invalid`;
  const password = 'BoosterDemo2026!';
  let firebaseUid: string;
  try {
    const existingFb = await firebaseAuth.getUserByEmail(syntheticEmail).catch(() => null);
    if (existingFb) {
      firebaseUid = existingFb.uid;
      await firebaseAuth.updateUser(firebaseUid, { password });
    } else {
      const created = await firebaseAuth.createUser({
        email: syntheticEmail,
        emailVerified: false,
        password,
        displayName: `Conductor Demo ${DEMO_CONDUCTOR_RUT}`,
        disabled: false,
      });
      firebaseUid = created.uid;
    }
  } catch (err) {
    logger.error(
      { err, rut: DEMO_CONDUCTOR_RUT },
      'ensureConductorDemoActivated: Firebase user create/update falló',
    );
    return;
  }

  // 3. UPDATE local DB para sincronizar el firebase_uid + email +
  //    limpiar el PIN de activación (ya no aplica, el flujo demo no
  //    pasa por driver-activate).
  try {
    await db
      .update(users)
      .set({
        firebaseUid,
        email: syntheticEmail,
        activationPinHash: null,
        status: 'activo',
        updatedAt: sql`now()`,
      })
      .where(eq(users.id, row.userId));
    logger.info(
      { rut: DEMO_CONDUCTOR_RUT, firebaseUid },
      'ensureConductorDemoActivated: conductor demo promovido a firebase real',
    );
  } catch (err) {
    logger.error(
      { err, userId: row.userId },
      'ensureConductorDemoActivated: DB update falló tras crear firebase user',
    );
  }
}
