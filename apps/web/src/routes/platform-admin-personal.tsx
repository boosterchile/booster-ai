import { ProtectedRoute } from '../components/ProtectedRoute.js';
import { PersonalBooster } from '../components/admin/PersonalBooster.js';
import { PlatformAdminFrame } from '../components/admin/PlatformAdminFrame.js';

/**
 * `/app/platform-admin/personal` — alta del personal de Booster con acceso al
 * panel (`.specs/alta-personal-booster/spec.md`). La lista de Terraform sigue
 * decidiendo quién entra; aquí se crea la cuenta y se entrega el código para
 * que la persona elija su clave en `/activar`.
 */
export function PlatformAdminPersonalRoute() {
  return (
    <ProtectedRoute meRequirement="skip">
      {() => (
        <PlatformAdminFrame volver={{ to: '/app/platform-admin', label: 'Volver' }}>
          <h1 className="font-bold text-3xl text-neutral-900 tracking-tight">
            Personal de Booster
          </h1>
          <p className="mt-2 max-w-2xl text-neutral-600 text-sm">
            Da de alta a otra persona de Booster con acceso a este panel. Tú cargas sus datos; ella
            elige su propia clave al activar.
          </p>
          <PersonalBooster />
        </PlatformAdminFrame>
      )}
    </ProtectedRoute>
  );
}
