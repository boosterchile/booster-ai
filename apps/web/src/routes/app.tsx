import { Link, Navigate } from '@tanstack/react-router';
import { ArrowRight } from 'lucide-react';
import { Layout } from '../components/Layout.js';
import { ProtectedRoute } from '../components/ProtectedRoute.js';
import { InicioTransportista } from '../components/inicio-transportista/inicio-transportista.js';
import { InicioGenerador } from '../components/inicio/inicio-generador.js';
import { InicioMixta } from '../components/inicio/inicio-mixta.js';
import type { MeResponse } from '../hooks/use-me.js';

type MeOnboarded = Extract<MeResponse, { needs_onboarding: false }>;

/**
 * /app — inicio post-login, role-aware.
 * Transportista, generador y mixta tienen su Inicio. Sin empresa y sin
 * operación conservan el alta.
 */
export function AppRoute() {
  return (
    <ProtectedRoute meRequirement="require-onboarded">
      {(ctx) => {
        if (ctx.kind !== 'onboarded') {
          return null;
        }
        return <AppDashboard me={ctx.me} />;
      }}
    </ProtectedRoute>
  );
}

function AppDashboard({ me }: { me: MeOnboarded }) {
  const activeEmpresa = me.active_membership?.empresa;
  const myRole = me.active_membership?.role;
  const isAdmin = myRole === 'dueno' || myRole === 'admin';

  // Surface guards (platform-admin / conductor / stakeholder tienen shell propio).
  if (me.user.is_platform_admin) {
    return <Navigate to="/app/platform-admin" />;
  }
  if (myRole === 'conductor') {
    return <Navigate to="/app/conductor" />;
  }
  if (myRole === 'stakeholder_sostenibilidad') {
    return <Navigate to="/app/stakeholder/zonas" />;
  }

  const esTransportista = Boolean(activeEmpresa?.is_transportista);
  const esGenerador = Boolean(activeEmpresa?.is_generador_carga);
  const soloLectura = myRole === 'visualizador';
  const mixta = esTransportista && esGenerador;
  const generadorPuro = esGenerador && !esTransportista;

  return (
    <Layout me={me} title="Inicio">
      {!esTransportista && !generadorPuro && (
        <h1 className="font-bold text-2xl text-neutral-900 tracking-tight sm:text-3xl">
          Bienvenido a Booster
        </h1>
      )}

      {activeEmpresa && !esTransportista && !generadorPuro ? (
        <p className="mt-2 text-neutral-600 text-sm sm:text-base">
          Empresa activa: <span className="font-medium">{activeEmpresa.legal_name}</span>
          {activeEmpresa.is_generador_carga && ' · Generador de carga'}
        </p>
      ) : null}
      {!activeEmpresa && (
        <p className="mt-2 text-neutral-600 text-sm sm:text-base">Sin empresa activa.</p>
      )}

      {mixta && activeEmpresa ? <InicioMixta me={me} soloLectura={soloLectura} /> : null}

      {esTransportista && activeEmpresa && !mixta ? (
        <InicioTransportista
          nombreCompleto={me.user.full_name}
          legalName={activeEmpresa.legal_name}
          esAdmin={isAdmin}
          soloLectura={soloLectura}
        />
      ) : null}

      {generadorPuro && activeEmpresa ? (
        <InicioGenerador me={me} soloLectura={soloLectura} />
      ) : null}

      {!activeEmpresa && (
        <section className="mt-10 rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
          <h2 className="font-semibold text-neutral-900 text-xl">Aún no tienes empresa</h2>
          <p className="mt-2 text-neutral-700 text-sm">
            Para usar Booster necesitas crear una empresa o unirte a una existente. Si recién te
            registraste, hace falta completar el onboarding (RUT, datos legales, plan).
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              to="/onboarding"
              className="inline-flex items-center gap-2 rounded-md bg-primary-600 px-4 py-2 font-medium text-sm text-white hover:bg-primary-700"
            >
              Crear empresa
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
            <Link
              to="/app/platform-admin"
              className="inline-flex items-center gap-2 rounded-md border border-neutral-300 px-4 py-2 font-medium text-neutral-700 text-sm hover:bg-neutral-100"
              data-testid="empty-state-link-platform-admin"
            >
              Soy admin de plataforma
            </Link>
          </div>
        </section>
      )}

      {activeEmpresa && !activeEmpresa.is_transportista && !activeEmpresa.is_generador_carga && (
        <section className="mt-10 rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
          <h2 className="font-semibold text-neutral-900 text-xl">Tu empresa todavía no opera</h2>
          <p className="mt-2 text-neutral-700 text-sm">
            Configura si vas a operar como generador de carga, transportista o ambos desde el perfil
            de empresa.
          </p>
        </section>
      )}
    </Layout>
  );
}
