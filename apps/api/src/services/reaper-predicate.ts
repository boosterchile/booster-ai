/**
 * T7 / SC-G3 — predicado puro del reaper de cuentas IdP inertes.
 *
 * Spec: .specs/sec-001-h1-2-google-boundary-closure/spec.md SC-G3 + §10.
 * Plan: .specs/sec-001-h1-2-google-boundary-closure/plan.md T7.
 * ADR: docs/adr/057-google-signup-boundary-and-reaper-supersedes-054.md.
 *
 * Decide si una cuenta IdP es **reapable** (candidata a disable/delete). Puro
 * y sin IO: el runner (T8) hace `listUsers` + las queries y le pasa los facts.
 *
 * Salvaguardas (todas deben permitir el reap para que `reapable=true`):
 *   - **Scope OQ-G3**: solo Google + email presente (excluye phone/SAML → R-G8).
 *   - **never-reapable**: allowlist (PO `dev@boosterchile.com`).
 *   - **dual-guard (T2/T2b)**: NO existe fila `usuarios` por `firebase_uid`
 *     NI por email degradado (post account-linking el uid puede diferir).
 *   - **pipeline (T3/T4)**: NO hay solicitud `pendiente_aprobacion`/`aprobado`.
 *   - **grace (T5/T5b)**: creationTime **y** lastSignInTime más añejos que
 *     `graceDays`. Si falta lastSignInTime → conservador (no reapable).
 *
 * Match de email degradado (OQ-G6=(b)): lowercase+trim, inclusivo — NO
 * canónico (NFC/IDN/plus). El dual-guard es de seguridad → inclusivo evita
 * false-positive reap de una fila guardada en forma cruda. El normalizador
 * compartido real + backfill se difieren a Stream B; este `normalizeReaperEmail`
 * debe mantenerse en sync con el `LOWER(TRIM())` del SQL del runner (T8) y con
 * `classify-google-idp-accounts.ts` (T4).
 */

/** OQ-G1: grace por defecto (30 días) — atado a la población self-signup-sin-solicitud. */
export const DEFAULT_REAPER_GRACE_DAYS = 30;

const MS_PER_DAY = 86_400_000;

export interface ProviderRef {
  providerId: string;
}

export interface ReaperIdpAccount {
  uid: string;
  email?: string | null;
  providerData: readonly ProviderRef[];
  /** RFC1123/ISO desde `UserRecord.metadata.creationTime`. */
  creationTime: string;
  /** RFC1123/ISO desde `metadata.lastSignInTime`; ausente si nunca firmó. */
  lastSignInTime?: string | null;
}

/** Fila candidata de `usuarios` (del dual-match `uid OR LOWER(TRIM(email))`). */
export interface ReaperUsersRow {
  firebaseUid: string;
  email: string;
}

export interface ReaperFacts {
  usersRows: readonly ReaperUsersRow[];
  /** `solicitudes_registro` en `pendiente_aprobacion` o `aprobado`. */
  solicitudActive: boolean;
}

export interface ReaperConfig {
  now: Date;
  graceDays: number;
  /** Emails (forma degradada) que nunca se reapan. */
  neverReapable: ReadonlySet<string>;
}

export interface ReaperVerdict {
  reapable: boolean;
  reason: string;
}

/** Normaliza al MISMO degradado guardado (OQ-G6): lowercase + trim. */
export function normalizeReaperEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isGoogleWithEmail(account: ReaperIdpAccount): boolean {
  if (!account.email) {
    return false;
  }
  return account.providerData.some((p) => p.providerId === 'google.com');
}

/** True si `iso` representa un instante estrictamente más añejo que `cutoff` (ms). */
function isAgedBeyond(iso: string | null | undefined, cutoffMs: number): boolean {
  if (!iso) {
    return false; // ausente → no se puede confirmar añejez → conservador.
  }
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) {
    return false; // fecha inválida → conservador.
  }
  return ms < cutoffMs;
}

/**
 * Decide si la cuenta es reapable. Orden de salvaguardas: scope → never-reapable
 * → dual-guard → pipeline → grace. La primera que aplique decide `reapable=false`.
 */
export function isReapable(
  account: ReaperIdpAccount,
  facts: ReaperFacts,
  cfg: ReaperConfig,
): ReaperVerdict {
  if (!isGoogleWithEmail(account)) {
    return { reapable: false, reason: 'fuera de scope: no es Google con email (OQ-G3)' };
  }

  const degraded = normalizeReaperEmail(account.email as string);

  if (cfg.neverReapable.has(degraded)) {
    return { reapable: false, reason: 'never-reapable allowlist (PO)' };
  }

  const uidMatch = facts.usersRows.some((r) => r.firebaseUid === account.uid);
  const emailMatch = facts.usersRows.some((r) => normalizeReaperEmail(r.email) === degraded);
  if (uidMatch || emailMatch) {
    const by = [uidMatch ? 'uid' : null, emailMatch ? 'email' : null].filter(Boolean).join('+');
    return { reapable: false, reason: `hard-guard: fila usuarios (match por ${by})` };
  }

  if (facts.solicitudActive) {
    return {
      reapable: false,
      reason: 'pipeline: solicitud_registro pendiente_aprobacion|aprobado',
    };
  }

  const cutoffMs = cfg.now.getTime() - cfg.graceDays * MS_PER_DAY;
  const creationAged = isAgedBeyond(account.creationTime, cutoffMs);
  const lastSignInAged = isAgedBeyond(account.lastSignInTime, cutoffMs);
  if (!creationAged || !lastSignInAged) {
    return {
      reapable: false,
      reason: `dentro de grace (${cfg.graceDays}d): creationAged=${creationAged} lastSignInAged=${lastSignInAged}`,
    };
  }

  return {
    reapable: true,
    reason: 'INERT: sin users + sin solicitud + añeja (creation+lastSignIn)',
  };
}
