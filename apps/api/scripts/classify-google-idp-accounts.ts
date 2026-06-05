#!/usr/bin/env tsx
/**
 * T4 / SC-G2 — clasificación de cuentas IdP Google existentes (read-only).
 *
 * Spec: .specs/sec-001-h1-2-google-boundary-closure/spec.md SC-G2.
 * Plan: .specs/sec-001-h1-2-google-boundary-closure/plan.md T4.
 * ADR: docs/adr/057-google-signup-boundary-and-reaper-supersedes-054.md.
 *
 * Regenera el inventario de cuentas IdP **contra el estado ACTUAL** vía
 * Admin SDK `listUsers` (paginado) — NO hereda el `ghost-users-dry-run.csv`
 * viejo (DA R2 N2: snapshot stale para una decisión destructiva). Cruza cada
 * cuenta Google contra `usuarios` + `solicitudes_registro` y la clasifica:
 *
 *   - LEGITIMATE: tiene fila `usuarios` (dual-match uid OR email degradado),
 *     o está en el allowlist never-reapable. Fuera del scope del reaper.
 *   - PENDING:    sin fila `usuarios`, pero con `solicitudes_registro` en
 *     `pendiente_aprobacion`/`aprobado` (en el pipeline de aprobación).
 *   - INERT:      sin fila `usuarios` ni solicitud activa → candidato del
 *     reaper. El PO decide por cada una (auditable: timestamp + rationale).
 *
 * Decisiones OQ (oq-resolution.md, confirmadas PO):
 *   - OQ-G3: Google-only + email-present (excluye phone/SAML → elimina R-G8).
 *   - OQ-G6: match degradado lowercase+trim (inclusivo, no canónico NFC/IDN);
 *     el dual-guard es de seguridad → inclusivo evita false-positive reap.
 *
 * **Read-only**: NO `auth.updateUser`, NO `auth.deleteUser`, NO writes a DB.
 *
 * Contexto de ejecución (run operacional, no en CI):
 *   gcloud auth application-default login + IAP tunnel al `db-bastion`
 *   (DATABASE_URL apuntando al túnel), luego:
 *     pnpm --filter @booster-ai/api exec tsx scripts/classify-google-idp-accounts.ts
 *   Output: .specs/sec-001-h1-2-google-boundary-closure/existing-google-accounts-classification.md
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { initializeApp } from 'firebase-admin/app';
import { type Auth, getAuth } from 'firebase-admin/auth';
import pg from 'pg';

/**
 * Allowlist never-reapable (emails en forma degradada, lowercase+trim).
 * El PO (`dev@boosterchile.com`) nunca entra al scope del reaper. Compartido
 * conceptualmente con el predicado del reaper (T7) — debe permanecer en sync.
 */
export const NEVER_REAPABLE_EMAILS: ReadonlySet<string> = new Set(['dev@boosterchile.com']);

export type Classification = 'LEGITIMATE' | 'PENDING' | 'INERT';

export interface ProviderRef {
  providerId: string;
}

/** Normaliza al MISMO degradado con que se guardó el dato (OQ-G6): lowercase + trim. */
export function normalizeEmailDegraded(email: string): string {
  return email.trim().toLowerCase();
}

/** OQ-G3: solo cuentas con provider `google.com` Y email presente entran al scope. */
export function isGoogleWithEmail(user: {
  email?: string | null;
  providerData: readonly ProviderRef[];
}): boolean {
  if (!user.email) {
    return false;
  }
  return user.providerData.some((p) => p.providerId === 'google.com');
}

export interface ClassifyInput {
  email: string;
  /** fila `usuarios` matcheada por `firebase_uid`. */
  uidMatch: boolean;
  /** fila `usuarios` matcheada por `LOWER(TRIM(email))` (forma degradada OQ-G6). */
  emailMatch: boolean;
  /** `solicitudes_registro` en `pendiente_aprobacion` o `aprobado`. */
  solicitudActive: boolean;
  /** allowlist never-reapable (emails degradados). */
  neverReapable: ReadonlySet<string>;
}

/**
 * Decide la clasificación. Orden: never-reapable > users row (dual-match) >
 * solicitud activa > inerte. El dual-match es inclusivo (uid OR email) para
 * NO perder una fila legítima guardada en forma cruda (false-positive reap).
 */
