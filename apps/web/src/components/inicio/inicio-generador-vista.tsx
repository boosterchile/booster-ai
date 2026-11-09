import { Clock } from 'lucide-react';
import type { NavItem } from '../nav-items.js';
import { AccesosGrid } from './accesos-grid.js';
import { AgendaList, AgendaTable } from './agenda.js';
import { AvisoChips, AvisosCard } from './avisos.js';
import { INICIO_GASTO_GENERADOR_ACTIVO } from './flags.js';
import type { GeneradorHoy } from './generador.js';
import { InicioShell } from './inicio-shell.js';
import { MapPreviewCard } from './map-preview-card.js';
import { MoneyPair } from './money-pair.js';
import { CtaVerde, ErrorBloque, EsqueletoBloque, NegocioBlock } from './negocio-block.js';
import { EmptyMoment } from './piezas.js';
import { PipelineCounts } from './pipeline-counts.js';

export function InicioGeneradorVista({
  saludo,
  linea,
  negocio,
  accesos,
  soloLectura,
  onReintentar,
}: {
  saludo: string;
  linea: string;
  negocio: GeneradorHoy;
  accesos: NavItem[];
  soloLectura: boolean;
  onReintentar: (fuente: string) => void;
}) {
  const cta = soloLectura ? 'Ver' : 'Publicar carga';
  const ctaTo = soloLectura ? '/app/cargas' : '/app/cargas/nueva';
  return (
    <InicioShell saludo={saludo} linea={linea} testId="inicio-generador">
      <div className="md:grid md:grid-cols-[minmax(0,1fr)_380px] md:items-start md:gap-5">
        <div className="min-w-0 space-y-4">
          <div className="hidden gap-3 md:grid md:grid-cols-3">
            <KpiBuscando negocio={negocio} cta={cta} ctaTo={ctaTo} onReintentar={onReintentar} />
            <KpiActivas negocio={negocio} />
            <KpiPlata negocio={negocio} onReintentar={onReintentar} />
          </div>
          <div className="space-y-4 md:hidden">
            <MisCargas negocio={negocio} cta={cta} ctaTo={ctaTo} onReintentar={onReintentar} />
            <GastoHuella negocio={negocio} onReintentar={onReintentar} />
          </div>
          <Retiros negocio={negocio} onReintentar={onReintentar} />
        </div>
        <div className="mt-4 hidden min-w-0 space-y-4 md:mt-0 md:block">
          <MapPreviewCard
            titulo="Tus cargas en camino"
            pins={negocio.mapa.pins}
            resumen={negocio.mapa.resumen}
          />
          <NegocioBlock titulo="Avisos" testId="inicio-avisos-generador">
            <AvisosCard avisos={negocio.avisos} />
          </NegocioBlock>
        </div>
      </div>
      <div className="mt-4">
        <AvisoChips avisos={negocio.avisos} />
      </div>
      <AccesosGrid items={accesos} />
    </InicioShell>
  );
}

function MisCargas({
  negocio,
  cta,
  ctaTo,
  onReintentar,
}: {
  negocio: GeneradorHoy;
  cta: string;
  ctaTo: string;
  onReintentar: (fuente: string) => void;
}) {
  return (
    <NegocioBlock
      titulo="Mis cargas"
      testId="inicio-mis-cargas"
      enlace={{ to: '/app/cargas', label: 'Ver todas' }}
    >
      <CuerpoCargas negocio={negocio} onReintentar={onReintentar} />
      <CtaVerde to={ctaTo}>{cta}</CtaVerde>
    </NegocioBlock>
  );
}

function CuerpoCargas({
  negocio,
  onReintentar,
}: {
  negocio: GeneradorHoy;
  onReintentar: (fuente: string) => void;
}) {
  const panel = negocio.cargas;
  if (panel.estado === 'cargando') {
    return <EsqueletoBloque testId="skeleton-cargas" />;
  }
  if (panel.estado === 'error') {
    return <ErrorBloque nombre="Cargas" fuente="viajes" onReintentar={onReintentar} />;
  }
  if (panel.estado === 'vacio') {
    return <EmptyMoment>Sin cargas publicadas</EmptyMoment>;
  }
  return (
    <>
      <PipelineCounts
        buscando={panel.valor.buscando}
        asignadas={panel.valor.asignadas}
        enCamino={panel.valor.enCamino}
      />
      {panel.valor.destacada ? (
        <div className="mt-3 flex items-start gap-2">
          <Clock className="mt-0.5 h-4 w-4 text-warning-700" aria-hidden="true" />
          <div>
            <p className="font-medium text-neutral-900 text-sm">{panel.valor.destacada.codigo}</p>
            <p className="text-neutral-600 text-xs">{panel.valor.destacada.detalle}</p>
          </div>
        </div>
      ) : null}
    </>
  );
}

