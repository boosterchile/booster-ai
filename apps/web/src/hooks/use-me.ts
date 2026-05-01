import { useQuery } from '@tanstack/react-query';
import { ApiError, api } from '../lib/api-client.js';

/**
 * Forma de la respuesta de GET /me. Cuando el user no está registrado en
 * la DB de Booster (post-Firebase signup pre-onboarding), `needs_onboarding`
 * es true y `user` viene null.
 */
export interface MeNeedsOnboarding {
  needs_onboarding: true;
  firebase: {
    uid: string;
    email: string | undefined;
    name: string | undefined;
    picture: string | undefined;
    email_verified: boolean;
  };
}

export interface MembershipPayload {
  id: string;
  role: 'owner' | 'admin' | 'dispatcher' | 'driver' | 'viewer';
  status: 'pending_invitation' | 'active' | 'suspended' | 'removed';
  joined_at: string | null;
  empresa: {
    id: string;
    legal_name: string;
    rut: string;
    is_shipper: boolean;
    is_carrier: boolean;
    status: 'pending_verification' | 'active' | 'suspended';
  };
}

export interface MeUser {
  id: string;
  email: string;
  full_name: string;
  phone: string | null;
  whatsapp_e164: string | null;
  rut: string | null;
  is_platform_admin: boolean;
  status: 'pending_verification' | 'active' | 'suspended' | 'deleted';
}

export interface MeRegistered {
  needs_onboarding: false;
  user: MeUser;
  memberships: MembershipPayload[];
  active_membership: MembershipPayload | null;
}

export type MeResponse = MeNeedsOnboarding | MeRegistered;

/**
 * Hook que carga /me — el contexto del user autenticado. Solo enabled si
 * `userIsLoggedIn` es true (después de useAuth().user resuelto a User).
 *
 * staleTime=30s — el contexto rara vez cambia entre interacciones; el
 * refetch ocurre cuando el user cambia de empresa activa o re-loguea.
 */
export function useMe(opts: { enabled: boolean }) {
  return useQuery<MeResponse>({
    queryKey: ['me'],
    queryFn: () => api.get<MeResponse>('/me'),
    enabled: opts.enabled,
    staleTime: 30_000,
    retry: (failureCount, error) => {
      // No reintentar 401 (token bad), 404 (user no registrado).
      if (error instanceof ApiError && (error.status === 401 || error.status === 404)) {
        return false;
      }
      return failureCount < 3;
    },
  });
}
