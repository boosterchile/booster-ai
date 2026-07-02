import type { Logger } from '@booster-ai/logger';
import type { PersonaDemo } from '@booster-ai/shared-schemas';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Auth } from 'firebase-admin/auth';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { cuentasDemo } from '../db/schema.js';
import { lookupOrCreateCuentaDemoEmail } from './seed-demo.js';

/**
 * T4 SEC-001 Sprint 2a — harden-demo-accounts service module.
 *
 * Operaciones de gestión de las 4 cuentas demo post-disclosure
 * replacement (ADR-053):
 *   - `recreateAll`: idempotent create de 4 UIDs nuevas con claims
 *     {is_demo, persona, expires_at: now+30d}.
 *   - `retire(uid)`: marca UID como disabled en Firebase + escribe audit
 *     log + UPDATE cuentas_demo.deshabilitado_en.
 *   - `retireOldBatch`: convenience que retira los 4 UIDs viejas
 *     hardcoded (post-disclosure operation one-shot).
 *   - `renew(uid, extendDays)`: actualiza customClaims.expires_at.
 *   - Todos los métodos aceptan `dryRun: true` para simulate sin SDK/DB
 *     writes (usado en staging rehearsal antes de prod one-shot).
 *
 * Service module separado del CLI wrapper (apps/api/scripts/
 * harden-demo-accounts.mjs) para permitir unit tests con mocks de
 * Firebase Admin + Drizzle. CLI wrapper hace arg parsing + dispatch.
 *
 * Spec: .specs/sec-001-cierre/spec.md §3 H1.1 SC-1.1.1 + SC-1.1.2 +
 * SC-1.1.4 + SC-1.1.5. Plan: plan-sprint-2a.md T4. ADR-053.
 */

/**
 * Formato de un Firebase UID. Alfanumérico, 20-128 chars (los UIDs reales
 * son de 28). Rechaza guiones, `@`, espacios, strings cortos o basura larga.
 */
const firebaseUidSchema = z.string().regex(/^[A-Za-z0-9]{20,128}$/, 'Firebase UID inválido');

/**
 * Parser self-contained de `DEMO_OLD_UIDS` (CSV de Firebase UIDs).
 *
 * F2 P0-C (`.specs/p0c-uids-demo-secret-manager/spec.md`): las 4 UIDs viejas
 * post-disclosure (ADR-053) eran PII hardcodeada en el código vivo. Salen del
 * código y se leen de una env var validada por Zod. CSV (consistente con
 * `API_AUDIENCE`/`CORS_ALLOWED_ORIGINS`; un UID no contiene comas).
 *
 * Contrato:
 *   - ausente/"" → `[]` (no lanza; el batch es no-op seguro).
 *   - CSV con espacios/elementos vacíos → trimmed + filtrados.
 *   - cualquier entrada que no matchee `firebaseUidSchema` → throw Zod
 *     (fail-fast: no se acepta una lista de UIDs malformada).
 *
 * NO importa `config.ts` a propósito: el service corre standalone desde el
 * CLI wrapper (`scripts/harden-demo-accounts.mjs`, sobre `dist/`) sin el env
 * completo del API; acoplarlo a `parseEnv(apiEnvSchema)` mataría el CLI
 * (`process.exit(1)` por env incompleta). Mismo precedente que
 * `getPasswordForPersona` (abajo).
 */
