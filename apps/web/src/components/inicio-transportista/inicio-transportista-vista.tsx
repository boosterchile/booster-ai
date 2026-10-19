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
  RotateCw,
  Route,
  ShieldAlert,
  Signal,
  Truck,
  UserRoundX,
  Users,
  WifiOff,
} from 'lucide-react';
import type {
  AccesoVista,
  AtencionVista,
  EstadoCobraHoy as EstadoCobraHoyVista,
  FilaAtencion,
  FuenteReintento,
  InicioVista,
  KpiConectados,
  KpiEnRuta,
  PasoAlta,
} from './modelo.js';

const TONO_ICONO = {
  warning: 'bg-warning-50 text-warning-700',
  danger: 'bg-danger-50 text-danger-700',
  neutral: 'bg-neutral-100 text-neutral-700',
} as const;

const ICONO_FILA: Record<'ofertas' | 'sin-conductor' | 'documentos' | 'sin-senal', LucideIcon> = {
  ofertas: Truck,
  'sin-conductor': UserRoundX,
  documentos: ShieldAlert,
  'sin-senal': WifiOff,
};

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
  onReintentar,
}: {
  vista: InicioVista;
  onReintentar: (fuente: FuenteReintento) => void;
}) {
  return (
    <div data-testid="inicio-transportista" className="min-w-0">
      <Saludo vista={vista} />
      <EstadoCobraHoy estado={vista.cobraHoy} />
      {vista.modo === 'empresa-nueva' && vista.pasos ? (
        <div className="mt-6 space-y-6">
          <Alta pasos={vista.pasos} />
          <Atencion atencion={vista.atencion} onReintentar={onReintentar} />
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2 md:items-start">
          <Atencion atencion={vista.atencion} onReintentar={onReintentar} />
          {vista.enRuta && vista.conectados ? (
            <Operacion
              enRuta={vista.enRuta}
              conectados={vista.conectados}
              onReintentar={onReintentar}
            />
          ) : null}
        </div>
      )}
      <Accesos accesos={vista.accesos} />
    </div>
  );
}

function Saludo({ vista }: { vista: InicioVista }) {
  return (
    <header>
      <h1 className="font-bold text-2xl text-neutral-900 tracking-tight sm:text-3xl">
        {vista.saludo}
        {vista.modo === 'empresa-nueva' ? <span aria-hidden="true"> 👋</span> : null}
      </h1>
      {vista.fecha ? <p className="mt-1 text-neutral-600 text-sm">{vista.fecha}</p> : null}
      <div className="mt-4 inline-flex max-w-full items-center gap-2 rounded-full border border-neutral-200 bg-neutral-0 py-1 pr-3 pl-1 shadow-xs">
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-600 font-semibold text-white text-xs"
          aria-hidden="true"
        >
          {vista.iniciales}
        </span>
        <span className="truncate font-medium text-neutral-900 text-sm">{vista.empresa}</span>
        <span className="shrink-0 text-neutral-500 text-sm">· Transportista</span>
      </div>
    </header>
  );
}

function EstadoCobraHoy({ estado }: { estado: EstadoCobraHoyVista }) {
  if (estado !== 'apagado' && estado !== 'error') {
    return null;
  }
  return (
    <output data-testid="inicio-cobra-hoy" className="mt-4 block text-neutral-600 text-sm">
      {estado === 'apagado'
        ? 'La opción de pronto pago todavía no está activa en este entorno.'
        : 'Cobra hoy no está disponible ahora. El resto del Inicio sigue funcionando.'}
    </output>
  );
}

function tituloSeccion(texto: string, id?: string) {
  return (
    <h2 id={id} className="font-semibold text-neutral-500 text-xs uppercase tracking-wider">
      {texto}
    </h2>
  );
}

