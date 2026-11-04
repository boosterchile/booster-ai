import { Card, cn } from '@booster-ai/ui-components';
import { Link, useSearch } from '@tanstack/react-router';
import {
  ArrowRight,
  Banknote,
  Bus,
  Fuel,
  type LucideIcon,
  MapPinned,
  Radio,
  Receipt,
  ShieldAlert,
  Truck,
  Users,
} from 'lucide-react';
import { Layout } from '../components/Layout.js';
import { InicioTransportistaVista } from '../components/inicio-transportista/inicio-transportista-vista.js';
import {
  type DatosInicio,
  type HrefInicio,
  type InicioVista,
  buildInicioVista,
} from '../components/inicio-transportista/modelo.js';
import type { MeResponse } from '../hooks/use-me.js';

type MeOnboarded = Extract<MeResponse, { needs_onboarding: false }>;

/**
 * /apariencia/inicio — preview público del inicio transportista, sin API.
 * `?estado=operacion|vacio|error|carga|antes`. `antes` conserva la lista de
 * cards previa para comparar. Los números son de ejemplo, como los mockups.
 */
const AHORA = new Date('2026-10-19T13:00:00.000Z');
const LEGAL = 'Transportes Van Oosterwyk';

function mePreview(): MeOnboarded {
  const membership = {
    id: 'm-1',
    role: 'dueno' as const,
    status: 'activa' as const,
    joined_at: null,
    empresa: {
      id: 'e-1',
      legal_name: LEGAL,
      rut: '76.123.456-7',
      is_generador_carga: false,
      is_transportista: true,
      status: 'activa' as const,
    },
  };
  return {
    needs_onboarding: false,
    user: {
      id: 'u-1',
      email: 'felipe@boosterchile.com',
      full_name: 'Felipe',
      phone: null,
      whatsapp_e164: null,
      rut: null,
      is_platform_admin: false,
      status: 'activo',
    },
    memberships: [membership],
    active_membership: membership,
  };
}

function cargaVacia(): DatosInicio {
  return {
    ofertas: { estado: 'listo', valor: [] },
    servicios: { estado: 'listo', valor: [] },
    cumplimiento: { estado: 'listo', valor: { vencidos: 0, porVencer30d: 0, documentos: [] } },
    flota: { estado: 'listo', valor: [] },
    vehiculos: { estado: 'listo', valor: 0 },
    conductores: { estado: 'listo', valor: 0 },
    cobraHoy: 'disponible',
  };
}

function flotaEjemplo(): DatosInicio['flota'] {
  const fresca = new Date(AHORA.getTime() - 5 * 60_000).toISOString();
  const vieja = new Date(AHORA.getTime() - 45 * 60_000).toISOString();
  const conectados = Array.from({ length: 9 }, (_, i) => ({
    plate: `ABCD${String(i).padStart(2, '0')}`,
    teltonikaImei: `imei-${i}`,
    timestampDevice: fresca,
    latitude: -33.4,
    longitude: -70.6,
  }));
  return {
    estado: 'listo',
    valor: [
      ...conectados,
      {
        plate: 'HFTD17',
        teltonikaImei: 'imei-a',
        timestampDevice: vieja,
        latitude: -33.4,
        longitude: -70.6,
      },
      {
        plate: 'LBPW88',
        teltonikaImei: 'imei-b',
        timestampDevice: vieja,
        latitude: -33.5,
        longitude: -70.7,
      },
      {
        plate: 'KKLL99',
        teltonikaImei: null,
        timestampDevice: null,
        latitude: null,
        longitude: null,
      },
    ],
  };
}

function datosOperacion(): DatosInicio {
  const retiro = new Date(AHORA.getTime() + 22 * 60 * 60_000).toISOString();
  const enRuta = Array.from({ length: 5 }, () => ({
    status: 'recogido',
    sinConductor: false,
    pickupInicio: null,
    direccionOrigen: 'Origen',
  }));
  return {
    ofertas: {
      estado: 'listo',
      valor: [
        { expires_at: new Date(AHORA.getTime() + 42 * 60_000).toISOString() },
        { expires_at: new Date(AHORA.getTime() + 90 * 60_000).toISOString() },
        { expires_at: new Date(AHORA.getTime() + 3 * 60 * 60_000).toISOString() },
      ],
    },
    servicios: {
      estado: 'listo',
      valor: [
        ...enRuta,
        {
          status: 'asignado',
          sinConductor: true,
          pickupInicio: retiro,
          direccionOrigen: 'Bodega norte, Quilicura',
        },
        {
          status: 'asignado',
          sinConductor: true,
          pickupInicio: new Date(AHORA.getTime() + 26 * 60 * 60_000).toISOString(),
          direccionOrigen: 'Planta, Santiago',
        },
      ],
    },
    cumplimiento: {
      estado: 'listo',
      valor: {
        vencidos: 4,
        porVencer30d: 3,
        documentos: [{ tipo: 'soap', estado: 'vencido', referencia: 'KXJR42', clase: 'vehiculo' }],
      },
    },
    flota: flotaEjemplo(),
    vehiculos: { estado: 'listo', valor: 12 },
    conductores: { estado: 'listo', valor: 9 },
    cobraHoy: 'disponible',
  };
}

