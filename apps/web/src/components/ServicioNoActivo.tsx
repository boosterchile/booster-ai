import { Link } from '@tanstack/react-router';
import { PowerOff } from 'lucide-react';
import type { MeResponse } from '../hooks/use-me.js';
import { EmptyState, emptyStateActionClass } from './EmptyState.js';
import { Layout } from './Layout.js';

type MeOnboarded = Extract<MeResponse, { needs_onboarding: false }>;

/**
 * servicios-por-empresa: pantalla de un servicio que la empresa no tiene
 * activo (hoy, las ofertas de carga). El menú no lleva hasta acá; esto
 * responde a una URL directa.
 */
export function ServicioNoActivo({ me, titulo }: { me: MeOnboarded; titulo: string }) {
  return (
    <Layout me={me} title={titulo}>
      <div data-testid="servicio-no-activo" className="mx-auto w-full max-w-2xl">
        <EmptyState
          icon={<PowerOff className="h-8 w-8" aria-hidden />}
          title="Tu empresa no tiene activo el servicio de ofertas de carga"
          description="Tu flota, tus conductores y tus viajes propios siguen disponibles. Si quieres recibir ofertas de carga, escríbenos."
          action={
            <Link to="/app" className={emptyStateActionClass}>
              Volver al inicio
            </Link>
          }
        />
      </div>
    </Layout>
  );
}
