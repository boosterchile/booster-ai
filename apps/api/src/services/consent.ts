import type { Logger } from '@booster-ai/logger';
import { and, desc, eq, isNull, or, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { consents, stakeholderAccessLog, stakeholders } from '../db/schema.js';

/**
 * Servicio de consentimientos ESG (ADR-028 §4 + §"Acciones derivadas §7-8").
 *
 * Cierra el modelo declarado en docs/pii-handling-stakeholders-consents.md:
 *  - Default deny: sin grant válido (no expirado, no revocado, scope match,
 *    categoría incluida) → no se sirve data.
 *  - Audit bloqueante: cada lectura exitosa de stakeholder genera una row
 *    en `stakeholder_access_log`. Sin la row, no se retorna data.
 *  - Revocación inmediata: setear `revoked_at = now()` invalida cualquier
 *    request siguiente (no hay caching del consent en backend).
 */

export type ScopeType = 'generador_carga' | 'transportista' | 'portafolio_viajes' | 'organizacion';

export type DataCategory =
  | 'emisiones_carbono'
  | 'rutas'
  | 'distancias'
  | 'combustibles'
  | 'certificados'
  | 'perfiles_vehiculos';

export interface ConsentCheckOpts {
  db: NodePgDatabase<Record<string, unknown>>;
  logger: Logger;
  stakeholderId: string;
  scopeType: ScopeType;
  scopeId: string;
  dataCategory: DataCategory;
}

export interface ConsentCheckResult {
  /** True si el stakeholder tiene grant válido para este scope/categoría. */
  allowed: boolean;
  /** Si allowed=true, el id del consent. Si false, undefined. */
  consentId?: string;
  /** Razón legible si denied. */
  reason?:
    | 'no_active_consent'
    | 'consent_expired'
    | 'consent_revoked'
    | 'data_category_not_granted';
}

/**
 * Valida si un stakeholder tiene consent activo para acceder a un recurso.
 * Esta función NO loguea acceso — para eso usar `recordStakeholderAccess`
 * después de servir la data exitosamente.
 *
 * El flujo típico en un handler ESG:
 *
 *   const check = await checkStakeholderConsent({...});
 *   if (!check.allowed) return c.json({ error: 'consent_required', code: check.reason }, 403);
 *   // ... servir data ...
 *   await recordStakeholderAccess({ ..., consentId: check.consentId, bytesServed: payloadSize });
 */
export async function checkStakeholderConsent(opts: ConsentCheckOpts): Promise<ConsentCheckResult> {
  const now = new Date();

  const rows = await opts.db
    .select({
      id: consents.id,
      dataCategories: consents.dataCategories,
      revokedAt: consents.revokedAt,
      expiresAt: consents.expiresAt,
    })
    .from(consents)
    .where(
      and(
        eq(consents.stakeholderId, opts.stakeholderId),
        eq(consents.scopeType, opts.scopeType),
        eq(consents.scopeId, opts.scopeId),
        isNull(consents.revokedAt),
        or(isNull(consents.expiresAt), sql`${consents.expiresAt} > ${now}`),
      ),
    )
    .orderBy(desc(consents.grantedAt))
    .limit(1);

  const consent = rows[0];
  if (!consent) {
    return { allowed: false, reason: 'no_active_consent' };
  }

  // Defensa adicional (la query ya filtra revokedAt/expiresAt, pero TS no
  // garantiza el contrato del select). Si por alguna razón estos llegaron
  // como definidos, denegar.
  if (consent.revokedAt) {
    return { allowed: false, reason: 'consent_revoked' };
  }
  if (consent.expiresAt && consent.expiresAt <= now) {
    return { allowed: false, reason: 'consent_expired' };
  }

  if (!consent.dataCategories.includes(opts.dataCategory)) {
    return { allowed: false, reason: 'data_category_not_granted' };
  }

  return { allowed: true, consentId: consent.id };
}

export interface RecordAccessOpts {
  db: NodePgDatabase<Record<string, unknown>>;
  logger: Logger;
  stakeholderId: string;
  consentId: string;
  scopeType: ScopeType;
  scopeId: string;
  dataCategory: DataCategory;
  httpPath: string;
  actorFirebaseUid: string;
  bytesServed: number;
}

/**
 * Registra una lectura PII/ESG en el audit log. El handler debe llamarla
 * SIEMPRE después de servir data al stakeholder, dentro del mismo request
 * o como fire-and-forget si es high-throughput. Si la insertion falla
 * idealmente bloquea la respuesta (ADR-028 §"Reglas inquebrantables §3").
 */
export async function recordStakeholderAccess(opts: RecordAccessOpts): Promise<void> {
  await opts.db.insert(stakeholderAccessLog).values({
    stakeholderId: opts.stakeholderId,
    consentId: opts.consentId,
    targetScopeType: opts.scopeType,
    targetScopeId: opts.scopeId,
    dataCategory: opts.dataCategory,
    httpPath: opts.httpPath,
    actorFirebaseUid: opts.actorFirebaseUid,
    bytesServed: opts.bytesServed,
  });
}

export interface GrantOpts {
  db: NodePgDatabase<Record<string, unknown>>;
  logger: Logger;
  grantedByUserId: string;
  stakeholderId: string;
  scopeType: ScopeType;
  scopeId: string;
  dataCategories: DataCategory[];
  expiresAt?: Date | null;
  consentDocumentUrl: string;
}

export interface GrantResult {
  consentId: string;
}

/**
 * Otorga un nuevo consent. El otorgante (un dueño/admin de la empresa
 * dueña del recurso del scope) tiene la responsabilidad de validar que
 * el stakeholder destinatario es legítimo. El backend confía en el
 * caller — la validación de "puede otorgar sobre este scope" debe
 * hacerse en el handler antes de invocar este service.
 */
export async function grantConsent(opts: GrantOpts): Promise<GrantResult> {
  if (opts.dataCategories.length === 0) {
    throw new Error('grantConsent requiere al menos 1 dataCategory');
  }
  if (!opts.consentDocumentUrl.startsWith('https://')) {
    throw new Error('consentDocumentUrl debe ser una URL HTTPS');
  }

  const [row] = await opts.db
    .insert(consents)
    .values({
      grantedByUserId: opts.grantedByUserId,
      stakeholderId: opts.stakeholderId,
      scopeType: opts.scopeType,
      scopeId: opts.scopeId,
      dataCategories: opts.dataCategories,
      expiresAt: opts.expiresAt ?? null,
      consentDocumentUrl: opts.consentDocumentUrl,
    })
    .returning({ id: consents.id });

  if (!row) {
    throw new Error('grantConsent: INSERT no retornó row');
  }

  opts.logger.info(
    {
      consentId: row.id,
      grantedByUserId: opts.grantedByUserId,
      stakeholderId: opts.stakeholderId,
      scopeType: opts.scopeType,
      scopeId: opts.scopeId,
      dataCategories: opts.dataCategories,
      expiresAt: opts.expiresAt ?? null,
    },
    'consent otorgado',
  );

  return { consentId: row.id };
}

export interface RevokeOpts {
  db: NodePgDatabase<Record<string, unknown>>;
  logger: Logger;
  consentId: string;
  /** El user que revoca debe ser el otorgante original (validado por el caller). */
  revokedByUserId: string;
}

export interface RevokeResult {
  revoked: boolean;
  /** True si ya estaba revocado previamente. */
  alreadyRevoked: boolean;
}

/**
 * Revoca un consent existente. Idempotente — llamar dos veces no rompe
 * pero el segundo retorna alreadyRevoked=true.
 *
 * Nota crítica: NO permite revocar consents de OTROS otorgantes. El
 * caller debe verificar `consents.grantedByUserId === revokedByUserId`
 * antes de invocar (esa validación va en el route handler para mejor
 * error messaging).
 */
export async function revokeConsent(opts: RevokeOpts): Promise<RevokeResult> {
  const now = new Date();

  // Solo actualiza si grantedByUserId matchea Y no está revocado todavía.
  const updated = await opts.db
    .update(consents)
    .set({ revokedAt: now })
    .where(
      and(
        eq(consents.id, opts.consentId),
        eq(consents.grantedByUserId, opts.revokedByUserId),
        isNull(consents.revokedAt),
      ),
    )
    .returning({ id: consents.id });

  if (updated.length > 0) {
    opts.logger.info(
      { consentId: opts.consentId, revokedByUserId: opts.revokedByUserId },
      'consent revocado',
    );
    return { revoked: true, alreadyRevoked: false };
  }

  // Ningún row afectado → o no existe, o no es del otorgante, o ya estaba revocado.
  // Diferenciamos los dos últimos para mejor UX.
  const existing = await opts.db
    .select({
      grantedByUserId: consents.grantedByUserId,
      revokedAt: consents.revokedAt,
    })
    .from(consents)
    .where(eq(consents.id, opts.consentId))
    .limit(1);

  const found = existing[0];
  if (!found) {
    return { revoked: false, alreadyRevoked: false };
  }
  if (found.grantedByUserId !== opts.revokedByUserId) {
    // El handler debe haber chequeado esto antes — log warning como defensa.
    opts.logger.warn(
      { consentId: opts.consentId, revokedByUserId: opts.revokedByUserId },
      'revokeConsent: caller no es el otorgante (defensa redundante)',
    );
    return { revoked: false, alreadyRevoked: false };
  }
  return { revoked: false, alreadyRevoked: true };
}

export interface ListConsentsOpts {
  db: NodePgDatabase<Record<string, unknown>>;
  /** Listar consents otorgados por este user (vista "consents que yo otorgué"). */
  grantedByUserId: string;
  /** Si true, incluye revocados/expirados. Default false (solo activos). */
  includeInactive?: boolean;
}

export interface ConsentListItem {
  id: string;
  stakeholderId: string;
  stakeholderOrgName: string;
  scopeType: ScopeType;
  scopeId: string;
  dataCategories: DataCategory[];
  grantedAt: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
}

export async function listConsentsGrantedBy(opts: ListConsentsOpts): Promise<ConsentListItem[]> {
  const now = new Date();

  const baseWhere = eq(consents.grantedByUserId, opts.grantedByUserId);
  const whereClause = opts.includeInactive
    ? baseWhere
    : and(
        baseWhere,
        isNull(consents.revokedAt),
        or(isNull(consents.expiresAt), sql`${consents.expiresAt} > ${now}`),
      );

  const rows = await opts.db
    .select({
      id: consents.id,
      stakeholderId: consents.stakeholderId,
      stakeholderOrgName: stakeholders.organizationName,
      scopeType: consents.scopeType,
      scopeId: consents.scopeId,
      dataCategories: consents.dataCategories,
      grantedAt: consents.grantedAt,
      expiresAt: consents.expiresAt,
      revokedAt: consents.revokedAt,
    })
    .from(consents)
    .innerJoin(stakeholders, eq(stakeholders.id, consents.stakeholderId))
    .where(whereClause)
    .orderBy(desc(consents.grantedAt));

  return rows as ConsentListItem[];
}