function Retiros({
  negocio,
  onReintentar,
}: {
  negocio: GeneradorHoy;
  onReintentar: (fuente: string) => void;
}) {
  const panel = negocio.agenda;
  return (
    <NegocioBlock
      titulo="Próximos retiros y entregas"
      testId="inicio-agenda"
      enlace={{ to: '/app/cargas', label: 'Seguimiento' }}
    >
      {panel.estado === 'cargando' ? <EsqueletoBloque testId="skeleton-agenda" /> : null}
      {panel.estado === 'error' ? (
        <ErrorBloque nombre="Cargas" fuente="viajes-agenda" onReintentar={onReintentar} />
      ) : null}
      {panel.estado === 'vacio' ? <EmptyMoment>Sin retiros próximos</EmptyMoment> : null}
      {panel.estado === 'listo' ? (
        <>
          <AgendaList items={panel.valor} />
          <AgendaTable items={panel.valor} />
        </>
      ) : null}
    </NegocioBlock>
  );
}

function GastoHuella({
  negocio,
  onReintentar,
}: {
  negocio: GeneradorHoy;
  onReintentar: (fuente: string) => void;
}) {
  return (
    <NegocioBlock titulo="Gasto y huella" testId="inicio-gasto-huella">
      <PlataCuerpo negocio={negocio} onReintentar={onReintentar} />
    </NegocioBlock>
  );
}

function PlataCuerpo({
  negocio,
  onReintentar,
}: {
  negocio: GeneradorHoy;
  onReintentar: (fuente: string) => void;
}) {
  const huella = negocio.huella;
  if (huella.estado === 'cargando') {
    return <EsqueletoBloque testId="skeleton-huella" />;
  }
  if (huella.estado === 'error') {
    return <ErrorBloque nombre="Certificados" fuente="certificados" onReintentar={onReintentar} />;
  }
  const valorHuella = huella.estado === 'listo' ? huella.valor.texto : '—';
  const detalleHuella = huella.estado === 'listo' ? huella.valor.detalle : null;
  return (
    <MoneyPair
      regla={!INICIO_GASTO_GENERADOR_ACTIVO || !negocio.verMontos}
      izquierda={{
        label: 'Gasto octubre',
        valor: negocio.gastoActivo ? null : null,
        detalle: negocio.gastoActivo ? null : null,
      }}
      derecha={{ label: 'Huella octubre', valor: valorHuella, detalle: detalleHuella }}
    />
  );
}

function KpiBuscando({
  negocio,
  cta,
  ctaTo,
  onReintentar,
}: {
  negocio: GeneradorHoy;
  cta: string;
  ctaTo: string;
  onReintentar: (fuente: string) => void;
}) {
  const panel = negocio.cargas;
  return (
    <NegocioBlock titulo="Buscando transportista" testId="kpi-buscando">
      {panel.estado === 'cargando' ? <EsqueletoBloque testId="skeleton-kpi-buscando" /> : null}
      {panel.estado === 'error' ? (
        <ErrorBloque nombre="Cargas" fuente="viajes" onReintentar={onReintentar} />
      ) : null}
      {panel.estado === 'vacio' ? <EmptyMoment>Sin cargas publicadas</EmptyMoment> : null}
      {panel.estado === 'listo' ? (
        <>
          <p className="font-semibold text-3xl text-neutral-900 tabular-nums">
            {panel.valor.buscando}
          </p>
          {panel.valor.destacada ? (
            <p className="mt-1 text-neutral-600 text-xs">
              {panel.valor.destacada.codigo}. {panel.valor.destacada.detalle}
            </p>
          ) : (
            <p className="mt-1 text-neutral-600 text-xs">Nada esperando match</p>
          )}
        </>
      ) : null}
      <CtaVerde to={ctaTo}>{cta}</CtaVerde>
    </NegocioBlock>
  );
}

function KpiActivas({ negocio }: { negocio: GeneradorHoy }) {
  const panel = negocio.cargas;
  const activas = panel.estado === 'listo' ? panel.valor.asignadas + panel.valor.enCamino : null;
  return (
    <NegocioBlock titulo="Cargas activas" testId="kpi-activas">
      {panel.estado === 'cargando' ? <EsqueletoBloque testId="skeleton-kpi-activas" /> : null}
      {panel.estado === 'vacio' || panel.estado === 'error' ? <p className="text-3xl">—</p> : null}
      {panel.estado === 'listo' && activas != null ? (
        <>
          <p className="font-semibold text-3xl text-neutral-900 tabular-nums">{activas}</p>
          <p className="mt-1 text-neutral-600 text-xs">
            {panel.valor.asignadas} asignadas · {panel.valor.enCamino} en camino
          </p>
        </>
      ) : null}
    </NegocioBlock>
  );
}

function KpiPlata({
  negocio,
  onReintentar,
}: {
  negocio: GeneradorHoy;
  onReintentar: (fuente: string) => void;
}) {
  return (
    <NegocioBlock titulo="Gasto y huella" testId="kpi-plata">
      <PlataCuerpo negocio={negocio} onReintentar={onReintentar} />
    </NegocioBlock>
  );
}
