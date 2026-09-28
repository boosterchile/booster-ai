import { ProtectedRoute } from '../components/ProtectedRoute.js';
import { AsociarTeltonika } from '../components/admin/AsociarTeltonika.js';
import { PlatformAdminFrame } from '../components/admin/PlatformAdminFrame.js';

export function PlatformAdminTeltonikaRoute() {
  return (
    <ProtectedRoute meRequirement="skip">
      {() => (
        <PlatformAdminFrame volver={{ to: '/app/platform-admin', label: 'Volver' }}>
          <h1 className="font-bold text-3xl text-neutral-900 tracking-tight">Teltonika</h1>
          <p className="mt-2 mb-2 max-w-2xl text-neutral-600 text-sm">
            Booster carga los datos del vehículo para la empresa, o solo escribe el IMEI si la
            empresa ya los cargó en su flota.
          </p>
          <AsociarTeltonika />
        </PlatformAdminFrame>
      )}
    </ProtectedRoute>
  );
}
