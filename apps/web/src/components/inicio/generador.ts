import { comunaDesdeDireccion } from '../inicio-transportista/modelo.js';
import type { AgendaItem } from './agenda.js';
import type { AvisoItem } from './avisos.js';
import { dentroDeDias, mismoMes, partesCuando } from './cuando.js';
import { INICIO_GASTO_GENERADOR_ACTIVO, INICIO_MONTOS_VISUALIZADOR } from './flags.js';
import type { PinMapa } from './map-preview-card.js';
import { pipelineDe } from './pipeline.js';

export type Panel<T> =
  | { estado: 'cargando' }
  | { estado: 'error' }
  | { estado: 'vacio' }
  | { estado: 'listo'; valor: T };

export interface ViajeInicio {
  id: string;
  trackingCode: string;
  status: string;
  origen: string;
  destino: string;
  pickupInicio: string | null;
  precioClp: number | null;
  transportista: string | null;
  avancePct: number | null;
  ofertasPendientes: number | null;
}

export interface CertificadoInicio {
  trackingCode: string;
  kg: number | null;
  emitidoEn: string | null;
  origen: string;
  destino: string;
}

export interface CargasVista {
  buscando: number;
  asignadas: number;
  enCamino: number;
  destacada: { codigo: string; detalle: string } | null;
}

export interface HuellaVista {
  texto: string;
  detalle: string;
}

export interface GeneradorHoy {
  cargas: Panel<CargasVista>;
  agenda: Panel<AgendaItem[]>;
  huella: Panel<HuellaVista>;
  avisos: AvisoItem[];
  mapa: { pins: PinMapa[]; resumen: string | null };
  gastoActivo: boolean;
  verMontos: boolean;
}

const AGENDA_TOPE = 5;
const ACTIVOS = new Set(['buscando', 'asignada', 'en_camino']);

function lugar(direccion: string): string {
  return comunaDesdeDireccion(direccion) ?? direccion.trim();
}

function ruta(viaje: ViajeInicio): string {
  const desde = lugar(viaje.origen);
  const hasta = lugar(viaje.destino);
  if (desde.length === 0) {
    return hasta || 'Carga';
  }
  if (hasta.length === 0) {
    return desde;
  }
  return `${desde} → ${hasta}`;
}

function pesos(valor: number): string {
  return new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency: 'CLP',
    maximumFractionDigits: 0,
  }).format(valor);
}

export function textoHuella(kg: number): string {
  if (kg >= 1000) {
    const toneladas = kg / 1000;
    const texto = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 1 }).format(toneladas);
    return `${texto} t CO₂e`;
  }
  const texto = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(kg);
  return `${texto} kg CO₂e`;
}

function estadoVisible(viaje: ViajeInicio): { texto: string; tono: AgendaItem['tono'] } | null {
  const pipeline = pipelineDe(viaje.status);
  if (pipeline === 'en_camino') {
    return { texto: 'En camino', tono: 'info' };
  }
  if (pipeline === 'asignada') {
    return { texto: 'Asignado', tono: 'neutral' };
  }
  if (pipeline === 'buscando') {
    return { texto: 'Buscando', tono: 'warning' };
  }
  if (pipeline === 'entregada') {
    return { texto: 'Entregado', tono: 'success' };
  }
  return null;
}

function ordenPickup(viaje: ViajeInicio): number {
  if (!viaje.pickupInicio) {
    return Number.POSITIVE_INFINITY;
  }
  const ts = Date.parse(viaje.pickupInicio);
  return Number.isNaN(ts) ? Number.POSITIVE_INFINITY : ts;
}

function destacadaDe(viajes: ViajeInicio[], ahora: Date): CargasVista['destacada'] {
  const sinMatch = viajes
    .filter((viaje) => pipelineDe(viaje.status) === 'buscando')
    .slice()
    .sort((a, b) => ordenPickup(a) - ordenPickup(b));
  const primera = sinMatch[0];
  if (!primera) {
    return null;
  }
  const cuando = partesCuando(primera.pickupInicio, ahora);
  const partes = [`Retiro ${cuando.dia.toLowerCase()} ${cuando.hora}`];
  if (primera.ofertasPendientes != null && primera.ofertasPendientes > 0) {
    partes.push(`ofertas enviadas a ${primera.ofertasPendientes}`);
  }
  return { codigo: `${primera.trackingCode} sin transportista aún`, detalle: partes.join(' · ') };
}

function aAgenda(viaje: ViajeInicio, ahora: Date, verMontos: boolean): AgendaItem {
  const cuando = partesCuando(viaje.pickupInicio, ahora);
  const estado = estadoVisible(viaje);
  const pipeline = pipelineDe(viaje.status);
  return {
    id: viaje.id,
    dia: cuando.dia,
    hora: cuando.hora,
    titulo: ruta(viaje),
    codigo: viaje.trackingCode,
    transportista: viaje.transportista,
    estado: estado?.texto ?? null,
    tono: estado?.tono ?? 'neutral',
    avancePct: pipeline === 'en_camino' ? viaje.avancePct : null,
    precio: verMontos && viaje.precioClp != null ? pesos(viaje.precioClp) : null,
    href: pipeline === 'en_camino' ? `/app/cargas/${viaje.id}/track` : `/app/cargas/${viaje.id}`,
    etiqueta: null,
  };
}

