import type { PanelBoosterFleet } from '@booster-ai/shared-schemas';
import { Button, Modal } from '@booster-ai/ui-components';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Layout } from '../components/Layout.js';
import { ProtectedRoute } from '../components/ProtectedRoute.js';
import { CombustibleFlota } from '../components/booster-fleet/combustible-flota.js';
import { DocumentosFlota } from '../components/booster-fleet/documentos-flota.js';
import {
  FormularioMantencion,
  mensajeDe,
} from '../components/booster-fleet/formulario-mantencion.js';
import { MantencionesFlota } from '../components/booster-fleet/mantenciones-flota.js';
import { formatoFecha, hallazgosDocumentales } from '../components/booster-fleet/reglas.js';
import { ResumenFlota } from '../components/booster-fleet/resumen-flota.js';
import {
  type MeOnboarded,
  puedeVerBoosterFleet,
  usePanelBoosterFleet,
} from '../components/booster-fleet/use-panel.js';

export function BoosterFleetRoute() {
  return (
    <ProtectedRoute meRequirement="require-onboarded">
      {(ctx) => {
        if (ctx.kind !== 'onboarded') {
          return null;
        }
        return <BoosterFleetPage me={ctx.me} />;
      }}
    </ProtectedRoute>
  );
}

function BoosterFleetPage({ me }: { me: MeOnboarded }) {
  if (!puedeVerBoosterFleet(me)) {
    return (
      <Layout me={me} title="Booster Fleet">
        <h1 className="font-bold text-3xl text-neutral-900 tracking-tight">Booster Fleet</h1>
        <p className="mt-3 max-w-xl text-neutral-700">
          Booster Fleet es el control de flota del dueño de la empresa de transportes.
        </p>
      </Layout>
    );
  }
  return (
    <Layout me={me} title="Booster Fleet">
      <Panel />
    </Layout>
  );
}

/**
 * Booster Fleet para el dueño del transportista (`.specs/booster-fleet-rediseno`).
 * Panel de triage: la primera oración dice cuántos camiones piden revisión
 * y por cuál partir; combustible manda y cada hallazgo trae su acción.
 */
function Panel() {
  const { consulta: q, invalidar } = usePanelBoosterFleet();

  if (q.data) {
    return <Controles panel={q.data} onCambio={invalidar} />;
  }
  return (
    <div>
      <h1 className="font-semibold text-neutral-900 text-xl tracking-tight">Booster Fleet</h1>
      {q.isLoading && <p className="mt-6 text-neutral-500">Cargando Booster Fleet…</p>}
      {q.error && (
        <p role="alert" className="mt-6 text-danger-700">
          {mensajeDe(q.error)}
        </p>
      )}
    </div>
  );
}

function Controles({
  panel,
  onCambio,
}: {
  panel: PanelBoosterFleet;
  onCambio: () => Promise<void>;
}) {
  const [programando, setProgramando] = useState(false);
  const hallazgos = hallazgosDocumentales(panel.documental);
  const desde = formatoFecha(panel.combustible.desde);
  const hasta = formatoFecha(panel.combustible.hasta);
  const vehiculos = panel.combustible.vehiculos;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="font-semibold text-neutral-900 text-xl tracking-tight">Booster Fleet</h1>
          <p className="text-neutral-600 text-sm">
            Últimos {panel.configuracion.ventana_combustible_dias} días
            {desde && hasta ? ` · ${desde} al ${hasta}` : ''}
          </p>
        </div>
        <Button onClick={() => setProgramando(true)} disabled={vehiculos.length === 0}>
          <Plus className="h-4 w-4" aria-hidden /> Programar mantención
        </Button>
      </div>

      <ResumenFlota panel={panel} documentosPendientes={hallazgos.length} />

      {panel.combustible.truncado ? (
        <p className="mt-3 rounded-md border border-urgency-100 bg-warning-50 px-3 py-2 text-sm text-warning-700">
          La ventana de telemetría vino cortada. Las cifras de combustible pueden estar incompletas.
        </p>
      ) : null}

      <div className="mt-6 grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_23rem]">
        <CombustibleFlota combustible={panel.combustible} />
        <div className="space-y-6">
          <DocumentosFlota documental={panel.documental} hallazgos={hallazgos} />
          <MantencionesFlota
            mantenciones={panel.mantenciones}
            vehiculos={vehiculos}
            onCambio={onCambio}
          />
        </div>
      </div>

      <Modal isOpen={programando} onOpenChange={setProgramando} title="Programar mantención">
        {({ close }) => (
          <FormularioMantencion
            vehiculos={vehiculos}
            onProgramada={async () => {
              close();
              await onCambio();
            }}
          />
        )}
      </Modal>
    </div>
  );
}