function datosError(): DatosInicio {
  return {
    ofertas: { estado: 'cargando' },
    servicios: { estado: 'cargando' },
    cumplimiento: { estado: 'error' },
    flota: { estado: 'cargando' },
    vehiculos: { estado: 'listo', valor: 12 },
    conductores: { estado: 'listo', valor: 9 },
    cobraHoy: 'disponible',
  };
}

function datosCarga(): DatosInicio {
  return {
    ofertas: { estado: 'cargando' },
    servicios: { estado: 'cargando' },
    cumplimiento: { estado: 'cargando' },
    flota: { estado: 'cargando' },
    vehiculos: { estado: 'listo', valor: 12 },
    conductores: { estado: 'listo', valor: 9 },
    cobraHoy: 'disponible',
  };
}

export function vistaDePreview(estado: string): InicioVista | null {
  if (estado === 'antes') {
    return null;
  }
  const datos =
    estado === 'vacio'
      ? cargaVacia()
      : estado === 'error'
        ? datosError()
        : estado === 'carga'
          ? datosCarga()
          : datosOperacion();
  return buildInicioVista(datos, {
    nombreCompleto: 'Felipe',
    legalName: LEGAL,
    esAdmin: false,
    ahora: AHORA,
  });
}

export function AparienciaInicioRoute() {
  const search = (useSearch({ strict: false }) ?? {}) as { estado?: string };
  const estado = search.estado ?? 'operacion';
  const vista = vistaDePreview(estado);
  return (
    <Layout me={mePreview()} title="Inicio">
      {vista ? (
        <InicioTransportistaVista vista={vista} onReintentar={() => undefined} />
      ) : (
        <InicioAnterior />
      )}
    </Layout>
  );
}

const CARDS_ANTERIOR: Array<{
  to: HrefInicio;
  icon: LucideIcon;
  title: string;
  desc: string;
  tone?: 'primary' | 'warning' | 'success';
}> = [
  {
    to: '/app/flota',
    icon: MapPinned,
    title: 'Seguimiento de flota',
    desc: 'Ubicación en tiempo real de todos tus vehículos en un mapa, con histórico.',
  },
  {
    to: '/app/ofertas',
    icon: Truck,
    title: 'Ofertas activas',
    desc: 'Cargas disponibles para tu empresa. Acepta o rechaza rápido.',
  },
  {
    to: '/app/vehiculos',
    icon: Bus,
    title: 'Vehículos',
    desc: 'Gestiona tu flota: alta, edición, asociación a Teltonika.',
  },
  {
    to: '/app/conductores',
    icon: Users,
    title: 'Conductores',
    desc: 'Crea, edita y monitorea licencias y vencimientos de los conductores de tu empresa.',
  },
  {
    to: '/app/cumplimiento',
    icon: ShieldAlert,
    title: 'Cumplimiento',
    desc: 'Documentos vencidos o por vencer de vehículos y conductores.',
    tone: 'warning',
  },
  {
    to: '/app/cobra-hoy/historial',
    icon: Banknote,
    title: 'Cobra hoy',
    desc: 'Solicita pronto pago de viajes entregados y revisa tu historial de adelantos.',
    tone: 'success',
  },
  {
    to: '/app/liquidaciones',
    icon: Receipt,
    title: 'Liquidaciones',
    desc: 'Desglose de cada viaje entregado: monto bruto, comisión, IVA y DTE Tipo 33.',
  },
  {
    to: '/app/trayectos',
    icon: Fuel,
    title: 'Trayectos Teltonika',
    desc: 'Litros y consumo (km/L) para armar el costo de operación.',
  },
  {
    to: '/app/admin/dispositivos',
    icon: Radio,
    title: 'Dispositivos pendientes',
    desc: 'Aprueba dispositivos Teltonika que conectaron y asígnalos a vehículos.',
  },
];

const TONO: Record<'primary' | 'warning' | 'success', string> = {
  primary: 'bg-primary-50 text-primary-600',
  warning: 'bg-warning-50 text-warning-700',
  success: 'bg-success-50 text-success-700',
};

/** Lista de cards que el inicio del transportista mostraba antes de esta fase. */
function InicioAnterior() {
  return (
    <div>
      <h1 className="font-bold text-2xl text-neutral-900 tracking-tight sm:text-3xl">
        Bienvenido a Booster
      </h1>
      <p className="mt-2 text-neutral-600 text-sm">
        Empresa activa: <span className="font-medium">{LEGAL}</span> · Transportista
      </p>
      <section className="mt-10">
        <h2 className="font-semibold text-neutral-900 text-xl">Como transportista</h2>
        {CARDS_ANTERIOR.map((card) => {
          const Icono = card.icon;
          return (
            <Link key={card.to} to={card.to} className="mt-3 block">
              <Card className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div
                    className={cn(
                      'flex h-10 w-10 shrink-0 items-center justify-center rounded-md',
                      TONO[card.tone ?? 'primary'],
                    )}
                  >
                    <Icono className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <div>
                    <div className="font-medium text-neutral-900">{card.title}</div>
                    <div className="text-neutral-600 text-sm">{card.desc}</div>
                  </div>
                </div>
                <ArrowRight className="h-5 w-5 shrink-0 text-neutral-400" aria-hidden="true" />
              </Card>
            </Link>
          );
        })}
      </section>
    </div>
  );
}
