/**
 * Cálculo de `retention_until` (frente F4, ADR-070, dominio crítico).
 *
 * La lógica canónica vive en `@booster-ai/transport-documents` (C-4: la lógica
 * de dominio vive en packages, no inline en apps). El worker TED (4b) y los
 * endpoints de `apps/api` (4a) comparten exactamente la misma función — esto es
 * un re-export para que el código de 4a no se rompa y NO haya dos copias del
 * cálculo divergiendo (un borrado prematuro de un documento tributario es un
 * problema legal, no un bug interno).
 */

export {
  calcularRetentionUntil,
  type RetentionResult,
} from '@booster-ai/transport-documents';
