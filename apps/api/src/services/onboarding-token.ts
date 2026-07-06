import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

/**
 * onboarding-flow-redesign T1.2 — token one-shot que autoriza el onboarding
 * admin-provisioned (predicado de seguridad del fix SEC-001).
 *
 * MECANISMO (decisión del PO 2026-06-08): token **HMAC-firmado**, alineado al
 * plan/spec aprobados + ADR-001 (los mecanismos de auth/secreto son contrato de
 * seguridad). Un panel de diseño recomendó un token opaco+sha256 sin secreto
 * (más simple); el PO eligió mantener la firma. Ver `.specs/onboarding-flow-redesign/`
 * y el ledger (design_decision T1.2).
 *
 * Formato del token: `<payloadB64url>.<tagB64url>`
 *   - payload = JSON { sid, exp, nonce } codificado base64url (URL-safe para el
 *     link de email).
 *   - tag = HMAC-SHA256(secret, payloadB64url) — autentica e integra el payload.
 *
 * RESPONSABILIDAD / LÍMITES:
 *   - Lib **pura**: sin DB, sin red, sin reloj ambiente (el `now` se inyecta).
 *     El secreto se inyecta como argumento — el cableado del env
 *     `ONBOARDING_TOKEN_SIGNING_SECRET` (Secret Manager / Cloud Run) vive en el
 *     caller (T1.3 emite, T1.5b verifica).
 *   - `verifyOnboardingToken` es el pre-gate barato (firma + expiración). NO es
 *     el gate de un-solo-uso: el consumo atómico (`UPDATE solicitudes_registro
 *     SET consumido_en=now() WHERE id=? AND consumido_en IS NULL RETURNING`) vive
 *     en T1.5a. Por eso esta lib NO lee `consumido_en` (evita el footgun TOCTOU).
 *   - El route (T1.5b) DEBE colapsar invalid/expired/no-row/ya-consumido en UNA
 *     respuesta genérica para preservar la postura anti-enumeration de SEC-001
 *     (sin oráculo de existencia/expiración). Esta lib no recibe email → no puede
 *     filtrar existencia por construcción. NUNCA loguear el `token` en claro;
 *     a lo sumo el `tokenHash`.
 *
 * Crypto: reutiliza primitivas ya establecidas en el repo — HMAC-SHA256
 * (createHmac), `timingSafeEqual` con length-guard (cf. clave-numerica.ts),
 * `randomBytes` para el nonce, y `createHash('sha256')` para el hash de DB
 * (mismo patrón que signup-request.ts).
 */

/** Bytes del nonce aleatorio embebido en el payload (defensa "firmado con nonce"). */
const NONCE_BYTES = 16;

/**
 * Mínimo del secreto de firma: 256 bits. Fail-closed — un secreto ausente/débil
 * NUNCA debe poder acuñar ni aceptar tokens. HMAC-SHA256 deriva su seguridad de
 * una clave de al menos el tamaño del bloque de salida.
 */
const MIN_SECRET_BYTES = 32;

const HMAC_ALG = 'sha256';
const SEPARATOR = '.';

/**
 * W1.5 (runbook activación) — prefijo del placeholder que Terraform siembra en
 * Secret Manager (`ROTATE_ME_<NAME>_PLACEHOLDER`, ver
 * `infrastructure/security.tf`) para que Cloud Run pueda montar el secret
 * antes de la rotación real. El placeholder de
 * `onboarding-token-signing-secret` mide >= 32 bytes y por tanto PASA el
 * chequeo de longitud de `assertStrongSecret` — sin este denylist, un
 * `terraform apply` sin rotar dejaría el api firmando/verificando tokens con
 * un valor público (visible en el HCL versionado). Fail-closed: cualquier
 * secreto que empiece con este prefijo se trata como débil sin importar su
 * longitud. El flip a `ADMIN_PROVISIONED_ONBOARDING_ENABLED=true` exige
 * rotación real ANTES (ver `docs/corfo/hito-2/runbook-activacion-onboarding.md`).
 */
const PLACEHOLDER_SECRET_PREFIX = 'ROTATE_ME_';

/**
 * Cota superior barata del tamaño del token aceptado por verify. Rechaza antes
 * de computar el HMAC, evitando gastar un HMAC sobre un payload gigante de un
 * atacante (defensa-en-profundidad; el token real ronda ~200 chars).
 */
const MAX_TOKEN_LENGTH = 4096;

const payloadSchema = z.object({
  /** `solicitudes_registro.id` (uuid) de la solicitud aprobada. */
  sid: z.string().uuid(),
  /** Expiración como epoch ms. */
  exp: z.number().int().positive(),
  /** Nonce aleatorio base64url — dos tokens de la misma solicitud difieren. */
  nonce: z.string().min(1),
});
type TokenPayload = z.infer<typeof payloadSchema>;

const createOptsSchema = z.object({
  solicitudId: z.string().uuid(),
  ttlMs: z.number().int().positive().finite(),
});

/**
 * Resultado de la verificación. `'invalid'` colapsa firma mala / formato malo /
 * hex malo / longitud mala SIN oráculo que los distinga (espejo de
 * `verifyClaveNumerica`, que retorna `false` uniforme).
 */
export type OnboardingTokenVerification =
  | { ok: true; solicitudId: string; expiraEn: Date }
  | { ok: false; reason: 'invalid' | 'expired' };

