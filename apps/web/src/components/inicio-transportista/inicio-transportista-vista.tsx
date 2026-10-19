import { Card, cn } from '@booster-ai/ui-components';
import { Link } from '@tanstack/react-router';
import {
  Banknote,
  Bus,
  Check,
  ChevronRight,
  ClipboardList,
  Fuel,
  type LucideIcon,
  MapPin,
  Radio,
  Receipt,
  ShieldAlert,
  Truck,
  Users,
} from 'lucide-react';
import { AvisosCard, AvisosChips } from './avisos-chips.js';
import { BloqueNegocio, CtaVerde, ErrorBloque, EsqueletoBloque } from './bloque-negocio.js';
import { ListaProximos } from './lista-proximos.js';
import { MiniMapaFlota } from './mini-mapa-flota.js';
import type { AccesoVista, FuenteReintento, InicioVista, PasoAlta } from './modelo.js';
import { type AvisoNegocio, INICIO_PLATA_ACTIVA, type NegocioHoy } from './negocio.js';

const ICONO_ACCESO: Record<string, LucideIcon> = {
  flota: MapPin,
  ofertas: Truck,
  servicios: ClipboardList,
  vehiculos: Bus,
  conductores: Users,
  cumplimiento: ShieldAlert,
  'cobra-hoy': Banknote,
  liquidaciones: Receipt,
  trayectos: Fuel,
  dispositivos: Radio,
};

export function InicioTransportistaVista({
  vista,
  negocio,
  onReintentar,
  plataActiva = INICIO_PLATA_ACTIVA,
  soloLectura = false,
}: {
  vista: InicioVista;
  negocio: NegocioHoy;
  onReintentar: (fuente: FuenteReintento) => void;
  plataActiva?: boolean;
  soloLectura?: boolean;
}) {
  const avisos = avisosListos(negocio);
  return (
    <div data-testid="inicio-transportista" className="min-w-0">
      <Saludo vista={vista} />
      {vista.modo === 'empresa-nueva' && vista.pasos ? (
        <div className="mt-6">
          <Alta pasos={vista.pasos} />
        </div>
      ) : null}
      <div className="mt-6 md:grid md:grid-cols-[minmax(0,1fr)_380px] md:items-start md:gap-5">
        <div className="min-w-0 space-y-4">
          <h2 className="font-semibold text-neutral-500 text-xs uppercase tracking-wider">
            Tu negocio hoy
          </h2>
          <Ofertas negocio={negocio} onReintentar={onReintentar} soloLectura={soloLectura} />
          <Retiros negocio={negocio} onReintentar={onReintentar} soloLectura={soloLectura} />
          {plataActiva ? <Plata /> : null}
          <AvisosChips avisos={avisos} />
          <AvisosDocumentos negocio={negocio} onReintentar={onReintentar} />
        </div>
        <div className="mt-4 min-w-0 space-y-4 md:mt-0">
          <Mapa negocio={negocio} />
          <AvisosEscritorio negocio={negocio} avisos={avisos} />
        </div>
      </div>
      {negocio.auxiliares.map((error) => (
        <div key={error.fuente} className="mt-4">
          <ErrorBloque nombre={error.nombre} fuente={error.fuente} onReintentar={onReintentar} />
        </div>
      ))}
      <Accesos accesos={vista.accesos} />
    </div>
  );
}

function avisosListos(negocio: NegocioHoy): AvisoNegocio[] {
  const avisos: AvisoNegocio[] = [];
  if (negocio.senal.estado === 'listo') {
    avisos.push(negocio.senal.valor);
  }
  if (negocio.documentos.estado === 'listo') {
    avisos.push(negocio.documentos.valor);
  }
  return avisos;
}

function Ofertas({
  negocio,
  onReintentar,
  soloLectura,
}: {
  negocio: NegocioHoy;
  onReintentar: (fuente: FuenteReintento) => void;
  soloLectura: boolean;
}) {
  const panel = negocio.ofertas;
  return (
    <BloqueNegocio
      titulo="Ofertas"
      testId="inicio-ofertas"
      {...(panel.estado === 'listo'
        ? { enlace: { to: '/app/ofertas' as const, label: 'Ver todas' } }
        : {})}
    >
      {panel.estado === 'cargando' ? <EsqueletoBloque testId="skeleton-ofertas" /> : null}
      {panel.estado === 'error' ? (
        <ErrorBloque nombre="Ofertas" fuente="ofertas" onReintentar={onReintentar} />
      ) : null}
      {panel.estado === 'vacio' ? (
        <p className="font-medium text-neutral-900 text-sm">Sin ofertas nuevas</p>
      ) : null}
      {panel.estado === 'listo' ? (
        <>
          <p className="font-semibold text-neutral-900">
            {panel.valor.cantidad === 1
              ? '1 oferta nueva'
              : `${panel.valor.cantidad} ofertas nuevas`}
            {panel.valor.precio ? (
              <span className="font-semibold text-neutral-900"> · {panel.valor.precio}</span>
            ) : null}
          </p>
          <p className="mt-0.5 text-neutral-600 text-sm">
            {panel.valor.ruta}
            {panel.valor.vence ? (
              <span className="font-semibold text-warning-700"> · {panel.valor.vence}</span>
            ) : null}
          </p>
          <CtaVerde to="/app/ofertas">{soloLectura ? 'Ver' : 'Ver ofertas'}</CtaVerde>
        </>
      ) : null}
    </BloqueNegocio>
  );
}

