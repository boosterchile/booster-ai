import { ProtectedRoute } from '../components/ProtectedRoute.js';
import { FlotaPlataforma } from '../components/admin/FlotaPlataforma.js';
import { PlatformAdminFrame } from '../components/admin/PlatformAdminFrame.js';

/** `.specs/flota-plataforma`: la flota de todas las empresas, solo lectura. */
export function PlatformAdminFlotaRoute() {
  return (
    <ProtectedRoute meRequirement="skip">
      {() => (
        <PlatformAdminFrame volver={{ to: '/app/platform-admin', label: 'Volver' }}>
          <h1 className="font-bold text-3xl text-neutral-900 tracking-tight">Flota</h1>
          <p className="mt-2 max-w-2xl text-neutral-600 text-sm">
            Los vehículos de todas las empresas, con su última posición. Selecciona uno para ver su
            equipo, lo que lee por CAN y los certificados de sus viajes.
          </p>
          <FlotaPlataforma />
        </PlatformAdminFrame>
      )}
    </ProtectedRoute>
  );
}
