import { formatPlateForDisplay, normalizePlate } from '@booster-ai/shared-schemas';
import {
  type AsignacionInicio,
  type Carga,
  type DatosInicio,
  type HrefInicio,
  type OfertaInicio,
  type VehiculoFlotaInicio,
  ZONA_INICIO,
  comunaDesdeDireccion,
  contarFlota,
  etiquetaDocumento,
  textoVencimientoOferta,
} from './modelo.js';

/**
 * Plata del Inicio. Apagado hasta que Felipe cierre la regla: el bloque
 * existe, pero no se monta y no inventa montos. No hay flag de backend
 * para esto; prenderlo es cambiar esta constante.
 */
export const INICIO_PLATA_ACTIVA = false;

const PROXIMOS_DESKTOP = 5;
const ESTADOS_RETIRO = new Set(['asignado', 'recogido']);

export type Panel<T> =
  | { estado: 'cargando' }
  | { estado: 'error' }
  | { estado: 'vacio' }
  | { estado: 'listo'; valor: T };

export interface OfertaNegocio {
  cantidad: number;
  ruta: string | null;
  precio: string | null;
  vence: string | null;
}

export interface RetiroNegocio {
  clave: string;
  dia: string;
  hora: string;
  ruta: string;
  patente: string | null;
  conductor: string | null;
  sinConductor: boolean;
  asignarId: string | null;
}

export interface AvisoNegocio {
  id: string;
  titulo: string;
  detalle: string | null;
  href: HrefInicio;
  tono: 'alerta' | 'calmo';
}

export interface MapaNegocio {
  vehiculos: Array<{ id: string; plate: string; latitude: number; longitude: number }>;
  conectados: number;
  total: number;
  sinSenal: number;
  sinGps: number;
}

export interface ErrorAuxiliar {
  fuente: 'vehiculos' | 'conductores';
  nombre: string;
}

export interface NegocioHoy {
  ofertas: Panel<OfertaNegocio>;
  retiros: Panel<RetiroNegocio[]>;
  senal: Panel<AvisoNegocio>;
  documentos: Panel<AvisoNegocio>;
  mapa: Panel<MapaNegocio>;
  auxiliares: ErrorAuxiliar[];
}

export function pesosClp(valor: number): string {
  return new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency: 'CLP',
    maximumFractionDigits: 0,
  }).format(valor);
}

export function textoVenceCorto(expiresAt: string, ahoraMs: number): string | null {
  const largo = textoVencimientoOferta(expiresAt, ahoraMs);
  if (largo == null) {
    return null;
  }
  if (largo === 'La próxima está vencida') {
    return 'vencida';
  }
  return largo.replace('La próxima vence', 'vence');
}

function lugar(direccion: string): string {
  const comuna = comunaDesdeDireccion(direccion);
  if (comuna) {
    return comuna;
  }
  return direccion.trim();
}

function rutaDe(origen: string, destino: string): string | null {
  const desde = lugar(origen);
  const hasta = lugar(destino);
  if (desde.length === 0 && hasta.length === 0) {
    return null;
  }
  if (hasta.length === 0) {
    return desde;
  }
  if (desde.length === 0) {
    return hasta;
  }
  return `${desde} → ${hasta}`;
}

function ymd(fecha: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA_INICIO,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(fecha);
}

function hora(fecha: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: ZONA_INICIO,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(fecha);
}

function diaSiguiente(ahora: Date): string {
  const hoy = ymd(ahora);
  const [anio, mes, dia] = hoy.split('-').map((parte) => Number(parte));
  const siguiente = new Date(Date.UTC(anio ?? 2026, (mes ?? 1) - 1, (dia ?? 1) + 1, 15, 0, 0));
  return ymd(siguiente);
}

function partesCuando(iso: string | null, ahora: Date): { dia: string; hora: string } {
  if (!iso) {
    return { dia: 'Sin hora', hora: '—' };
  }
  const instante = new Date(iso);
  if (Number.isNaN(instante.getTime())) {
    return { dia: 'Sin hora', hora: '—' };
  }
  const hhmm = hora(instante);
  const dia = ymd(instante);
  if (dia === ymd(ahora)) {
    return { dia: 'Hoy', hora: hhmm };
  }
  if (dia === diaSiguiente(ahora)) {
    return { dia: 'Mañana', hora: hhmm };
  }
  const corto = new Intl.DateTimeFormat('es-CL', {
    timeZone: ZONA_INICIO,
    weekday: 'short',
    day: 'numeric',
  })
    .format(instante)
    .replace(/\./g, '');
  const limpio = corto.charAt(0).toUpperCase() + corto.slice(1);
  return { dia: limpio, hora: hhmm };
}