function Retiros({
  negocio,
  onReintentar,
  soloLectura,
}: {
  negocio: NegocioHoy;
  onReintentar: (fuente: FuenteReintento) => void;
  soloLectura: boolean;
}) {
  const panel = negocio.retiros;
  return (
    <BloqueNegocio
      titulo="Próximos retiros"
      testId="inicio-retiros"
      enlace={{ to: '/app/servicios', label: 'Servicios' }}
    >
      {panel.estado === 'cargando' ? <EsqueletoBloque testId="skeleton-retiros" /> : null}
      {panel.estado === 'error' ? (
        <ErrorBloque nombre="Servicios" fuente="servicios" onReintentar={onReintentar} />
      ) : null}
      {panel.estado === 'vacio' ? (
        <p className="font-medium text-neutral-900 text-sm">Sin retiros próximos</p>
      ) : null}
      {panel.estado === 'listo' ? (
        <ListaProximos retiros={panel.valor} soloLectura={soloLectura} />
      ) : null}
    </BloqueNegocio>
  );
}

function Plata() {
  return (
    <BloqueNegocio titulo="Plata" testId="inicio-plata">
      <p className="text-neutral-600 text-sm">
        La regla de este bloque está pendiente. No hay montos hasta que se cierre.
      </p>
    </BloqueNegocio>
  );
}

function AvisosEscritorio({
  negocio,
  avisos,
}: {
  negocio: NegocioHoy;
  avisos: AvisoNegocio[];
}) {
  const cargando = negocio.senal.estado === 'cargando' || negocio.documentos.estado === 'cargando';
  return (
    <div className="hidden md:block">
      <BloqueNegocio titulo="Avisos" testId="inicio-avisos">
        {cargando ? <EsqueletoBloque testId="skeleton-avisos-desktop" /> : null}
        {!cargando && avisos.length > 0 ? <AvisosCard avisos={avisos} /> : null}
        {!cargando && avisos.length === 0 ? (
          <p className="text-neutral-600 text-sm">Sin avisos para mostrar.</p>
        ) : null}
      </BloqueNegocio>
    </div>
  );
}

function AvisosDocumentos({
  negocio,
  onReintentar,
}: {
  negocio: NegocioHoy;
  onReintentar: (fuente: FuenteReintento) => void;
}) {
  return (
    <>
      {negocio.senal.estado === 'cargando' || negocio.documentos.estado === 'cargando' ? (
        <EsqueletoBloque testId="skeleton-avisos" />
      ) : null}
      {negocio.senal.estado === 'error' ? (
        <ErrorBloque nombre="Flota" fuente="flota" onReintentar={onReintentar} />
      ) : null}
      {negocio.documentos.estado === 'error' ? (
        <ErrorBloque nombre="Cumplimiento" fuente="cumplimiento" onReintentar={onReintentar} />
      ) : null}
    </>
  );
}

function Mapa({ negocio }: { negocio: NegocioHoy }) {
  if (negocio.mapa.estado === 'cargando') {
    return (
      <div className="hidden md:block">
        <EsqueletoBloque testId="skeleton-mapa" />
      </div>
    );
  }
  if (negocio.mapa.estado !== 'listo') {
    return null;
  }
  return <MiniMapaFlota mapa={negocio.mapa.valor} />;
}

function Saludo({ vista }: { vista: InicioVista }) {
  return (
    <header>
      <h1 className="font-bold text-2xl text-neutral-900 tracking-tight">
        {vista.saludo}
        {vista.modo === 'empresa-nueva' ? <span aria-hidden="true"> 👋</span> : null}
      </h1>
      <p className="mt-1 text-neutral-600 text-sm">
        {vista.fecha ? <span>{vista.fecha} · </span> : null}
        <span>{vista.empresa}</span>
        <span> · Transportista</span>
      </p>
    </header>
  );
}