function assertStrongSecret(secret: string): void {
  if (Buffer.byteLength(secret, 'utf8') < MIN_SECRET_BYTES) {
    throw new Error(
      `onboarding-token: signing secret too weak (need >= ${MIN_SECRET_BYTES} bytes). Fail-closed: a missing/weak secret must never mint or accept tokens.`,
    );
  }
  if (secret.startsWith(PLACEHOLDER_SECRET_PREFIX)) {
    throw new Error(
      `onboarding-token: signing secret is the unrotated Terraform placeholder (prefix "${PLACEHOLDER_SECRET_PREFIX}"). Fail-closed: rotate the secret with \`gcloud secrets versions add onboarding-token-signing-secret\` before enabling the flow.`,
    );
  }
}

function sign(payloadB64: string, secret: string): Buffer {
  return createHmac(HMAC_ALG, secret).update(payloadB64).digest();
}

/**
 * Hash sha256 (hex) del token completo, persistido en
 * `solicitudes_registro.token_hash` (T1.3). Es **defensa en profundidad** vía el
 * índice único parcial — NO el localizador de la fila. El consumo atómico (T1.5a)
 * localiza la fila por el `sid` FIRMADO (`UPDATE ... WHERE id = solicitudId AND
 * consumido_en IS NULL RETURNING`), nunca recomputando el hash desde el token de
 * la URL; opcionalmente puede ligar `AND token_hash = ?` como defensa adicional.
 * Esto es robusto a la canonicalización (ver el guard de canonicalidad en verify).
 * NUNCA se guarda el token en claro. Mismo primitivo que `signup-request.ts`.
 */
export function hashOnboardingToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Emite un token one-shot firmado para una solicitud aprobada.
 * `now`/`ttlMs` controlan la expiración (el valor de TTL — OQ1 — lo decide el
 * caller/config, nunca se hardcodea acá). Lanza si el secreto es débil o si
 * `ttlMs`/`solicitudId` son inválidos (errores de configuración del servidor).
 */
export function createOnboardingToken(opts: {
  solicitudId: string;
  ttlMs: number;
  secret: string;
  now?: Date;
}): { token: string; tokenHash: string; expiraEn: Date } {
  assertStrongSecret(opts.secret);
  const { solicitudId, ttlMs } = createOptsSchema.parse({
    solicitudId: opts.solicitudId,
    ttlMs: opts.ttlMs,
  });

  const exp = (opts.now ?? new Date()).getTime() + ttlMs;
  const payload: TokenPayload = {
    sid: solicitudId,
    exp,
    nonce: randomBytes(NONCE_BYTES).toString('base64url'),
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const tagB64 = sign(payloadB64, opts.secret).toString('base64url');
  const token = `${payloadB64}${SEPARATOR}${tagB64}`;

  return { token, tokenHash: hashOnboardingToken(token), expiraEn: new Date(exp) };
}

/**
 * Verifica un token presentado. Orden deliberado: FIRMA antes de tocar el
 * payload o la expiración — no se confía en datos no firmados ni se revela el
 * estado de expiración de un token forjado. NUNCA lanza ante input del atacante
 * (token malformado → `invalid`); solo lanza si el secreto del servidor es débil.
 */
export function verifyOnboardingToken(opts: {
  token: string;
  secret: string;
  now?: Date;
}): OnboardingTokenVerification {
  assertStrongSecret(opts.secret);
  const invalid = { ok: false, reason: 'invalid' } as const;

  // Cota de tamaño barata antes de gastar un HMAC (defensa-en-profundidad).
  if (opts.token.length > MAX_TOKEN_LENGTH) {
    return invalid;
  }

  const parts = opts.token.split(SEPARATOR);
  if (parts.length !== 2) {
    return invalid;
  }
  const payloadB64 = parts[0];
  const tagB64 = parts[1];
  if (!payloadB64 || !tagB64) {
    return invalid;
  }

  // 1) Firma primero (constant-time, con length-guard porque timingSafeEqual
  //    lanza ante longitudes distintas).
  const presentedTag = Buffer.from(tagB64, 'base64url');
  const expectedTag = sign(payloadB64, opts.secret);
  if (presentedTag.length !== expectedTag.length) {
    return invalid;
  }
  if (!timingSafeEqual(presentedTag, expectedTag)) {
    return invalid;
  }
  // Canonicalidad del tag: base64url NO es canónico (los bits sobrantes del
  // último char hacen que varias cadenas decodifiquen a los mismos bytes). Tras
  // confirmar la firma, exigimos que el tag presentado SEA la codificación
  // canónica, así cada token emitido tiene exactamente una representación y
  // `token_hash` es 1:1 con un token verificable. (review adversarial T1.2)
  if (presentedTag.toString('base64url') !== tagB64) {
    return invalid;
  }

  // 2) Firma válida → decodificar + validar payload (defensivo). También exigimos
  //    canonicalidad del payload (misma razón que el tag).
  const payloadBytes = Buffer.from(payloadB64, 'base64url');
  if (payloadBytes.toString('base64url') !== payloadB64) {
    return invalid;
  }
  let parsed: TokenPayload;
  try {
    parsed = payloadSchema.parse(JSON.parse(payloadBytes.toString('utf8')));
  } catch {
    return invalid;
  }

  // 3) Expiración (capa de rechazo de acceso; la higiene del huérfano es T1.7).
  if ((opts.now ?? new Date()).getTime() >= parsed.exp) {
    return { ok: false, reason: 'expired' };
  }

  return { ok: true, solicitudId: parsed.sid, expiraEn: new Date(parsed.exp) };
}