const demoOldUidsSchema = z
  .string()
  .optional()
  .transform((s) =>
    (s ?? '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean),
  )
  .pipe(z.array(firebaseUidSchema));

/** Lee + valida `DEMO_OLD_UIDS` (CSV) desde el entorno. Default source = process.env. */
export function getDemoOldUids(source: NodeJS.ProcessEnv = process.env): string[] {
  return demoOldUidsSchema.parse(source.DEMO_OLD_UIDS);
}

/** Las 4 personas que recreate genera (en orden de iteración). */
const PERSONAS_RECREATE: ReadonlyArray<PersonaDemo> = [
  'generador_carga',
  'transportista',
  'stakeholder',
  'conductor',
];

const TTL_DEFAULT_DAYS = 30;
const RETIRE_REASON = 'post-disclosure replacement 2026-05-24 (ADR-053)';

interface HardenOpts {
  db: Db;
  firebaseAuth: Auth;
  logger: Logger;
  dryRun?: boolean;
  /**
   * UIDs viejas a retirar en `retireOldBatch` (F2 P0-C, inyección por opts).
   * Si se omite, el batch cae a `getDemoOldUids()` (env `DEMO_OLD_UIDS`).
   * Lista vacía → no-op seguro. Permite testear sin tocar `process.env`.
   */
  oldUids?: readonly string[];
}

interface RecreateResult {
  created: number;
  skipped: number;
  emails: Array<{ persona: PersonaDemo; email: string; firebaseUid: string | null }>;
}

interface RetireResult {
  retired: number;
  skippedAlreadyDisabled: number;
  failed: Array<{ uid: string; reason: string }>;
}

/** Compute ISO-8601 UTC timestamp para `now + days`. */
function expiresAtIsoDays(days: number): string {
  return new Date(Date.now() + days * 86400 * 1000).toISOString();
}

/**
 * Lookup password per-persona desde env var. Mismo mapping que
 * `getDemoPasswordForPersona` en seed-demo.ts pero re-implementado acá
 * para evitar dependencia circular si seed-demo importa este service
 * en el futuro.
 */
function getPasswordForPersona(persona: PersonaDemo): string {
  const suffix = (
    {
      generador_carga: 'SHIPPER_2026',
      transportista: 'CARRIER_2026',
      stakeholder: 'STAKEHOLDER_2026',
      conductor: 'CONDUCTOR_FIREBASE_2026',
    } as const
  )[persona];
  const envKey = `DEMO_ACCOUNT_PASSWORD_${suffix}`;
  const pw = process.env[envKey];
  if (!pw || pw.trim() === '') {
    throw new Error(
      `${envKey} env var ausente o vacía (persona=${persona}). Verifica que terraform apply de T2 + init-demo-secrets-2026.sh corrieron + que el script local importó el env desde gcloud secrets.`,
    );
  }
  return pw;
}

/**
 * Idempotent create de 4 UIDs nuevas. Por cada persona:
 *   1. lookupOrCreateCuentaDemoEmail → email determinístico (sincroniza
 *      cuentas_demo row si no existe).
 *   2. firebaseAuth.getUserByEmail(email): si existe + active, skip
 *      (idempotent); si existe + disabled, alert + skip (estado raro);
 *      si NO existe, createUser + setCustomUserClaims + UPDATE
 *      cuentas_demo.firebase_uid.
 *   3. customClaims: { is_demo: true, persona, expires_at: now+30d }.
 *
 * dry-run: no llama createUser ni setCustomUserClaims ni UPDATE DB.
 * Output del log permite verificar el plan antes de ejecución real.
 */
export async function recreateAll(opts: HardenOpts): Promise<RecreateResult> {
  const { db, firebaseAuth, logger, dryRun = false } = opts;
  const expiresAt = expiresAtIsoDays(TTL_DEFAULT_DAYS);
  const result: RecreateResult = { created: 0, skipped: 0, emails: [] };

  for (const persona of PERSONAS_RECREATE) {
    const email = await lookupOrCreateCuentaDemoEmail(db, persona);
    const existing = await firebaseAuth.getUserByEmail(email).catch(() => null);

    if (existing && !existing.disabled) {
      logger.info(
        { persona, email, firebaseUid: existing.uid, dryRun },
        'harden-demo-accounts.recreate: persona already active, skip',
      );
      result.skipped += 1;
      result.emails.push({ persona, email, firebaseUid: existing.uid });
      continue;
    }

    if (existing?.disabled) {
      logger.warn(
        { persona, email, firebaseUid: existing.uid, dryRun },
        'harden-demo-accounts.recreate: Firebase user exists but disabled — estado inconsistente. Skipping. Manual intervention requerida.',
      );
      result.skipped += 1;
      result.emails.push({ persona, email, firebaseUid: existing.uid });
      continue;
    }

    if (dryRun) {
      logger.info(
        { persona, email, dryRun: true, planned_expires_at: expiresAt },
        'harden-demo-accounts.recreate: DRY-RUN would createUser + setCustomUserClaims + UPDATE cuentas_demo.firebase_uid',
      );
      result.created += 1;
      result.emails.push({ persona, email, firebaseUid: null });
      continue;
    }

    const password = getPasswordForPersona(persona);
    const created = await firebaseAuth.createUser({
      email,
      emailVerified: false,
      password,
      displayName: `Demo ${persona} (Sprint 2a)`,
      disabled: false,
    });
    await firebaseAuth.setCustomUserClaims(created.uid, {
      is_demo: true,
      persona,
      expires_at: expiresAt,
    });
    await db
      .update(cuentasDemo)
      .set({ firebaseUid: created.uid })
      .where(eq(cuentasDemo.email, email));

    logger.info(
      { persona, email, firebaseUid: created.uid, expiresAt },
      'harden-demo-accounts.recreate: created new Firebase user + custom claims + DB synced',
    );
    result.created += 1;
    result.emails.push({ persona, email, firebaseUid: created.uid });
  }

  return result;
}

/**
 * Retire single UID: marca como disabled en Firebase + escribe audit log
 * (custom claim `audit_demo_uid_retired` con timestamp + reason) +
 * UPDATE cuentas_demo.deshabilitado_en = now() WHERE firebase_uid = X.
 *
 * Idempotent: si ya está disabled, skip + log.
 *
 * dry-run: no llama updateUser ni UPDATE DB.
 */
export async function retire(
  opts: HardenOpts & { uid: string; reason?: string },
): Promise<{ status: 'retired' | 'already_disabled' | 'not_found' }> {
  const { firebaseAuth, db, logger, uid, reason = RETIRE_REASON, dryRun = false } = opts;

  const user = await firebaseAuth.getUser(uid).catch(() => null);
  if (!user) {
    logger.warn({ uid, dryRun }, 'harden-demo-accounts.retire: UID no existe en Firebase');
    return { status: 'not_found' };
  }
  if (user.disabled) {
    logger.info(
      { uid, email: user.email, dryRun },
      'harden-demo-accounts.retire: UID already disabled, skip (idempotent)',
    );
    return { status: 'already_disabled' };
  }
  if (dryRun) {
    logger.info(
      { uid, email: user.email, dryRun: true, reason },
      'harden-demo-accounts.retire: DRY-RUN would updateUser(disabled:true) + UPDATE cuentas_demo.deshabilitado_en',
    );
    return { status: 'retired' };
  }

  await firebaseAuth.updateUser(uid, { disabled: true });
  // Audit log via custom claim — sobrevive a queries auth.getUser() futuras
  // y queda en Firebase audit log automáticamente al setCustomUserClaims.
  const existingClaims = (user.customClaims ?? {}) as Record<string, unknown>;
  await firebaseAuth.setCustomUserClaims(uid, {
    ...existingClaims,
    audit_demo_uid_retired: { at: new Date().toISOString(), reason },
  });
  await db
    .update(cuentasDemo)
    .set({ deshabilitadoEn: sql`now()` })
    .where(eq(cuentasDemo.firebaseUid, uid));

  // T6a SEC-001 Sprint 2a — structured event field para google_logging_metric
  // filter (jsonPayload.event = "audit.demo_uid_retired"). Cada retire produce
  // 1 datapoint en el counter metric. Full batch (4 UIDs) → 4 events.
  logger.info(
    { event: 'audit.demo_uid_retired', uid, email: user.email, reason },
    'harden-demo-accounts.retire: UID disabled + audit log + cuentas_demo.deshabilitado_en synced',
  );
  return { status: 'retired' };
}

/**
 * Retire las UIDs viejas post-disclosure (one-shot ADR-053). Idempotent +
 * resume-from-partial-retire: si alguna ya está disabled (script falló
 * mid-batch previamente), skip + counter; si una falla, continúa con las
 * siguientes y reporta failure al final.
 *
 * F2 P0-C: la lista de UIDs ya NO está hardcoded. Viene de `opts.oldUids`
 * (inyección, p.ej. desde el CLI/tests) con fallback a `getDemoOldUids()`
 * (env `DEMO_OLD_UIDS` validada por Zod). Lista vacía/ausente → no-op seguro:
 * retorna `{ retired: 0, ... }`, loguea `warn` y NO toca Firebase SDK ni DB.
 *
 * dry-run: no muta nada; solo simula y reporta el plan.
 */
export async function retireOldBatch(opts: HardenOpts): Promise<RetireResult> {
  const { logger, dryRun = false } = opts;
  const oldUids = opts.oldUids ?? getDemoOldUids();
  const result: RetireResult = { retired: 0, skippedAlreadyDisabled: 0, failed: [] };

  if (oldUids.length === 0) {
    logger.warn(
      { dryRun },
      'harden-demo-accounts.retireOldBatch: DEMO_OLD_UIDS ausente/vacía — nada que retirar; no-op',
    );
    return result;
  }

  for (const uid of oldUids) {
    try {
      const r = await retire({ ...opts, uid });
      if (r.status === 'retired') {
        result.retired += 1;
      } else if (r.status === 'already_disabled') {
        result.skippedAlreadyDisabled += 1;
      } else {
        result.failed.push({ uid, reason: 'not_found' });
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      logger.error({ uid, err, dryRun }, 'harden-demo-accounts.retireOldBatch: failure');
      result.failed.push({ uid, reason });
    }
  }

  logger.info(
    {
      retired: result.retired,
      skipped: result.skippedAlreadyDisabled,
      failed: result.failed.length,
      dryRun,
    },
    'harden-demo-accounts.retireOldBatch: batch complete',
  );
  return result;
}

/**
 * Renueva el `expires_at` claim de un UID (extiende TTL). Idempotent —
 * cualquier UID válido active acepta nueva extensión.
 *
 * dry-run: no muta nada.
 */
export async function renew(
  opts: HardenOpts & { uid: string; extendDays: number },
): Promise<{ status: 'renewed' | 'not_found' | 'disabled'; newExpiresAt?: string }> {
  const { firebaseAuth, logger, uid, extendDays, dryRun = false } = opts;

  const user = await firebaseAuth.getUser(uid).catch(() => null);
  if (!user) {
    logger.warn({ uid, dryRun }, 'harden-demo-accounts.renew: UID no existe');
    return { status: 'not_found' };
  }
  if (user.disabled) {
    logger.warn(
      { uid, dryRun },
      'harden-demo-accounts.renew: UID disabled, no se puede renovar (retire previo)',
    );
    return { status: 'disabled' };
  }
  const newExpiresAt = expiresAtIsoDays(extendDays);
  if (dryRun) {
    logger.info(
      { uid, email: user.email, extendDays, plannedExpiresAt: newExpiresAt, dryRun: true },
      'harden-demo-accounts.renew: DRY-RUN would setCustomUserClaims with new expires_at',
    );
    return { status: 'renewed', newExpiresAt };
  }
  const existingClaims = (user.customClaims ?? {}) as Record<string, unknown>;
  await firebaseAuth.setCustomUserClaims(uid, { ...existingClaims, expires_at: newExpiresAt });
  logger.info(
    { uid, email: user.email, extendDays, newExpiresAt },
    'harden-demo-accounts.renew: expires_at extended',
  );
  return { status: 'renewed', newExpiresAt };
}

/** Re-export drizzle helpers for tests inspecting internal queries. */
export const _internal = { and, isNull };
