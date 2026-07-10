import { Button } from '@booster-ai/ui-components';
import { useNavigate } from '@tanstack/react-router';
import { signOutUser } from '../hooks/use-auth.js';
import { useImpersonation } from '../hooks/use-impersonation.js';
import { useMe } from '../hooks/use-me.js';

/**
 * Banner de impersonación auditada (backend #584). Fijo arriba, imposible de
 * ignorar (`role="alert"`, tono `danger`), visible durante toda la sesión
 * impersonada. Reusa el patrón de `DemoBanner` pero en D2 (Button + tokens
 * semánticos, sin hardcode de color).
 *
 * El botón **Salir** cierra la sesión (signOut) y devuelve al login —
 * re-autenticación como admin, sin guardar/restaurar sesión (decisión sellada
 * del PO: a prueba de balas, la comodidad se difiere).
 */

export interface ImpersonationBannerViewProps {
  targetName: string;
  empresa: string | null;
  onExit: () => void;
}

/** Presentacional (props). Testeable + axe sin hooks. */
export function ImpersonationBannerView({
  targetName,
  empresa,
  onExit,
}: ImpersonationBannerViewProps) {
  return (
    <div
      data-testid="impersonation-banner"
      role="alert"
      className="sticky top-0 z-50 flex items-center justify-between gap-4 bg-danger-600 px-4 py-2 text-neutral-0 text-sm"
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className="text-base" aria-hidden>
          👁️
        </span>
        <span className="truncate font-medium">
          Estás viendo como <span className="font-semibold">{targetName}</span>
          {empresa ? (
            <>
              {' · '}
              <span className="font-semibold">{empresa}</span>
            </>
          ) : null}
        </span>
      </div>
      <Button variant="secondary" onClick={onExit}>
        Salir
      </Button>
    </div>
  );
}

/** Container: se self-gatea con useImpersonation; datos del target vía useMe. */
export function ImpersonationBanner() {
  const { active } = useImpersonation();
  const me = useMe({ enabled: active === true });
  const navigate = useNavigate();

  if (active !== true) {
    return null;
  }

  const data = me.data;
  const registered = data && data.needs_onboarding === false ? data : null;
  const targetName = registered?.user.full_name ?? '…';
  const empresa = registered?.active_membership?.empresa?.legal_name ?? null;

  async function handleExit() {
    await signOutUser();
    void navigate({ to: '/login' });
  }

  return <ImpersonationBannerView targetName={targetName} empresa={empresa} onExit={handleExit} />;
}
