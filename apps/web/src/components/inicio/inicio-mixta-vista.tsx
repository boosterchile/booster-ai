import { cn } from '@booster-ai/ui-components';
import { useState } from 'react';
import type { NegocioHoy } from '../inicio-transportista/negocio.js';
import type { NavItem } from '../nav-items.js';
import { AccesosGrid } from './accesos-grid.js';
import { AgendaList, AgendaTable } from './agenda.js';
import { AvisoChips, AvisosCard } from './avisos.js';
import type { GeneradorHoy } from './generador.js';
import { InicioShell } from './inicio-shell.js';
import { type FiltroMixta, buildMixtaHoy } from './mixta.js';
import { MoneyPair } from './money-pair.js';
import { ErrorBloque, EsqueletoBloque, NegocioBlock } from './negocio-block.js';
import { EmptyMoment } from './piezas.js';
import { PipelineCounts } from './pipeline-counts.js';

const FILTROS: Array<{ id: FiltroMixta; label: string }> = [
  { id: 'todo', label: 'Todo' },
  { id: 'transporte', label: 'Transporte' },
  { id: 'generador', label: 'Generador' },
];

export function InicioMixtaVista({
  saludo,
  linea,
  negocio,
  generador,
  ahora,
  accesosTransporte,
  accesosGenerador,
  soloLectura,
  onReintentar,
}: {
  saludo: string;
  linea: string;
  negocio: NegocioHoy;
  generador: GeneradorHoy;
  ahora: Date;
  accesosTransporte: NavItem[];
  accesosGenerador: NavItem[];
  soloLectura: boolean;
  onReintentar: (fuente: string) => void;
}) {
  const [filtro, setFiltro] = useState<FiltroMixta>('todo');
  const modelo = buildMixtaHoy(negocio, generador, filtro, ahora, { soloLectura });
  const accesos =
    filtro === 'transporte'
      ? accesosTransporte
      : filtro === 'generador'
        ? accesosGenerador
        : [...accesosTransporte, ...accesosGenerador];
  return (
    <InicioShell
      saludo={saludo}
      linea={linea}
      testId="inicio-mixta"
      encabezado={<FiltroRol value={filtro} onChange={setFiltro} />}
    >
      <div className="space-y-4">
        {modelo.ofertas ? (
          <OfertasFlota panel={modelo.ofertas} onReintentar={onReintentar} />
        ) : null}
        {modelo.cargas ? (
          <MisCargasPublicadas panel={modelo.cargas} onReintentar={onReintentar} />
        ) : null}
        <Agenda modelo={modelo} onReintentar={onReintentar} />
        <NegocioBlock titulo={modelo.plataTitulo} testId="inicio-plata-mixta">
          <MoneyPair izquierda={modelo.facturado} derecha={modelo.gasto} regla />
        </NegocioBlock>
        <div className="hidden md:block">
          <NegocioBlock titulo="Avisos" testId="inicio-avisos-mixta">
            <AvisosCard avisos={modelo.avisos} />
          </NegocioBlock>
        </div>
        <AvisoChips avisos={modelo.avisos} />
      </div>
      <AccesosGrid items={accesos} />
    </InicioShell>
  );
}

function FiltroRol({
  value,
  onChange,
}: {
  value: FiltroMixta;
  onChange: (filtro: FiltroMixta) => void;
}) {
  return (
    <fieldset data-testid="inicio-filtro-mixta" className="mt-4 flex gap-2 border-0 p-0">
      <legend className="sr-only">Ver por rol</legend>
      {FILTROS.map((filtro) => {
        const activo = value === filtro.id;
        return (
          <button
            key={filtro.id}
            type="button"
            aria-pressed={activo}
            onClick={() => onChange(filtro.id)}
            className={cn(
              'rounded-full px-3 py-1 font-semibold text-sm',
              activo ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-neutral-700',
            )}
          >
            {filtro.label}
          </button>
        );
      })}
    </fieldset>
  );
}

function OfertasFlota({
  panel,
  onReintentar,
}: {
  panel: NonNullable<ReturnType<typeof buildMixtaHoy>['ofertas']>;
  onReintentar: (fuente: string) => void;
}) {
  return (
    <NegocioBlock
      titulo="Ofertas para tu flota"
      testId="inicio-ofertas-flota"
      {...(panel.estado === 'listo' || panel.estado === 'vacio'
        ? { enlace: { to: '/app/ofertas', label: 'Ver' } }
        : {})}
    >
      {panel.estado === 'cargando' ? <EsqueletoBloque testId="skeleton-ofertas-flota" /> : null}
      {panel.estado === 'error' ? (
        <ErrorBloque nombre="Ofertas" fuente="ofertas" onReintentar={onReintentar} />
      ) : null}
      {panel.estado === 'vacio' ? <EmptyMoment>Sin ofertas nuevas</EmptyMoment> : null}
      {panel.estado === 'listo' ? (
        <>
          <p className="font-semibold text-neutral-900">
            {panel.valor.cantidad === 1
              ? '1 oferta nueva'
              : `${panel.valor.cantidad} ofertas nuevas`}
            {panel.valor.precio ? <span> · {panel.valor.precio}</span> : null}
          </p>
          <p className="mt-0.5 text-neutral-600 text-sm">
            {panel.valor.ruta}
            {panel.valor.vence ? (
              <span className="font-semibold text-warning-700"> · {panel.valor.vence}</span>
            ) : null}
          </p>
        </>
      ) : null}
    </NegocioBlock>
  );
}

function MisCargasPublicadas({
  panel,
  onReintentar,
}: {
  panel: NonNullable<GeneradorHoy['cargas']>;
  onReintentar: (fuente: string) => void;
}) {
  return (
    <NegocioBlock
      titulo="Mis cargas publicadas"
      testId="inicio-mis-cargas-publicadas"
      enlace={{ to: '/app/cargas', label: 'Ver' }}
    >
      {panel.estado === 'cargando' ? <EsqueletoBloque testId="skeleton-cargas-publicadas" /> : null}
      {panel.estado === 'error' ? (
        <ErrorBloque nombre="Cargas" fuente="viajes" onReintentar={onReintentar} />
      ) : null}
      {panel.estado === 'vacio' ? <EmptyMoment>Sin cargas publicadas</EmptyMoment> : null}
      {panel.estado === 'listo' ? (
        <PipelineCounts
          buscando={panel.valor.buscando}
          asignadas={panel.valor.asignadas}
          enCamino={panel.valor.enCamino}
        />
      ) : null}
    </NegocioBlock>
  );
}

function Agenda({
  modelo,
  onReintentar,
}: {
  modelo: ReturnType<typeof buildMixtaHoy>;
  onReintentar: (fuente: string) => void;
}) {
  const panel = modelo.agenda;
  return (
    <NegocioBlock titulo="Agenda de hoy y mañana" testId="inicio-agenda-mixta">
      {panel.estado === 'cargando' ? <EsqueletoBloque testId="skeleton-agenda-mixta" /> : null}
      {modelo.falloTransporte ? (
        <ErrorBloque nombre="Servicios" fuente="servicios" onReintentar={onReintentar} />
      ) : null}
      {modelo.falloGenerador ? (
        <ErrorBloque nombre="Cargas" fuente="viajes" onReintentar={onReintentar} />
      ) : null}
      {panel.estado === 'vacio' ? <EmptyMoment>Sin movimientos en la agenda</EmptyMoment> : null}
      {panel.estado === 'listo' ? (
        <>
          <AgendaList items={panel.valor} />
          <AgendaTable items={panel.valor} />
        </>
      ) : null}
    </NegocioBlock>
  );
}
