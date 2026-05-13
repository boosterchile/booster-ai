import { useEffect, useState } from 'react';
import { useAuth } from './use-auth.js';

/**
 * Hook que indica si el user actual está logueado con un custom token
 * de modo demo (subdominio demo.boosterchile.com). Lee el custom claim
 * `is_demo: true` que el backend setea al mintear el custom token via
 * `POST /demo/login`.
 *
 * Devuelve `null` mientras el token todavía no resuelve (primera carga).
 * Devuelve `true` si user tiene `claims.is_demo === true`.
 * Devuelve `false` en cualquier otro caso (incluyendo no logueado).
 *
 * Usado por `DemoBanner` y por surfaces que quieran badge "demo" inline.
 */
export function useIsDemo(): boolean | null {
  const { user, loading } = useAuth();
  const [isDemo, setIsDemo] = useState<boolean | null>(null);

  useEffect(() => {
    if (loading) {
      setIsDemo(null);
      return;
    }
    if (!user) {
      setIsDemo(false);
      return;
    }
    let cancelled = false;
    user
      .getIdTokenResult()
      .then((result) => {
        if (cancelled) {
          return;
        }
        setIsDemo(result.claims.is_demo === true);
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setIsDemo(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user, loading]);

  return isDemo;
}