export function classifyAccount(input: ClassifyInput): {
  classification: Classification;
  reason: string;
} {
  const normalized = normalizeEmailDegraded(input.email);

  if (input.neverReapable.has(normalized)) {
    return { classification: 'LEGITIMATE', reason: 'never-reapable allowlist (PO)' };
  }
  if (input.uidMatch || input.emailMatch) {
    const by = [input.uidMatch ? 'uid' : null, input.emailMatch ? 'email' : null]
      .filter(Boolean)
      .join('+');
    return { classification: 'LEGITIMATE', reason: `fila usuarios (match por ${by})` };
  }
  if (input.solicitudActive) {
    return {
      classification: 'PENDING',
      reason: 'solicitudes_registro pendiente_aprobacion|aprobado',
    };
  }
  return {
    classification: 'INERT',
    reason: 'sin fila usuarios + sin solicitud activa → candidato reaper',
  };
}

export interface ClassifiedAccount {
  firebaseUid: string;
  email: string;
  displayName: string;
  createdAt: string;
  lastSignInAt: string;
  classification: Classification;
  reason: string;
}

export interface PoolLike {
  query(
    sql: string,
    params: unknown[],
  ): Promise<{ rows: Array<Record<string, unknown>>; rowCount: number | null }>;
}

/**
 * Lista las cuentas IdP Google (paginado) y las clasifica vía cross-ref DB.
 * Read-only. `neverReapable` por defecto = NEVER_REAPABLE_EMAILS.
 */
export async function classifyGoogleIdpAccounts(
  auth: Pick<Auth, 'listUsers'>,
  pool: PoolLike,
  neverReapable: ReadonlySet<string> = NEVER_REAPABLE_EMAILS,
): Promise<ClassifiedAccount[]> {
  const out: ClassifiedAccount[] = [];
  let pageToken: string | undefined;
  do {
    const page = await auth.listUsers(1000, pageToken);
    for (const user of page.users) {
      if (!isGoogleWithEmail(user)) {
        continue;
      }
      const email = user.email as string;
      const degraded = normalizeEmailDegraded(email);

      // Dual-match contra usuarios: uid OR email degradado (inclusivo, OQ-G6).
      const usersRes = await pool.query(
        'SELECT (firebase_uid = $1) AS uid_match, (LOWER(TRIM(email)) = $2) AS email_match FROM usuarios WHERE firebase_uid = $1 OR LOWER(TRIM(email)) = $2 LIMIT 1',
        [user.uid, degraded],
      );
      const uidMatch = usersRes.rows.some((r) => r.uid_match === true);
      const emailMatch = usersRes.rows.some((r) => r.email_match === true);

      // Solicitud activa (pendiente o aprobada) por email degradado.
      const solRes = await pool.query(
        "SELECT 1 FROM solicitudes_registro WHERE LOWER(TRIM(email)) = $1 AND estado IN ('pendiente_aprobacion','aprobado') LIMIT 1",
        [degraded],
      );
      const solicitudActive = (solRes.rowCount ?? 0) > 0;

      const { classification, reason } = classifyAccount({
        email,
        uidMatch,
        emailMatch,
        solicitudActive,
        neverReapable,
      });

      out.push({
        firebaseUid: user.uid,
        email,
        displayName: user.displayName ?? '',
        createdAt: user.metadata.creationTime,
        lastSignInAt: user.metadata.lastSignInTime ?? '',
        classification,
        reason,
      });
    }
    pageToken = page.pageToken;
  } while (pageToken);
  return out;
}

const escapeCell = (value: string): string =>
  // Escapar el backslash PRIMERO: email/displayName son controlados por el usuario, y si un `\`
  // del input no se escapa, el escaping de `|` queda reversible/ambiguo y se puede inyectar una
  // columna en la tabla markdown del reporte (CodeQL js/incomplete-sanitization).
  value
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\n/g, ' ');