function patenteVisible(plate: string | null | undefined): string | null {
  if (!plate || plate.trim().length === 0) {
    return null;
  }
  return formatPlateForDisplay(normalizePlate(plate));
}

function ofertaMasProxima(ofertas: OfertaInicio[]): OfertaInicio | null {
  let mejor: OfertaInicio | null = null;
  let mejorTs = Number.POSITIVE_INFINITY;
  for (const oferta of ofertas) {
    const ts = Date.parse(oferta.expires_at);
    if (Number.isNaN(ts) || ts >= mejorTs) {
      continue;
    }
    mejor = oferta;
    mejorTs = ts;
  }
  return mejor ?? ofertas[0] ?? null;
}

function panelOfertas(carga: Carga<OfertaInicio[]>, ahoraMs: number): Panel<OfertaNegocio> {
  if (carga.estado === 'cargando') {
    return { estado: 'cargando' };
  }
  if (carga.estado === 'error') {
    return { estado: 'error' };
  }
  if (carga.valor.length === 0) {
    return { estado: 'vacio' };
  }
  const proxima = ofertaMasProxima(carga.valor);
  const precio = proxima?.precioClp;
  return {
    estado: 'listo',
    valor: {
      cantidad: carga.valor.length,
      ruta: proxima ? rutaDe(proxima.origen ?? '', proxima.destino ?? '') : null,
      precio: precio != null && Number.isFinite(precio) ? pesosClp(precio) : null,
      vence: proxima ? textoVenceCorto(proxima.expires_at, ahoraMs) : null,
    },
  };
}

function ordenRetiro(item: AsignacionInicio): number {
  if (!item.pickupInicio) {
    return Number.POSITIVE_INFINITY;
  }
  const ts = Date.parse(item.pickupInicio);
  return Number.isNaN(ts) ? Number.POSITIVE_INFINITY : ts;
}

function panelRetiros(carga: Carga<AsignacionInicio[]>, ahora: Date): Panel<RetiroNegocio[]> {
  if (carga.estado === 'cargando') {
    return { estado: 'cargando' };
  }
  if (carga.estado === 'error') {
    return { estado: 'error' };
  }
  const proximos = carga.valor
    .filter((item) => ESTADOS_RETIRO.has(item.status))
    .slice()
    .sort((a, b) => ordenRetiro(a) - ordenRetiro(b))
    .slice(0, PROXIMOS_DESKTOP);
  if (proximos.length === 0) {
    return { estado: 'vacio' };
  }
  let asignarPuesto = false;
  const filas = proximos.map((item, indice) => {
    const cuando = partesCuando(item.pickupInicio, ahora);
    const sinConductor = item.sinConductor;
    const mostrar = sinConductor && !asignarPuesto;
    if (mostrar) {
      asignarPuesto = true;
    }
    return {
      clave: item.id ?? `retiro-${indice}`,
      dia: cuando.dia,
      hora: cuando.hora,
      ruta: rutaDe(item.direccionOrigen, item.direccionDestino ?? '') ?? 'Retiro',
      patente: patenteVisible(item.patente),
      conductor: sinConductor ? null : (item.conductor ?? 'Conductor'),
      sinConductor,
      asignarId: mostrar ? (item.id ?? null) : null,
    };
  });
  return { estado: 'listo', valor: filas };
}

