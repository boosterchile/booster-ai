import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import {
  ImpersonationBannerView,
  type ImpersonationBannerViewProps,
} from '../components/ImpersonationBanner.js';
import {
  ImpersonationPickerView,
  type ImpersonationTarget,
} from '../components/ImpersonationPicker.js';

/**
 * /apariencia/impersonacion — preview PÚBLICO del flujo de impersonación con
 * datos MOCK (como `/apariencia/shell`). Sirve a la revisión visual del PO y al
 * E2E (que no puede autenticarse ni mintear tokens reales en e2e-local): monta
 * los mismos `*View` de producción y simula el ciclo picker → "Ver como" →
 * banner → Salir sin backend/Firebase.
 */

const MOCK_TARGETS: ImpersonationTarget[] = [
  { id: 'u1', full_name: 'Ana Demo', empresa: 'Andina Demo S.A.', role: 'dueno' },
  { id: 'u2', full_name: 'Beto Demo', empresa: 'Transportes Demo Sur S.A.', role: 'despachador' },
];

export function AparienciaImpersonacionRoute() {
  const navigate = useNavigate();
  const [impersonated, setImpersonated] = useState<ImpersonationTarget | null>(null);

  const bannerProps: ImpersonationBannerViewProps | null = impersonated
    ? {
        targetName: impersonated.full_name,
        empresa: impersonated.empresa,
        onExit: () => {
          setImpersonated(null);
          void navigate({ to: '/login' });
        },
      }
    : null;

  return (
    <div className="min-h-screen bg-neutral-50">
      {bannerProps ? <ImpersonationBannerView {...bannerProps} /> : null}
      <main className="mx-auto max-w-2xl px-4 py-8">
        <h1 className="mb-4 font-bold text-2xl text-neutral-900">Preview · Impersonación</h1>
        {impersonated ? (
          <p className="text-neutral-600 text-sm">
            Sesión impersonada activa (mock). El banner de arriba es el real; "Salir" vuelve al
            login.
          </p>
        ) : (
          <ImpersonationPickerView
            state="ready"
            targets={MOCK_TARGETS}
            impersonatingId={null}
            onImpersonate={(id) => {
              const target = MOCK_TARGETS.find((t) => t.id === id) ?? null;
              setImpersonated(target);
            }}
          />
        )}
      </main>
    </div>
  );
}
