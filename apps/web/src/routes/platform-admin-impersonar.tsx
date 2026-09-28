import { RegisterProvider } from '@booster-ai/ui-components';
import { ImpersonationPicker } from '../components/ImpersonationPicker.js';
import { ProtectedRoute } from '../components/ProtectedRoute.js';
import { PlatformAdminFrame } from '../components/admin/PlatformAdminFrame.js';

export function PlatformAdminImpersonarRoute() {
  return (
    <ProtectedRoute meRequirement="skip">
      {() => (
        <PlatformAdminFrame volver={{ to: '/app/platform-admin', label: 'Volver' }}>
          <h1 className="font-bold text-3xl text-neutral-900 tracking-tight">
            Entrar como un usuario
          </h1>
          <p className="mt-2 max-w-2xl text-neutral-600 text-sm">
            La impersonación queda auditada. Sirve para ver la plataforma con la sesión de un
            cliente.
          </p>
          <RegisterProvider register="operador" density="comoda" className="mt-6 block">
            <ImpersonationPicker />
          </RegisterProvider>
        </PlatformAdminFrame>
      )}
    </ProtectedRoute>
  );
}
