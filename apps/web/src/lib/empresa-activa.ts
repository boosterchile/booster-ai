import { useMemo, useSyncExternalStore } from 'react';
import { getActiveEmpresaId, subscribeActiveEmpresaId } from './api-client.js';

/**
 * Datos que pertenecen a la empresa activa y por eso llevan su id en la
 * clave de TanStack Query (plan multi-tenant, `.specs/aislamiento-hallazgos-tenant/plan.md` §2.D).
 *
 * Invariante que sostiene este módulo: una entrada de caché cuya clave dice
 * empresa X solo contiene datos pedidos con `X-Empresa-Id: X`. Para eso la
 * clave y el header salen del mismo valor (`useEmpresaScope`), no de dos
 * lecturas distintas de localStorage en momentos distintos.
 *
 * El `empresaId` va DESPUÉS del segmento de dominio. Las invalidaciones por
 * prefijo que ya existen (`invalidateQueries({ queryKey: ['vehiculos'] })`)
 * siguen matcheando; dos empresas nunca comparten entrada.
 */
export type DominioEmpresa =
  | 'vehiculos'
  | 'flota'
  | 'trayectos-teltonika'
  | 'conductores'
  | 'conductores-list-for-assignment'
  | 'sucursales'
  | 'cumplimiento'
  | 'certificates'
  | 'cargas'
  | 'assignments'
  | 'offers'
  | 'liquidaciones'
  | 'cobra-hoy';

/** Marcador para sesiones sin empresa activa (onboarding, stakeholder). */
export const SIN_EMPRESA = 'sin-empresa';

export function empresaKey(
  empresaId: string | null,
  dominio: DominioEmpresa,
  ...resto: readonly unknown[]
): readonly unknown[] {
  return [dominio, empresaId ?? SIN_EMPRESA, ...resto];
}

/** `RequestInit` que fija el tenant del request al de la clave. */
export function empresaInit(empresaId: string | null): RequestInit {
  return empresaId ? { headers: { 'X-Empresa-Id': empresaId } } : {};
}

/** Empresa activa como estado reactivo: cambia en cuanto `setActiveEmpresaId` escribe. */
export function useActiveEmpresaId(): string | null {
  return useSyncExternalStore(subscribeActiveEmpresaId, getActiveEmpresaId, () => null);
}

export interface EmpresaScope {
  empresaId: string | null;
  key: (dominio: DominioEmpresa, ...resto: readonly unknown[]) => readonly unknown[];
  init: RequestInit;
}

export function useEmpresaScope(): EmpresaScope {
  const empresaId = useActiveEmpresaId();
  return useMemo(
    () => ({
      empresaId,
      key: (dominio: DominioEmpresa, ...resto: readonly unknown[]) =>
        empresaKey(empresaId, dominio, ...resto),
      init: empresaInit(empresaId),
    }),
    [empresaId],
  );
}
