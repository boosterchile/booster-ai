import { Layout } from '../components/Layout.js';
import {
  fechaLargaEs,
  horaEnZona,
  nombreDePila,
  saludoPorHora,
} from '../components/inicio-transportista/modelo.js';
import {
  type CertificadoInicio,
  type ViajeInicio,
  buildGeneradorHoy,
} from '../components/inicio/generador.js';
import { InicioGeneradorVista } from '../components/inicio/inicio-generador-vista.js';
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
      legal_name: 'Viña Santa Clara',
      rut: '76.123.456-7',
      is_generador_carga: true,
      is_transportista: false,
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

function viajes(): ViajeInicio[] {
  return [
    {
      id: 't-821',
      trackingCode: 'BST-4821',
      status: 'ofertas_enviadas',
      origen: 'Planta, Lampa',
      destino: 'Puerto, Valparaíso',
      pickupInicio: '2026-10-20T12:00:00.000Z',
      precioClp: 340000,
      transportista: null,
      avancePct: null,
      ofertasPendientes: 4,
    },
    {
      id: 't-802',
      trackingCode: 'BST-4802',
      status: 'asignado',
      origen: 'Bodega, Rancagua',
      destino: 'Centro, Rancagua',
      pickupInicio: '2026-10-19T21:00:00.000Z',
      precioClp: 290000,
      transportista: 'Transp. Van Oosterwyk',
      avancePct: 50,
      ofertasPendientes: 0,
    },
    {
      id: 't-790',
      trackingCode: 'BST-4790',
      status: 'en_proceso',
      origen: 'Bodega, Quilicura',
      destino: 'Puerto, Concepción',
      pickupInicio: '2026-10-19T17:20:00.000Z',
      precioClp: 1080000,
      transportista: 'Van Oosterwyk',
      avancePct: 75,
      ofertasPendientes: 0,
    },
    {
      id: 't-825',
      trackingCode: 'BST-4825',
      status: 'emparejando',
      origen: 'Planta, Colina',
      destino: 'Centro, Talca',
      pickupInicio: '2026-10-20T18:00:00.000Z',
      precioClp: 610000,
      transportista: null,
      avancePct: null,
      ofertasPendientes: 2,
    },
    {
      id: 't-818',
      trackingCode: 'BST-4818',
      status: 'asignado',
      origen: 'Bodega, Renca',
      destino: 'Centro, Los Andes',
      pickupInicio: '2026-10-21T10:30:00.000Z',
      precioClp: 350000,
      transportista: 'Fletes del Maule',
      avancePct: 50,
      ofertasPendientes: 0,
    },
  ];
}

function certs(): CertificadoInicio[] {
  return [
    {
      trackingCode: 'BST-4701',
      kg: 2400,
      emitidoEn: '2026-10-17T15:00:00.000Z',
      origen: 'Santiago',
      destino: 'Rancagua',
    },
    {
      trackingCode: 'BST-4702',
      kg: 2400,
      emitidoEn: '2026-10-10T15:00:00.000Z',
      origen: 'Santiago',
      destino: 'Talca',
    },
  ];
}

export function AparienciaInicioGeneradorRoute() {
  const me = mePreview();
  const pila = nombreDePila(me.user.full_name);
  const saludo = `${saludoPorHora(horaEnZona(AHORA))}, ${pila}`;
  const linea = `${fechaLargaEs(AHORA)} · ${me.active_membership?.empresa?.legal_name ?? ''} · Generador de carga`;
  const negocio = buildGeneradorHoy(
    { estado: 'listo', valor: viajes() },
    { estado: 'listo', valor: certs() },
    AHORA,
    { soloLectura: false },
  );
  const accesos = navSectionsForMe(me).flatMap((seccion) =>
    seccion.heading === 'Generador' ? seccion.items : [],
  );
  return (
    <Layout me={me} title="Inicio">
      <InicioGeneradorVista
        saludo={saludo}
        linea={linea}
        negocio={negocio}
        accesos={accesos}
        soloLectura={false}
        onReintentar={() => undefined}
      />
    </Layout>
  );
}