/** Genera el reporte markdown con conteo por categoría + columna de decisión PO para INERT. */
export function toMarkdownReport(accounts: readonly ClassifiedAccount[]): string {
  const counts: Record<Classification, number> = { LEGITIMATE: 0, PENDING: 0, INERT: 0 };
  for (const a of accounts) {
    counts[a.classification] += 1;
  }

  const lines: string[] = [];
  lines.push('# Clasificación de cuentas IdP Google existentes (T4 / SC-G2)');
  lines.push('');
  lines.push(
    '> ⚠️ **CONTIENE PII (email + displayName, Ley 19.628) — NO COMMITEAR.** Este archivo `.generated.md` está en `.gitignore`. Revisar localmente para la decisión PO; no subir al repo.',
  );
  lines.push('');
  lines.push(
    '> Generado por `apps/api/scripts/classify-google-idp-accounts.ts` (read-only) contra el estado IdP actual (Admin SDK `listUsers`). Scope OQ-G3 (Google-only + email). Match OQ-G6 (lowercase+trim).',
  );
  lines.push('');
  lines.push('## Resumen');
  lines.push('');
  lines.push('| Categoría | Cuentas |');
  lines.push('|---|---|');
  lines.push(`| LEGITIMATE | ${counts.LEGITIMATE} |`);
  lines.push(`| PENDING | ${counts.PENDING} |`);
  lines.push(`| INERT | ${counts.INERT} |`);
  lines.push(`| **Total** | **${accounts.length}** |`);
  lines.push('');
  lines.push('## Detalle');
  lines.push('');
  lines.push(
    '| firebaseUid | email | displayName | createdAt | lastSignInAt | clasificación | rationale | Decisión PO (solo INERT) |',
  );
  lines.push('|---|---|---|---|---|---|---|---|');
  for (const a of accounts) {
    const decision = a.classification === 'INERT' ? '_(pendiente: timestamp + rationale)_' : '—';
    lines.push(
      `| ${escapeCell(a.firebaseUid)} | ${escapeCell(a.email)} | ${escapeCell(a.displayName)} | ${escapeCell(a.createdAt)} | ${escapeCell(a.lastSignInAt)} | ${a.classification} | ${escapeCell(a.reason)} | ${decision} |`,
    );
  }
  lines.push('');
  lines.push(
    '> **Acción PO**: por cada fila INERT, registrar decisión (reap / conservar) con timestamp + rationale. `dev@boosterchile.com` nunca es reapable (allowlist).',
  );
  lines.push('');
  return lines.join('\n');
}

async function main(): Promise<void> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error(
      '[classify-google-idp-accounts] ERROR: DATABASE_URL no definida. Requiere IAP tunnel al db-bastion. Ver header del script.',
    );
    process.exit(1);
  }

  initializeApp();
  const auth = getAuth();
  const pool = new pg.Pool({ connectionString: dbUrl, max: 2 });

  try {
    console.log('[classify-google-idp-accounts] listando cuentas IdP Google…');
    // never-reapable DEBE coincidir con el runtime del reaper (admin-jobs.ts) y
    // con main() del runner: platform-admins + dev@. Si no, el reporte que el PO
    // revisa podría marcar un platform-admin como INERT que el reaper nunca
    // tocaría (REVIEW finding D). Se lee la env directo para no cargar el config
    // Zod completo en un script CLI.
    const platformAdmins = (process.env.BOOSTER_PLATFORM_ADMIN_EMAILS ?? '')
      .split(',')
      .map((e) => normalizeEmailDegraded(e))
      .filter((e) => e.length > 0);
    const neverReapable = new Set<string>([...platformAdmins, ...NEVER_REAPABLE_EMAILS]);

    const accounts = await classifyGoogleIdpAccounts(auth, pool, neverReapable);
    const inert = accounts.filter((a) => a.classification === 'INERT').length;
    console.log(
      `[classify-google-idp-accounts] ${accounts.length} cuentas Google; ${inert} INERT (candidatas reaper).`,
    );

    const md = toMarkdownReport(accounts);
    // El reporte con datos reales contiene email + displayName (PII, Ley 19.628)
    // → se escribe a un archivo `.generated.md` que está en .gitignore. NO se
    // commitea con datos reales. El template versionado (sin datos) vive en
    // `existing-google-accounts-classification.md` (REVIEW finding E).
    const outputPath = new URL(
      '../../../.specs/sec-001-h1-2-google-boundary-closure/existing-google-accounts-classification.generated.md',
      import.meta.url,
    ).pathname;
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, md);
    console.log(
      `[classify-google-idp-accounts] reporte (CON PII, NO COMMITEAR) escrito en ${outputPath}`,
    );
  } finally {
    await pool.end();
  }
}

const isMain = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((err) => {
    console.error('[classify-google-idp-accounts] failed:', err);
    process.exit(1);
  });
}
