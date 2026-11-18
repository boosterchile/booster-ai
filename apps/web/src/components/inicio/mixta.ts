import { ZONA_INICIO } from '../inicio-transportista/modelo.js';
import type { NegocioHoy, OfertaNegocio, RetiroNegocio } from '../inicio-transportista/negocio.js';
import type { AgendaItem } from './agenda.js';
import type { AvisoItem } from './avisos.js';
import type { GeneradorHoy, Panel } from './generador.js';
import type { LadoPlata } from './money-pair.js';

export type FiltroMixta = 'todo' | 'transporte' | 'generador';

export interface MixtaHoy {
  ofertas: Panel<OfertaNegocio> | null;
  cargas: GeneradorHoy['cargas'] | null;
  agenda: Panel<AgendaItem[]>;
  falloTransporte: boolean;
  falloGenerador: boolean;
  facturado: LadoPlata | null;
  gasto: LadoPlata | null;
  plataTitulo: string;
  avisos: AvisoItem[];
  verMontos: boolean;
}

const AGENDA_TOPE = 5;

function rangoDia(dia: string): number {
  if (dia === 'Hoy') {
    return 0;
  }
  if (dia === 'Mañana') {
    return 1;
  }
  if (dia === 'Sin hora') {
    return 9;
  }
  return 2;
}

function ordenVisible(item: AgendaItem): number {
  const match = /^(\d{2}):(\d{2})$/.exec(item.hora);
  const minutos = match ? Number(match[1]) * 60 + Number(match[2]) : 24 * 60;
  return rangoDia(item.dia) * 10_000 + minutos;
}

function filaTransporte(retiro: RetiroNegocio, soloLectura: boolean): AgendaItem {
  const fila: AgendaItem = {
    id: `transporte-${retiro.clave}`,
    dia: retiro.dia,
    hora: retiro.hora,
    titulo: retiro.ruta,
    codigo: retiro.patente,
    transportista: null,
    estado: retiro.sinConductor ? 'Sin conductor' : null,
    tono: retiro.sinConductor ? 'danger' : 'neutral',
    avancePct: null,
    precio: null,
    href: '/app/servicios',
    etiqueta: 'Transporte',
  };
  if (retiro.asignarId) {
    fila.accion = {
      label: soloLectura ? 'Ver' : 'Asignar',
      href: `/app/asignaciones/${retiro.asignarId}`,
    };
  }
  return fila;
}

function filaCarga(item: AgendaItem): AgendaItem {
  return { ...item, id: `carga-${item.id}`, etiqueta: 'Mi carga' };
}

function ofertasSinMonto(panel: Panel<OfertaNegocio>, verMontos: boolean): Panel<OfertaNegocio> {
  if (verMontos || panel.estado !== 'listo' || panel.valor.precio == null) {
    return panel;
  }
  return { estado: 'listo', valor: { ...panel.valor, precio: null } };
}

function mesEnCurso(ahora: Date): string {
  return new Intl.DateTimeFormat('es-CL', { month: 'long', timeZone: ZONA_INICIO }).format(ahora);
}

/**
 * Facturado y gasto siguen apagados: la regla no está cerrada, así que
 * el lado existe y no lleva monto. No hay fila de neto.
 */
function ladoPlata(label: string): LadoPlata {
  return { label, valor: null, detalle: null };
}

function avisosDe(negocio: NegocioHoy, generador: GeneradorHoy, filtro: FiltroMixta): AvisoItem[] {
  const avisos: AvisoItem[] = [];
  if (filtro !== 'generador') {
    if (negocio.senal.estado === 'listo') {
      avisos.push(negocio.senal.valor);
    }
    if (negocio.documentos.estado === 'listo') {
      avisos.push(negocio.documentos.valor);
    }
  }
  if (filtro !== 'transporte') {
    avisos.push(...generador.avisos);
  }
  const urgentes = avisos.filter((aviso) => aviso.tono === 'alerta');
  return urgentes.length > 0 ? urgentes : avisos;
}

export function buildMixtaHoy(
  negocio: NegocioHoy,
  generador: GeneradorHoy,
  filtro: FiltroMixta,
  ahora: Date,
  opts: { soloLectura: boolean },
): MixtaHoy {
  const verMontos = generador.verMontos;
  const pideTransporte = filtro !== 'generador';
  const pideGenerador = filtro !== 'transporte';
  const agenda = armarAgenda(
    negocio.retiros,
    generador.agenda,
    pideTransporte,
    pideGenerador,
    opts.soloLectura,
  );
  return {
    ofertas: pideTransporte ? ofertasSinMonto(negocio.ofertas, verMontos) : null,
    cargas: pideGenerador ? generador.cargas : null,
    agenda: agenda.agenda,
    falloTransporte: agenda.falloTransporte,
    falloGenerador: agenda.falloGenerador,
    facturado: pideTransporte ? ladoPlata('Facturado (transporte)') : null,
    gasto: pideGenerador ? ladoPlata('Gasto (cargas)') : null,
    plataTitulo: `Plata ${mesEnCurso(ahora)}`,
    avisos: avisosDe(negocio, generador, filtro),
    verMontos,
  };
}

function armarAgenda(
  retiros: Panel<RetiroNegocio[]>,
  cargas: Panel<AgendaItem[]>,
  pideTransporte: boolean,
  pideGenerador: boolean,
  soloLectura: boolean,
): { agenda: Panel<AgendaItem[]>; falloTransporte: boolean; falloGenerador: boolean } {
  const cargando =
    (pideTransporte && retiros.estado === 'cargando') ||
    (pideGenerador && cargas.estado === 'cargando');
  if (cargando) {
    return { agenda: { estado: 'cargando' }, falloTransporte: false, falloGenerador: false };
  }
  const falloTransporte = pideTransporte && retiros.estado === 'error';
  const falloGenerador = pideGenerador && cargas.estado === 'error';
  const filas: AgendaItem[] = [];
  if (pideTransporte && retiros.estado === 'listo') {
    filas.push(...retiros.valor.map((retiro) => filaTransporte(retiro, soloLectura)));
  }
  if (pideGenerador && cargas.estado === 'listo') {
    filas.push(...cargas.valor.map(filaCarga));
  }
  if (filas.length === 0) {
    return {
      agenda: falloTransporte || falloGenerador ? { estado: 'error' } : { estado: 'vacio' },
      falloTransporte,
      falloGenerador,
    };
  }
  filas.sort((a, b) => ordenVisible(a) - ordenVisible(b));
  return {
    agenda: { estado: 'listo', valor: filas.slice(0, AGENDA_TOPE) },
    falloTransporte,
    falloGenerador,
  };
}
