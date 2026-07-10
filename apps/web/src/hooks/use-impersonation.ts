import { useEffect, useState } from 'react';
import { useAuth } from './use-auth.js';

export interface ImpersonationState {
  /**
   * `null` mientras el token no resuelve (primera carga); `true` si la sesión
   * es impersonada (custom claim `impersonated_by` presente); `false` en
   * cualquier otro caso (sesión normal o no logueado).
   */
  active: boolean | null;
  /** User id del platform-admin que impersona; `null` si no aplica. */
  impersonatedBy: string | null;
}

/**
 * Hook que indica si la sesión actual es una impersonación auditada (backend
 * #584). Lee el custom claim `impersonated_by` del ID token — el mismo patrón
 * que `useIsDemo` con `is_demo`. El backend mintea el token sobre el UID del
 * TARGET, así que el resto de la app (useMe, etc.) ya opera como el target; la
 * presencia del claim solo señala que hay un admin detrás.
 *
 * Los datos del target para el banner (nombre + empresa) salen de `useMe` — la
 * sesión ES el target.
 */
export function useImpersonation(): ImpersonationState {
  const { user, loading } = useAuth();
  const [state, setState] = useState<ImpersonationState>({ active: null, impersonatedBy: null });

  useEffect(() => {
    if (loading) {
      setState({ active: null, impersonatedBy: null });
      return;
    }
    if (!user) {
      setState({ active: false, impersonatedBy: null });
      return;
    }
    let cancelled = false;
    user
      .getIdTokenResult()
      .then((result) => {
        if (cancelled) {
          return;
        }
        const raw = result.claims.impersonated_by;
        const impersonatedBy = typeof raw === 'string' && raw.length > 0 ? raw : null;
        setState({ active: impersonatedBy !== null, impersonatedBy });
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setState({ active: false, impersonatedBy: null });
      });
    return () => {
      cancelled = true;
    };
  }, [user, loading]);

  return state;
}