function Alta({ pasos }: { pasos: PasoAlta[] }) {
  const hechos = pasos.filter((paso) => paso.hecho).length;
  const avance = (hechos / pasos.length) * 100;
  return (
    <div data-testid="inicio-empresa-nueva">
      <Card className="border-primary-100 bg-primary-50">
        <div className="p-4 sm:p-5">
          <h2 className="font-semibold text-lg text-neutral-900">
            Dejemos tu empresa lista para recibir cargas
          </h2>
          <p className="mt-1 text-neutral-700 text-sm">
            Cuatro pasos y empiezan a llegarte ofertas.
          </p>
          <div className="mt-4 flex items-center gap-3">
            <div
              className="h-2 flex-1 overflow-hidden rounded-full bg-neutral-200"
              aria-hidden="true"
            >
              <div className="h-full bg-primary-600" style={{ width: `${avance}%` }} />
            </div>
            <p className="shrink-0 text-neutral-600 text-sm">
              {hechos} de {pasos.length}
            </p>
          </div>
        </div>
      </Card>
      <Card className="mt-3">
        <ul className="divide-y divide-neutral-200">
          {pasos.map((paso) => (
            <li key={paso.id}>
              <Paso paso={paso} />
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function Paso({ paso }: { paso: PasoAlta }) {
  const cuerpo = (
    <>
      {paso.hecho ? (
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-success-600 text-white">
          <Check className="h-4 w-4" aria-hidden="true" />
        </span>
      ) : (
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-neutral-100 font-semibold text-neutral-600 text-sm">
          {paso.numero}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            'block font-medium',
            paso.hecho ? 'text-neutral-500 line-through' : 'text-neutral-900',
          )}
        >
          {paso.titulo}
        </span>
        <span className="mt-0.5 block text-neutral-600 text-sm">{paso.detalle}</span>
      </span>
      <PasoCta paso={paso} />
    </>
  );
  if (!paso.hecho && paso.to) {
    return (
      <Link to={paso.to} className="flex min-h-20 items-center gap-3 px-4 py-3 hover:bg-neutral-50">
        {cuerpo}
      </Link>
    );
  }
  return <div className="flex min-h-20 items-center gap-3 px-4 py-3">{cuerpo}</div>;
}

function PasoCta({ paso }: { paso: PasoAlta }) {
  if (paso.hecho || paso.cta == null) {
    return null;
  }
  if (paso.cta === 'agregar') {
    return (
      <span className="inline-flex shrink-0 items-center rounded-md bg-primary-600 px-3 py-1.5 font-medium text-sm text-white">
        Agregar
      </span>
    );
  }
  if (paso.cta === 'invitar') {
    return (
      <span className="inline-flex shrink-0 items-center rounded-md border border-neutral-300 bg-neutral-0 px-3 py-1.5 font-medium text-neutral-800 text-sm">
        Invitar
      </span>
    );
  }
  return <ChevronRight className="h-5 w-5 shrink-0 text-neutral-400" aria-hidden="true" />;
}

function Accesos({ accesos }: { accesos: AccesoVista[] }) {
  return (
    <section
      aria-labelledby="inicio-accesos"
      data-testid="inicio-accesos"
      className="mt-8 min-w-0 md:hidden"
    >
      <div className="mb-3">
        <h2
          id="inicio-accesos"
          className="font-semibold text-neutral-500 text-xs uppercase tracking-wider"
        >
          Accesos
        </h2>
      </div>
      <Card>
        <ul className="grid grid-cols-4 gap-1 p-2">
          {accesos.map((item) => (
            <li key={item.id}>
              <Acceso item={item} />
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}

function Acceso({ item }: { item: AccesoVista }) {
  const Icono = ICONO_ACCESO[item.id] ?? Truck;
  return (
    <Link
      to={item.to}
      data-testid={item.testId}
      className="flex flex-col items-center gap-2 rounded-md px-1 py-3 text-center hover:bg-neutral-50"
    >
      <span className="relative flex h-12 w-12 items-center justify-center rounded-full bg-primary-50 text-primary-700">
        <Icono className="h-5 w-5" aria-hidden="true" />
        {item.badge != null ? (
          <span
            className={cn(
              '-top-1 -right-1 absolute flex h-5 min-w-5 items-center justify-center rounded-full px-1 font-semibold text-white text-xs',
              item.badgeTono === 'warning' ? 'bg-warning-500' : 'bg-danger-600',
            )}
          >
            {item.badge}
            <span className="sr-only"> pendientes</span>
          </span>
        ) : null}
      </span>
      <span className="font-medium text-neutral-800 text-xs leading-tight">{item.label}</span>
    </Link>
  );
}
