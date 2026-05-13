import { Navigate } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useAuth } from '../hooks/use-auth.js';
import { useFeatureFlags } from '../hooks/use-feature-flags.js';
import { type MeResponse, useMe } from '../hooks/use-me.js';
import { RotarClaveModal } from './auth/RotarClaveModal.js';

export interface ProtectedRouteProps {
  /**
   * Comportamiento sobre `/me`:
   *   - 'require-onboarded' (default): user tiene que estar registrado en
   *     la DB con empresa. Si needs_onboarding → redirige a /onboarding.
   *   - 'allow-pre-onboarding': permite users que aún no completaron
   *     onboarding (típicamente la propia ruta /onboarding).
   *   - 'skip': no llama a /me. Solo chequea Firebase auth. Para rutas
   *     que solo necesitan saber que el user firmó pero no su contexto
   *     de empresa.
   */
  meRequirement?: 'require-onboarded' | 'allow-pre-onboarding' | 'skip';

  /**
   * Render con acceso al contexto resuelto. Para `'require-onboarded'` el
   * `me` siempre es `MeRegistered`. Para `'allow-pre-onboarding'` puede ser
   * cualquiera de los dos. Para `'skip'` siempre `null`.
   */
  children: (ctx: ProtectedContext) => ReactNode;
}

export type ProtectedContext =
  | { kind: 'onboarded'; me: Extract<MeResponse, { needs_onboarding: false }> }
  | { kind: 'pre-onboarding'; me: Extract<MeResponse, { needs_onboarding: true }> }
  | { kind: 'unmanaged' /* meRequirement === 'skip' */ };

/**
 * Wrapper que centraliza:
 *   1. loading state mientras Firebase resuelve auth
 *   2. redirect a /login si no hay user
 *   3. fetch de /me y manejo de needs_onboarding según meRequirement
 *   4. propaga el contexto resuelto al children como function-as-children
 *
 * Esto evita duplicar la cascada de redirects en cada ruta protegida.
 */
export function ProtectedRoute({
  meRequirement = 'require-onboarded',
  children,
}: ProtectedRouteProps) {
  const { user, loading: authLoading } = useAuth();
  const { flags } = useFeatureFlags();

  const meEnabled = !!user && meRequirement !== 'skip';
  const { data: me, isLoading: meLoading, error: meError } = useMe({ enabled: meEnabled });

  // Splash mientras Firebase resuelve el primer estado.
  if (authLoading) {
    return <FullPageSplash />;
  }

  if (!user) {
    return <Navigate to="/login" />;
  }

  if (meRequirement === 'skip') {
    return <>{children({ kind: 'unmanaged' })}</>;
  }

  if (meEnabled && meLoading) {
    return <FullPageSplash />;
  }

  // 404 user_not_registered viene como error del hook; needs_onboarding=true
  // viene en el body OK. Tratamos ambos como pre-onboarding.
  const isPreOnboarding = !!meError || (me && me.needs_onboarding === true);

  if (meRequirement === 'require-onboarded') {
    if (isPreOnboarding) {
      return <Navigate to="/onboarding" />;
    }
    if (!me || me.needs_onboarding) {
      // Defensive: si me está inconsistente, mejor onboarding que crash.
      return <Navigate to="/onboarding" />;
    }
    // ADR-035 Wave 4 PR 3 — si el flag universal está activo Y el user
    // todavía no creó su clave numérica, montamos el modal forzado sobre
    // el children. El children sigue siendo accesible (se renderiza
    // debajo del overlay) pero el modal bloquea la interacción hasta
    // que el user crea la clave o el flag se apaga.
    //
    // `has_clave_numerica` es opcional en la response /me para tolerar
    // versiones del API pre-Wave 4 PR 3. Tratamos `undefined` como
    // "ya seteada" (no forzamos) — para legacy users no se rompe nada.
    const needsClaveRotation =
      flags.auth_universal_v1_activated && me.user.has_clave_numerica === false;
    return (
      <>
        {children({ kind: 'onboarded', me })}
        {needsClaveRotation && <RotarClaveModal />}
      </>
    );
  }

  // meRequirement === 'allow-pre-onboarding'
  if (me && me.needs_onboarding === false) {
    // User ya está onboardeado, no debería estar en /onboarding.
    return <Navigate to="/app" />;
  }
  if (me && me.needs_onboarding === true) {
    return <>{children({ kind: 'pre-onboarding', me })}</>;
  }
  // meError + needs_onboarding=undefined: tratar como pre-onboarding.
  // Synthesize un objeto mínimo (sin firebase claims que vienen del api,
  // pero el caller no debería depender de ellos en este edge case).
  return (
    <>
      {children({
        kind: 'pre-onboarding',
        me: {
          needs_onboarding: true,
          firebase: {
            uid: user.uid,
            email: user.email ?? undefined,
            name: user.displayName ?? undefined,
            picture: user.photoURL ?? undefined,
            email_verified: user.emailVerified,
          },
        },
      })}
    </>
  );
}

function FullPageSplash() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50">
      <div className="font-medium text-neutral-500 text-sm">Cargando…</div>
    </div>
  );
}
