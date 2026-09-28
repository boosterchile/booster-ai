import { useState } from 'react';
import { ProtectedRoute } from '../components/ProtectedRoute.js';
import { ActivarEmpresa } from '../components/admin/ActivarEmpresa.js';
import { CrearEmpresa } from '../components/admin/CrearEmpresa.js';
import { InvitarMiembroEmpresa } from '../components/admin/InvitarMiembroEmpresa.js';
import { PlatformAdminFrame } from '../components/admin/PlatformAdminFrame.js';

export function PlatformAdminEmpresasRoute() {
  return (
    <ProtectedRoute meRequirement="skip">{() => <PlatformAdminEmpresasPage />}</ProtectedRoute>
  );
}

function PlatformAdminEmpresasPage() {
  const [empresasVersion, setEmpresasVersion] = useState(0);
  const [empresaCreadaId, setEmpresaCreadaId] = useState<string | undefined>(undefined);

  return (
    <PlatformAdminFrame volver={{ to: '/app/platform-admin', label: 'Volver' }}>
      <h1 className="font-bold text-3xl text-neutral-900 tracking-tight">Empresas</h1>
      <p className="mt-2 max-w-2xl text-neutral-600 text-sm">
        Creá la empresa, actívala para que pueda operar e invitá a quien la administra.
      </p>
      <CrearEmpresa
        onCreated={(empresaId) => {
          setEmpresaCreadaId(empresaId);
          setEmpresasVersion((v) => v + 1);
        }}
      />
      <ActivarEmpresa refreshToken={empresasVersion} />
      <InvitarMiembroEmpresa refreshToken={empresasVersion} preferEmpresaId={empresaCreadaId} />
    </PlatformAdminFrame>
  );
}
