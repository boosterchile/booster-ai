import { Layout } from '../components/Layout.js';
import {
  type DatosInicio,
  fechaLargaEs,
  horaEnZona,
  nombreDePila,
  saludoPorHora,
} from '../components/inicio-transportista/modelo.js';
import { buildNegocioHoy } from '../components/inicio-transportista/negocio.js';
import { type ViajeInicio, buildGeneradorHoy } from '../components/inicio/generador.js';
import { InicioMixtaVista } from '../components/inicio/inicio-mixta-vista.js';
import { navSectionsForMe } from '../components/nav-items.js';
import type { MeResponse } from '../hooks/use-me.js';

const AHORA = new Date('2026-10-19T16:30:00.000Z');

type MeOnboarded = Extract<MeResponse, { needs_onboarding: false }>;

function mePreview(): MeOnboarded {
  const membership = {
    id: 'm-1',
    role: 'dueno' as const,
    status: 'activa' as const,
    joined_at: null,
    empresa: {
      id: 'e-1',
      legal_name: 'Logística Andes SpA',
      rut: '76.123.456-7',
      is_generador_carga: true,
      is_transportista: true,
      status: 'activa' as const,
    },
  };
  return {
    needs_onboarding: false,
    user: {
      id: 'u-1',
      email: 'felipe@boosterchile.com',
      full_name: 'Felipe Vicencio',
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

function datosPreview(): DatosInicio {
  const hace = new Date(AHORA.getTime() - 45 * 60_000).toISOString();
  return {
    ofertas: {
      estado: 'listo',
      valor: [
        {
          expires_at: '2026-10-19T19:30:00.000Z',
          precioClp: 420000,
          origen: 'Planta, Santiago',
          destino: 'Centro, Rancagua',
        },
      ],
    },
    servicios: {
      estado: 'listo',
      valor: [
        {
          id: 'a-kx',
          status: 'asignado',
          sinConductor: false,
          pickupInicio: '2026-10-19T19:30:00.000Z',
          direccionOrigen: 'Planta, Quilicura',
          direccionDestino: 'Puerto, San Antonio',
          patente: 'KXJR42',
          conductor: 'Juan Soto',
        },
        {
          id: 'a-hf',
          status: 'asignado',
          sinConductor: true,
          pickupInicio: '2026-10-20T11:00:00.000Z',
          direccionOrigen: 'Bodega, Lampa',
          direccionDestino: 'Centro, Rancagua',
          patente: 'HFTD17',
        },
      ],
    },
    cumplimiento: {
      estado: 'listo',
      valor: {
        vencidos: 0,
        porVencer30d: 1,
        documentos: [
          {
            tipo: 'licencia',
            estado: 'por_vencer',
            referencia: 'Juan Soto',
            clase: 'conductor',
          },
        ],
      },
    },
    flota: {
      estado: 'listo',
      valor: [
        {
          id: 'v-1',
          plate: 'KXJR42',
          teltonikaImei: '1001',
          timestampDevice: hace,
          latitude: -33.4,
          longitude: -70.6,
        },
        {
          id: 'v-2',
          plate: 'HFTD17',
          teltonikaImei: '1002',
          timestampDevice: hace,
          latitude: -33.5,
          longitude: -70.7,
        },
      ],
    },
    vehiculos: { estado: 'listo', valor: 2 },
    conductores: { estado: 'listo', valor: 2 },
    cobraHoy: 'disponible',
  };
}

function viajes(): ViajeInicio[] {
  return [
    {
      id: 't-802',
      trackingCode: 'BST-4802',
      status: 'asignado',
      origen: 'Entrega, Rancagua',
      destino: 'Centro, Rancagua',
      pickupInicio: '2026-10-19T21:00:00.000Z',
      precioClp: 290000,
      transportista: null,
      avancePct: 50,
      ofertasPendientes: 0,
    },
    {
      id: 't-821',
      trackingCode: 'BST-4821',
      status: 'ofertas_enviadas',
      origen: 'Planta, Lampa',
      destino: 'Puerto, Valparaíso',
      pickupInicio: '2026-10-21T15:00:00.000Z',
      precioClp: 340000,
      transportista: null,
      avancePct: null,
      ofertasPendientes: 4,
    },
    {
      id: 't-818',
      trackingCode: 'BST-4818',
      status: 'asignado',
      origen: 'Bodega, Renca',
      destino: 'Centro, Los Andes',
      pickupInicio: '2026-10-21T12:00:00.000Z',
      precioClp: 350000,
      transportista: 'Fletes del Maule',
      avancePct: 50,
      ofertasPendientes: 0,
    },
    {
      id: 't-790',
      trackingCode: 'BST-4790',
      status: 'en_proceso',
      origen: 'Planta, Quilicura',
      destino: 'Puerto, Concepción',
      pickupInicio: '2026-10-21T18:00:00.000Z',
      precioClp: 610000,
      transportista: 'Van Oosterwyk',
      avancePct: 75,
      ofertasPendientes: 0,
    },
  ];
}

export function AparienciaInicioMixtaRoute() {
  const me = mePreview();
  const pila = nombreDePila(me.user.full_name);
  const saludo = `${saludoPorHora(horaEnZona(AHORA))}, ${pila}`;
  const empresa = me.active_membership?.empresa?.legal_name ?? '';
  const negocio = buildNegocioHoy(datosPreview(), AHORA);
  const generador = buildGeneradorHoy(
    { estado: 'listo', valor: viajes() },
    { estado: 'listo', valor: [] },
    AHORA,
    { soloLectura: false },
  );
  const secciones = navSectionsForMe(me);
  return (
    <Layout me={me} title="Inicio">
      <InicioMixtaVista
        saludo={saludo}
        linea={`${fechaLargaEs(AHORA)} · ${empresa}`}
        negocio={negocio}
        generador={generador}
        ahora={AHORA}
        accesosTransporte={secciones.flatMap((seccion) =>
          seccion.heading === 'Transporte' ? seccion.items : [],
        )}
        accesosGenerador={secciones.flatMap((seccion) =>
          seccion.heading === 'Generador' ? seccion.items : [],
        )}
        soloLectura={false}
        onReintentar={() => undefined}
      />
    </Layout>
  );
}
