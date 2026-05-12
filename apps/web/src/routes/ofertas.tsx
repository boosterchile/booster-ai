import { Link } from '@tanstack/react-router';
import { Headphones, Inbox, RefreshCw } from 'lucide-react';
import { EmptyState } from '../components/EmptyState.js';
import { Layout } from '../components/Layout.js';
import { ProtectedRoute } from '../components/ProtectedRoute.js';
import { OfferCard } from '../components/offers/OfferCard.js';
import { VoiceAcceptOfferControl } from '../components/offers/VoiceAcceptOfferControl.js';
import type { MeResponse } from '../hooks/use-me.js';
import { useOffersMine } from '../hooks/use-offers.js';

type MeOnboarded = Extract<MeResponse, { needs_onboarding: false }>;

/**
 * /app/ofertas — pantalla principal carrier.
 *
 * Lista offers pending del carrier activo con polling 30s. Si la empresa
 * activa no es carrier, redirige al dashboard general (no debería pasar
 * porque el menu condiciona la entrada).
 */
export function OfertasRoute() {
  return (
    <ProtectedRoute meRequirement="require-onboarded">
      {(ctx) => {
        if (ctx.kind !== 'onboarded') {
          return null;
        }
        return <OfertasPage me={ctx.me} />;
      }}
    </ProtectedRoute>
  );
}

function OfertasPage({ me }: { me: MeOnboarded }) {
  const activeEmpresa = me.active_membership?.empresa;
  const isCarrier = activeEmpresa?.is_transportista ?? false;

  const offersQuery = useOffersMine({ enabled: isCarrier });

  return (
    <Layout me={me} title="Ofertas activas">
      {/* Header de página: en mobile stack vertical (título arriba,
          descripción debajo, botones full-width). En sm+ vuelve al
          layout horizontal compacto. Antes era flex row fijo y
          comprimía el título a 2 líneas cortadas. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="font-bold text-2xl text-neutral-900 tracking-tight sm:text-3xl">
            Ofertas activas
          </h1>
          <p className="mt-1 text-neutral-600 text-sm">
            Cargas disponibles para tu empresa. Las ofertas expiran en 1 hora.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
          <Link
            to="/app/conductor/modo"
            className="inline-flex items-center gap-2 rounded-md border border-neutral-300 bg-white px-3 py-2 font-medium text-neutral-700 text-sm shadow-xs transition hover:bg-neutral-100"
            data-testid="link-modo-conductor"
          >
            <Headphones className="h-4 w-4" aria-hidden />
            Modo Conductor
          </Link>
          <button
            type="button"
            onClick={() => offersQuery.refetch()}
            disabled={offersQuery.isFetching}
            className="inline-flex items-center gap-2 rounded-md border border-neutral-300 bg-white px-3 py-2 font-medium text-neutral-700 text-sm shadow-xs transition hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCw
              className={`h-4 w-4 ${offersQuery.isFetching ? 'animate-spin' : ''}`}
              aria-hidden
            />
            {offersQuery.isFetching ? 'Actualizando…' : 'Actualizar'}
          </button>
        </div>
      </div>

      {!isCarrier && (
        <output className="mt-6 block rounded-md border border-warning-500/30 bg-warning-50 p-4 text-sm text-warning-700">
          Tu empresa <strong>{activeEmpresa?.legal_name}</strong> no opera como carrier. Esta vista
          es solo para empresas transportistas. Si quieres activar este modo, contacta a{' '}
          <a
            href="mailto:soporte@boosterchile.com"
            className="font-medium text-warning-700 underline"
          >
            soporte@boosterchile.com
          </a>
          .
        </output>
      )}

      {isCarrier && offersQuery.isLoading && (
        <div className="mt-10 text-center text-neutral-500 text-sm">Cargando ofertas…</div>
      )}

      {isCarrier && offersQuery.isError && (
        <output className="mt-6 block rounded-md border border-danger-500/30 bg-danger-50 p-4 text-danger-700 text-sm">
          No pudimos cargar las ofertas. Probá actualizar.
        </output>
      )}

      {isCarrier && offersQuery.data && offersQuery.data.offers.length === 0 && (
        <div className="mt-10">
          <EmptyState
            icon={<Inbox className="h-10 w-10" aria-hidden />}
            title="No hay ofertas activas ahora"
            description="Cuando un generador de carga publique una compatible con tus zonas y vehículos, la verás aquí. Mantenemos esta vista actualizada cada 30 segundos."
          />
        </div>
      )}

      {isCarrier && offersQuery.data && offersQuery.data.offers.length > 0 && (
        <div className="mt-6 space-y-4">
          {/* Phase 4 PR-K7 — control de aceptación por voz. Solo se
                  renderiza cuando hay EXACTAMENTE 1 oferta pendiente —
                  para >1 sería ambiguo qué oferta el comando "aceptar"
                  refiere. Doble confirmación protege contra falsos
                  positivos (aceptar oferta es contrato). */}
          {offersQuery.data.offers.length === 1 && offersQuery.data.offers[0] && (
            <VoiceAcceptOfferControl
              offerId={offersQuery.data.offers[0].id}
              trackingCode={offersQuery.data.offers[0].trip_request.tracking_code}
            />
          )}
          {offersQuery.data.offers.map((o) => (
            <OfferCard key={o.id} offer={o} />
          ))}
        </div>
      )}
    </Layout>
  );
}
