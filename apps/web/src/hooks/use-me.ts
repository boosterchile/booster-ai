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
  role:
    | 'dueno'
    | 'admin'
    | 'despachador'
    | 'conductor'
    | 'visualizador'
    | 'stakeholder_sostenibilidad';
  status: 'pendiente_invitacion' | 'activa' | 'suspendida' | 'removida';
  joined_at: string | null;
  /**
   * Empresa de la membership. NULL cuando la membership es a una
   * organización stakeholder (XOR — ADR-034).
   */
  empresa: {
    id: string;
    legal_name: string;
    rut: string;
    is_generador_carga: boolean;
    is_transportista: boolean;
    status: 'pendiente_verificacion' | 'activa' | 'suspendida';
  } | null;
  /**
   * ADR-034 — Organización stakeholder de la membership. NULL cuando la
   * membership es a una empresa (XOR). Aparece solo para users con rol
   * `stakeholder_sostenibilidad` en una organización dada de alta por
   * platform-admin.
   *
   * Opcional para tolerar respuestas pre-Wave 3 (clientes cacheados).
   */
  organizacion_stakeholder?: {
    id: string;
    nombre_legal: string;
    tipo: 'regulador' | 'gremio' | 'observatorio_academico' | 'ong' | 'corporativo_esg';
    region_ambito: string | null;
    sector_ambito: string | null;
  } | null;
}

export interface MeUser {
  id: string;
  email: string;
  full_name: string;
  phone: string | null;
  whatsapp_e164: string | null;
  rut: string | null;
  is_platform_admin: boolean;
  status: 'pendiente_verificacion' | 'activo' | 'suspendido' | 'eliminado';
}

export interface MeRegistered {
  needs_onboarding: false;
  user: MeUser;
  memberships: MembershipPayload[];
  active_membership: MembershipPayload | null;
}

export type MeResponse = MeNeedsOnboarding | MeRegistered;

export function useMe(opts: { enabled: boolean }) {
  return useQuery<MeResponse>({
    queryKey: ['me'],
    queryFn: () => api.get<MeResponse>('/me'),
    enabled: opts.enabled,
    staleTime: 30_000,
    retry: (failureCount, error) => {
      if (error instanceof ApiError && (error.status === 401 || error.status === 404)) {
        return false;
      }
      return failureCount < 3;
    },
  });
}
