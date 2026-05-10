/**
 * Helpers de 2FA opcional vía Firebase Phone Multi-Factor (ADR-028 §"Acciones derivadas §6").
 *
 * Estado: **infraestructura activable, no enforced**. Permite que un user
 * habilite 2FA por SMS desde su perfil; ningún flujo lo exige todavía.
 *
 * Decisión arquitectónica:
 *   - Usamos Firebase Phone Auth como segundo factor (Google maneja el
 *     SMS, free tier 10k/mes — suficiente para piloto). No reinventamos.
 *   - Frontend invoca `enrollPhoneAsSecondFactor()` que abre el flow
 *     reCAPTCHA + SMS verification en una sola call. El user-action es
 *     el handler de un botón "Activar 2FA" en `/me/security`.
 *   - Backend NO requiere cambios para 2FA: el ID token que Firebase
 *     emite tras enrollment incluye `firebase.sign_in_second_factor` y
 *     `firebase.identities.phone`, accesibles via `decodedToken` en el
 *     middleware de auth si en el futuro queremos enforce 2FA en
 *     endpoints sensibles (ADR-027 v2 cuando se active cobro).
 *
 * UI mínima viable (P1, no implementada en este commit):
 *   1. Página `/me/security` con sección "Autenticación de dos factores".
 *   2. Si user no tiene 2FA: botón "Activar 2FA por SMS" → llama
 *      `enrollPhoneAsSecondFactor()`.
 *   3. Si user ya tiene 2FA: mostrar últimos 4 dígitos del teléfono
 *      enrolled + botón "Desactivar".
 *   4. Login: cuando el user tiene 2FA, Firebase devuelve
 *      `MultiFactorError` en `signInWithEmailAndPassword` — el frontend
 *      llama `resolveMultiFactorSignIn()` para completar el flow.
 *
 * Pre-requisito de configuración:
 *   - Firebase Console → Authentication → Settings → SMS Multi-factor
 *     authentication: enable.
 *   - Cloud Identity Platform: upgrade tier (Identity Platform es
 *     superset de Firebase Auth con MFA. Free hasta 10k MAU).
 *   - reCAPTCHA Enterprise: ya activo si Phone Auth está activo
 *     (Firebase lo provisiona automáticamente).
 */

import {
  type Auth,
  type MultiFactorError,
  PhoneAuthProvider,
  PhoneMultiFactorGenerator,
  RecaptchaVerifier,
  getMultiFactorResolver,
  multiFactor,
} from 'firebase/auth';
import { logger } from './logger.js';

export interface EnrollOpts {
  /** Firebase Auth instance (apps/web/src/lib/firebase.ts:firebaseAuth). */
  auth: Auth;
  /** Número en formato E.164: +56912345678 */
  phoneE164: string;
  /** Container DOM id donde renderizar el reCAPTCHA invisible. */
  recaptchaContainerId: string;
  /** Función que pide al user el código SMS recibido (UI prompt). Retorna el código o null si cancela. */
  promptSmsCode: () => Promise<string | null>;
}

export type EnrollResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'no_user' | 'phone_invalid' | 'sms_cancelled' | 'sms_invalid' | 'unknown';
      detail?: string;
    };

/**
 * Inscribe el teléfono del user actual como segundo factor MFA.
 * Llamar desde un user-action (click). reCAPTCHA invisible se gatilla
 * automáticamente en el send.
 */
export async function enrollPhoneAsSecondFactor(opts: EnrollOpts): Promise<EnrollResult> {
  const user = opts.auth.currentUser;
  if (!user) {
    return { ok: false, reason: 'no_user' };
  }

  if (!/^\+\d{8,15}$/.test(opts.phoneE164)) {
    return { ok: false, reason: 'phone_invalid' };
  }

  try {
    const session = await multiFactor(user).getSession();
    const verifier = new RecaptchaVerifier(opts.auth, opts.recaptchaContainerId, {
      size: 'invisible',
    });

    const provider = new PhoneAuthProvider(opts.auth);
    const verificationId = await provider.verifyPhoneNumber(
      { phoneNumber: opts.phoneE164, session },
      verifier,
    );

    const code = await opts.promptSmsCode();
    if (!code) {
      verifier.clear();
      return { ok: false, reason: 'sms_cancelled' };
    }

    const cred = PhoneAuthProvider.credential(verificationId, code);
    const assertion = PhoneMultiFactorGenerator.assertion(cred);
    await multiFactor(user).enroll(assertion, 'SMS');

    verifier.clear();
    logger.info({ uid: user.uid }, '2FA SMS enrolled');
    return { ok: true };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    const code = (err as { code?: string } | null)?.code;
    if (code === 'auth/invalid-verification-code') {
      return { ok: false, reason: 'sms_invalid', detail };
    }
    logger.error({ err: detail, code }, 'enrollPhoneAsSecondFactor falló');
    return { ok: false, reason: 'unknown', detail };
  }
}