function panelSenal(carga: Carga<VehiculoFlotaInicio[]>, ahoraMs: number): Panel<AvisoNegocio> {
  if (carga.estado === 'cargando') {
    return { estado: 'cargando' };
  }
  if (carga.estado === 'error') {
    return { estado: 'error' };
  }
  const conteo = contarFlota(carga.valor, ahoraMs);
  if (conteo.sinSenal === 0) {
    return {
      estado: 'listo',
      valor: {
        id: 'senal-ok',
        titulo: 'Flota al día',
        detalle: conteo.total > 0 ? `${conteo.conectados}/${conteo.total} conectados` : null,
        href: '/app/flota',
        tono: 'calmo',
      },
    };
  }
  const patentes = conteo.patentesSinSenal
    .slice(0, 3)
    .map((plate) => patenteVisible(plate))
    .filter((plate): plate is string => plate != null);
  return {
    estado: 'listo',
    valor: {
      id: 'sin-senal',
      titulo: conteo.sinSenal === 1 ? '1 sin señal' : `${conteo.sinSenal} sin señal`,
      detalle: patentes.length > 0 ? patentes.join(', ') : null,
      href: '/app/flota',
      tono: 'alerta',
    },
  };
}

function panelDocumentos(carga: DatosInicio['cumplimiento']): Panel<AvisoNegocio> {
  if (carga.estado === 'cargando') {
    return { estado: 'cargando' };
  }
  if (carga.estado === 'error') {
    return { estado: 'error' };
  }
  const { vencidos, porVencer30d, documentos } = carga.valor;
  if (vencidos <= 0 && porVencer30d <= 0) {
    return {
      estado: 'listo',
      valor: {
        id: 'docs-ok',
        titulo: 'Documentos al día',
        detalle: null,
        href: '/app/cumplimiento',
        tono: 'calmo',
      },
    };
  }
  const primero = documentos.find((doc) => doc.estado === 'vencido' || doc.estado === 'por_vencer');
  const partes: string[] = [];
  if (vencidos > 0 && porVencer30d > 0) {
    partes.push(`+${porVencer30d} por vencer en 30 días`);
  }
  if (primero) {
    const referencia =
      primero.clase === 'vehiculo' ? patenteVisible(primero.referencia) : primero.referencia;
    partes.push(`${etiquetaDocumento(primero.tipo)} ${referencia ?? ''}`.trim());
  }
  const detalle = partes.length > 0 ? partes.join(' · ') : null;
  const titulo =
    vencidos > 0
      ? vencidos === 1
        ? '1 documento vencido'
        : `${vencidos} documentos vencidos`
      : porVencer30d === 1
        ? '1 doc por vencer'
        : `${porVencer30d} docs por vencer`;
  return {
    estado: 'listo',
    valor: {
      id: 'documentos',
      titulo,
      detalle,
      href: '/app/cumplimiento',
      tono: 'alerta',
    },
  };
}

function panelMapa(carga: Carga<VehiculoFlotaInicio[]>, ahoraMs: number): Panel<MapaNegocio> {
  if (carga.estado === 'cargando') {
    return { estado: 'cargando' };
  }
  if (carga.estado === 'error') {
    return { estado: 'error' };
  }
  const conteo = contarFlota(carga.valor, ahoraMs);
  const vehiculos = carga.valor.flatMap((vehiculo) => {
    if (vehiculo.latitude == null || vehiculo.longitude == null) {
      return [];
    }
    if (!Number.isFinite(vehiculo.latitude) || !Number.isFinite(vehiculo.longitude)) {
      return [];
    }
    return [
      {
        id: vehiculo.id ?? vehiculo.plate,
        plate: vehiculo.plate,
        latitude: vehiculo.latitude,
        longitude: vehiculo.longitude,
      },
    ];
  });
  return {
    estado: 'listo',
    valor: {
      vehiculos,
      conectados: conteo.conectados,
      total: conteo.total,
      sinSenal: conteo.sinSenal,
      sinGps: conteo.sinGps,
    },
  };
}

export function buildNegocioHoy(datos: DatosInicio, ahora: Date): NegocioHoy {
  const auxiliares: ErrorAuxiliar[] = [];
  if (datos.vehiculos.estado === 'error') {
    auxiliares.push({ fuente: 'vehiculos', nombre: 'Vehículos' });
  }
  if (datos.conductores.estado === 'error') {
    auxiliares.push({ fuente: 'conductores', nombre: 'Conductores' });
  }
  return {
    ofertas: panelOfertas(datos.ofertas, ahora.getTime()),
    retiros: panelRetiros(datos.servicios, ahora),
    senal: panelSenal(datos.flota, ahora.getTime()),
    documentos: panelDocumentos(datos.cumplimiento),
    mapa: panelMapa(datos.flota, ahora.getTime()),
    auxiliares,
  };
}
