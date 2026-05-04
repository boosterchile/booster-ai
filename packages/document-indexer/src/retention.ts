import { type DocumentType, documentTypesWithLegalRetention } from '@booster-ai/shared-schemas';

/**
 * Años de retención legal según ADR-007 (Ley 19.983, Resolución Exenta
 * SII N° 80/2014, Ley 18.290 Art. 174). Booster aplica 6 años; el
 * lifecycle policy del bucket archiva tier después de 2 años (cost) y
 * delete después de 7 años (defensa en profundidad).
 */
export const LEGAL_RETENTION_YEARS = 6;

export function isLegallyRetained(type: DocumentType): boolean {
  return documentTypesWithLegalRetention.includes(type);
}

/**
 * Calcula `retention_until` (ISO 8601) sumando los años legales al
 * timestamp `emittedAt`. Devuelve null para tipos sin retención.
 */
export function computeRetentionUntil(opts: {
  type: DocumentType;
  emittedAt: Date | string;
}): string | null {
  if (!isLegallyRetained(opts.type)) {
    return null;
  }
  const at = typeof opts.emittedAt === 'string' ? new Date(opts.emittedAt) : opts.emittedAt;
  const target = new Date(at.getTime());
  target.setUTCFullYear(target.getUTCFullYear() + LEGAL_RETENTION_YEARS);
  return target.toISOString();
}
