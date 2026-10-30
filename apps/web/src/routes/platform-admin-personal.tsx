import { ProtectedRoute } from '../components/ProtectedRoute.js';
import { PersonalBooster } from '../components/admin/PersonalBooster.js';
import { PlatformAdminFrame } from '../components/admin/PlatformAdminFrame.js';

/**
 * Esqueleto de `/app/platform-admin/personal` para exhibir el rojo de los
 * tests por comportamiento. Lo reemplaza la implementación en el commit
 * siguiente.
 */
export function PlatformAdminPersonalRoute() {
  return (
    <ProtectedRoute meRequirement="skip">
      {() => (
        <PlatformAdminFrame volver={{ to: '/app/platform-admin', label: 'Volver' }}>
          <PersonalBooster />
        </PlatformAdminFrame>
      )}
    </ProtectedRoute>
  );
}