export function buildGeneradorHoy(
  viajes: Panel<ViajeInicio[]>,
  certificados: Panel<CertificadoInicio[]>,
  ahora: Date,
  opts: { soloLectura: boolean },
): GeneradorHoy {
  const verMontos = !opts.soloLectura || INICIO_MONTOS_VISUALIZADOR;
  const gastoActivo = INICIO_GASTO_GENERADOR_ACTIVO && verMontos;
  if (viajes.estado === 'cargando') {
    return {
      cargas: { estado: 'cargando' },
      agenda: { estado: 'cargando' },
      huella: huellaDe(certificados, ahora),
      avisos: avisosDe(certificados, ahora),
      mapa: { pins: [], resumen: null },
      gastoActivo,
      verMontos,
    };
  }
  if (viajes.estado === 'error') {
    return {
      cargas: { estado: 'error' },
      agenda: { estado: 'error' },
      huella: huellaDe(certificados, ahora),
      avisos: avisosDe(certificados, ahora),
      mapa: { pins: [], resumen: null },
      gastoActivo,
      verMontos,
    };
  }
  if (viajes.estado !== 'listo') {
    return {
      cargas: { estado: 'vacio' },
      agenda: { estado: 'vacio' },
      huella: huellaDe(certificados, ahora),
      avisos: avisosDe(certificados, ahora),
      mapa: { pins: [], resumen: null },
      gastoActivo,
      verMontos,
    };
  }
  const filas = viajes.valor;
  const buscando = filas.filter((v) => pipelineDe(v.status) === 'buscando').length;
  const asignadas = filas.filter((v) => pipelineDe(v.status) === 'asignada').length;
  const enCamino = filas.filter((v) => pipelineDe(v.status) === 'en_camino').length;
  const agenda = filas
    .filter((v) => ACTIVOS.has(pipelineDe(v.status)))
    .slice()
    .sort((a, b) => ordenPickup(a) - ordenPickup(b))
    .slice(0, AGENDA_TOPE)
    .map((v) => aAgenda(v, ahora, verMontos));
  const pins = filas
    .filter((v) => pipelineDe(v.status) === 'en_camino')
    .map((v) => ({
      id: v.id,
      titulo: v.trackingCode,
      detalle: ruta(v),
      href: `/app/cargas/${v.id}/track`,
    }));
  const proxima = agenda.find((item) => item.estado === 'En camino') ?? null;
  return {
    cargas:
      filas.length === 0
        ? { estado: 'vacio' }
        : {
            estado: 'listo',
            valor: { buscando, asignadas, enCamino, destacada: destacadaDe(filas, ahora) },
          },
    agenda: agenda.length === 0 ? { estado: 'vacio' } : { estado: 'listo', valor: agenda },
    huella: huellaDe(certificados, ahora),
    avisos: avisosDe(certificados, ahora),
    mapa: {
      pins,
      resumen:
        pins.length === 0
          ? null
          : proxima
            ? `${pins.length} en camino · Próxima ${proxima.dia.toLowerCase()} ${proxima.hora} · ${proxima.titulo}`
            : `${pins.length} en camino`,
    },
    gastoActivo,
    verMontos,
  };
}

function huellaDe(certificados: Panel<CertificadoInicio[]>, ahora: Date): Panel<HuellaVista> {
  if (certificados.estado === 'cargando') {
    return { estado: 'cargando' };
  }
  if (certificados.estado === 'error') {
    return { estado: 'error' };
  }
  if (certificados.estado !== 'listo') {
    return { estado: 'vacio' };
  }
  const delMes = certificados.valor.filter(
    (cert) => cert.emitidoEn != null && mismoMes(cert.emitidoEn, ahora),
  );
  const kg = delMes.reduce((suma, cert) => suma + (cert.kg ?? 0), 0);
  if (delMes.length === 0) {
    return {
      estado: 'listo',
      valor: { texto: textoHuella(0), detalle: 'Sin certificados este mes' },
    };
  }
  const detalle = delMes.length === 1 ? '1 certificado' : `${delMes.length} certificados`;
  return { estado: 'listo', valor: { texto: textoHuella(kg), detalle } };
}

function avisosDe(certificados: Panel<CertificadoInicio[]>, ahora: Date): AvisoItem[] {
  if (certificados.estado !== 'listo') {
    return [];
  }
  const nuevos = certificados.valor.filter(
    (cert) => cert.emitidoEn != null && dentroDeDias(cert.emitidoEn, ahora, 7),
  );
  if (nuevos.length === 0) {
    return [
      {
        id: 'cert-ok',
        titulo: 'Certificados al día',
        detalle: null,
        href: '/app/certificados',
        tono: 'calmo',
      },
    ];
  }
  const primero = nuevos[0];
  return [
    {
      id: 'cert-nuevos',
      titulo: nuevos.length === 1 ? '1 certificado nuevo' : `${nuevos.length} certificados nuevos`,
      detalle: primero ? `${primero.trackingCode} listo para descargar` : null,
      href: '/app/certificados',
      tono: 'calmo',
    },
  ];
}

export function kgDe(valor: number | string | null | undefined): number | null {
  if (typeof valor === 'number' && Number.isFinite(valor)) {
    return valor;
  }
  if (typeof valor === 'string' && valor.trim().length > 0) {
    const n = Number(valor);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