function Atencion({
  atencion,
  onReintentar,
}: {
  atencion: AtencionVista;
  onReintentar: (fuente: FuenteReintento) => void;
}) {
  const pendientes = atencion.tipo === 'filas' ? atencion.pendientes : null;
  return (
    <section aria-labelledby="inicio-atencion" className="min-w-0">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2
          id="inicio-atencion"
          className="font-semibold text-neutral-500 text-xs uppercase tracking-wider"
        >
          Requiere tu atención
        </h2>
        {pendientes != null ? (
          <p className="font-semibold text-warning-700 text-xs uppercase tracking-wider">
            {pendientes === 1 ? '1 pendiente' : `${pendientes} pendientes`}
          </p>
        ) : null}
      </div>
      {atencion.tipo === 'calmo' ? <EstadoCalmo /> : null}
      {atencion.tipo === 'filas' ? (
        <Card>
          <ul className="divide-y divide-neutral-200">
            {atencion.filas.map((fila) => (
              <li key={fila.id}>
                <Fila fila={fila} onReintentar={onReintentar} />
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </section>
  );
}

function EstadoCalmo() {
  return (
    <Card>
      <div className="flex min-h-20 items-start gap-3 p-4">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-success-50 text-success-700">
          <Check className="h-5 w-5" aria-hidden="true" />
        </span>
        <div>
          <p className="font-medium text-neutral-900">Nada pendiente por ahora</p>
          <p className="mt-0.5 text-neutral-600 text-sm">
            Cuando lleguen ofertas, aparecen acá primero.
          </p>
        </div>
      </div>
    </Card>
  );
}

function Fila({
  fila,
  onReintentar,
}: {
  fila: FilaAtencion;
  onReintentar: (fuente: FuenteReintento) => void;
}) {
  if (fila.kind === 'skeleton') {
    return <FilaSkeleton />;
  }
  if (fila.kind === 'error') {
    return (
      <div role="alert" className="flex min-h-20 items-center gap-3 px-4 py-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-warning-50 text-warning-700">
          <ShieldAlert className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-neutral-900">No cargó {fila.bloque}</p>
          <p className="text-neutral-600 text-sm">El resto del Inicio sigue funcionando</p>
        </div>
        <button
          type="button"
          data-testid={`reintentar-${fila.fuente}`}
          onClick={() => onReintentar(fila.fuente)}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-neutral-300 bg-neutral-0 px-3 py-1.5 font-medium text-neutral-800 text-sm hover:bg-neutral-50"
        >
          <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
          Reintentar
        </button>
      </div>
    );
  }
  const Icono = ICONO_FILA[fila.id];
  return (
    <Link to={fila.href} className="flex min-h-20 items-center gap-3 px-4 py-3 hover:bg-neutral-50">
      <span
        className={cn(
          'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg',
          TONO_ICONO[fila.tono],
        )}
      >
        <Icono className="h-5 w-5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-medium text-neutral-900">{fila.titulo}</span>
        {fila.subtitulo ? (
          <span
            className={cn(
              'mt-0.5 block text-sm',
              fila.urgente ? 'font-medium text-warning-700' : 'text-neutral-600',
            )}
          >
            {fila.subtitulo}
          </span>
        ) : null}
      </span>
      <Cta fila={fila} />
    </Link>
  );
}

function Cta({ fila }: { fila: Extract<FilaAtencion, { kind: 'dato' }> }) {
  if (fila.cta === 'ver') {
    return (
      <span className="inline-flex shrink-0 items-center rounded-md bg-primary-600 px-3 py-1.5 font-medium text-sm text-white">
        Ver
      </span>
    );
  }
  if (fila.cta === 'asignar') {
    return (
      <span className="inline-flex shrink-0 items-center rounded-md border border-neutral-300 bg-neutral-0 px-3 py-1.5 font-medium text-neutral-800 text-sm">
        Asignar
      </span>
    );
  }
  return <ChevronRight className="h-5 w-5 shrink-0 text-neutral-400" aria-hidden="true" />;
}

function FilaSkeleton() {
  return (
    <div className="flex h-20 items-center gap-3 px-4" aria-hidden="true">
      <div className="h-10 w-10 animate-pulse rounded-lg bg-neutral-100" />
      <div className="flex-1 space-y-2">
        <div className="h-3 w-40 max-w-full animate-pulse rounded bg-neutral-100" />
        <div className="h-3 w-56 max-w-full animate-pulse rounded bg-neutral-100" />
      </div>
    </div>
  );
}

function Operacion({
  enRuta,
  conectados,
  onReintentar,
}: {
  enRuta: KpiEnRuta;
  conectados: KpiConectados;
  onReintentar: (fuente: FuenteReintento) => void;
}) {
  return (
    <section aria-labelledby="inicio-operacion" className="min-w-0">
      <div className="mb-3">{tituloSeccion('Tu operación hoy', 'inicio-operacion')}</div>
      <div className="grid grid-cols-2 gap-3">
        <KpiEnRutaCard kpi={enRuta} onReintentar={onReintentar} />
        <KpiConectadosCard kpi={conectados} onReintentar={onReintentar} />
      </div>
    </section>
  );
}

function KpiEnRutaCard({
  kpi,
  onReintentar,
}: {
  kpi: KpiEnRuta;
  onReintentar: (fuente: FuenteReintento) => void;
}) {
  if (kpi.estado === 'cargando') {
    return <KpiSkeleton />;
  }
  if (kpi.estado === 'error') {
    return <KpiError bloque="Servicios" fuente="servicios" onReintentar={onReintentar} />;
  }
  return (
    <Card className="min-h-32">
      <div className="p-4">
        <div className="flex items-center gap-1.5 text-neutral-600 text-sm">
          <Route className="h-4 w-4" aria-hidden="true" />
          En ruta
        </div>
        <p className="mt-2 font-semibold text-3xl text-neutral-900 tracking-tight">{kpi.enRuta}</p>
        <p className="mt-1 text-neutral-600 text-sm">{kpi.porRetirar} por retirar</p>
      </div>
    </Card>
  );
}

function KpiConectadosCard({
  kpi,
  onReintentar,
}: {
  kpi: KpiConectados;
  onReintentar: (fuente: FuenteReintento) => void;
}) {
  if (kpi.estado === 'cargando') {
    return <KpiSkeleton />;
  }
  if (kpi.estado === 'error') {
    return <KpiError bloque="Flota" fuente="flota" onReintentar={onReintentar} />;
  }
  const total = Math.max(kpi.total, 1);
  const anchoConectados = kpi.total === 0 ? 0 : (kpi.conectados / total) * 100;
  const anchoSenal = kpi.total === 0 ? 0 : (kpi.sinSenal / total) * 100;
  return (
    <Card className="min-h-32">
      <div className="p-4">
        <div className="flex items-center gap-1.5 text-neutral-600 text-sm">
          <Signal className="h-4 w-4" aria-hidden="true" />
          Conectados
        </div>
        <p className="mt-2 font-semibold text-neutral-900 tracking-tight">
          <span className="text-3xl">{kpi.conectados}</span>
          <span className="text-neutral-500 text-xl">/{kpi.total}</span>
        </p>
        <div
          className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-neutral-200"
          aria-hidden="true"
        >
          <div className="h-full bg-success-600" style={{ width: `${anchoConectados}%` }} />
          <div className="h-full bg-warning-500" style={{ width: `${anchoSenal}%` }} />
        </div>
        <p className="mt-2 text-neutral-600 text-sm">
          {kpi.sinSenal} sin señal · {kpi.sinGps} sin GPS
        </p>
      </div>
    </Card>
  );
}

function KpiSkeleton() {
  return (
    <Card className="h-32" aria-hidden="true">
      <div className="space-y-3 p-4">
        <div className="h-3 w-20 animate-pulse rounded bg-neutral-100" />
        <div className="h-8 w-16 animate-pulse rounded bg-neutral-100" />
        <div className="h-3 w-24 animate-pulse rounded bg-neutral-100" />
      </div>
    </Card>
  );
}

function KpiError({
  bloque,
  fuente,
  onReintentar,
}: {
  bloque: string;
  fuente: FuenteReintento;
  onReintentar: (fuente: FuenteReintento) => void;
}) {
  return (
    <Card className="min-h-32">
      <div role="alert" className="p-4">
        <p className="font-medium text-neutral-900 text-sm">No cargó {bloque}</p>
        <p className="mt-1 text-neutral-600 text-xs">El resto del Inicio sigue funcionando</p>
        <button
          type="button"
          data-testid={`reintentar-kpi-${fuente}`}
          onClick={() => onReintentar(fuente)}
          className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-neutral-300 px-2.5 py-1 font-medium text-neutral-800 text-xs hover:bg-neutral-50"
        >
          <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
          Reintentar
        </button>
      </div>
    </Card>
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