/**
 * Lista los segundos factores activos del user actual.
 * Útil para mostrar "Activar/Desactivar 2FA" en /me/security.
 */
export function listEnrolledSecondFactors(opts: { auth: Auth }): Array<{
  uid: string;
  displayName: string | null;
  factorId: string;
}> {
  const user = opts.auth.currentUser;
  if (!user) {
    return [];
  }
  return multiFactor(user).enrolledFactors.map((f) => ({
    uid: f.uid,
    displayName: f.displayName ?? null,
    factorId: f.factorId,
  }));
}

/**
 * Desactiva un segundo factor por su uid (típicamente el del SMS phone).
 */
export async function unenrollSecondFactor(opts: {
  auth: Auth;
  factorUid: string;
}): Promise<{ ok: boolean }> {
  const user = opts.auth.currentUser;
  if (!user) {
    return { ok: false };
  }
  try {
    await multiFactor(user).unenroll(opts.factorUid);
    logger.info({ uid: user.uid, factorUid: opts.factorUid }, '2FA factor unenrolled');
    return { ok: true };
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, 'unenroll falló');
    return { ok: false };
  }
}

/**
 * Resuelve un MultiFactorError de signInWith* — el flow es:
 *   try {
 *     await signInWithEmailAndPassword(auth, email, password);
 *   } catch (err) {
 *     if ((err as MultiFactorError).code === 'auth/multi-factor-auth-required') {
 *       const result = await resolveMultiFactorSignIn({ auth, error: err, recaptchaContainerId, promptSmsCode });
 *       if (!result.ok) ... handle
 *     }
 *   }
 */
export interface ResolveOpts {
  auth: Auth;
  error: MultiFactorError;
  recaptchaContainerId: string;
  promptSmsCode: () => Promise<string | null>;
}

export type ResolveResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'no_phone_factor' | 'sms_cancelled' | 'sms_invalid' | 'unknown';
      detail?: string;
    };

export async function resolveMultiFactorSignIn(opts: ResolveOpts): Promise<ResolveResult> {
  try {
    const resolver = getMultiFactorResolver(opts.auth, opts.error);
    const phoneHint = resolver.hints.find(
      (h) => h.factorId === PhoneMultiFactorGenerator.FACTOR_ID,
    );
    if (!phoneHint) {
      return { ok: false, reason: 'no_phone_factor' };
    }

    const verifier = new RecaptchaVerifier(opts.auth, opts.recaptchaContainerId, {
      size: 'invisible',
    });

    const provider = new PhoneAuthProvider(opts.auth);
    const verificationId = await provider.verifyPhoneNumber(
      { multiFactorHint: phoneHint, session: resolver.session },
      verifier,
    );

    const code = await opts.promptSmsCode();
    if (!code) {
      verifier.clear();
      return { ok: false, reason: 'sms_cancelled' };
    }

    const cred = PhoneAuthProvider.credential(verificationId, code);
    const assertion = PhoneMultiFactorGenerator.assertion(cred);
    await resolver.resolveSignIn(assertion);
    verifier.clear();
    return { ok: true };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    const code = (err as { code?: string } | null)?.code;
    if (code === 'auth/invalid-verification-code') {
      return { ok: false, reason: 'sms_invalid', detail };
    }
    logger.error({ err: detail, code }, 'resolveMultiFactorSignIn falló');
    return { ok: false, reason: 'unknown', detail };
  }
}
