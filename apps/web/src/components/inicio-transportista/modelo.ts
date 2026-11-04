import { formatPlateForDisplay, normalizePlate } from '@booster-ai/shared-schemas';
import { CONECTADO_HASTA_S, estadoDispositivo } from '../../lib/estado-dispositivo.js';

/** Zona del saludo y de las ventanas de retiro. Chile, sin depender del reloj del dispositivo. */
export const ZONA_INICIO = 'America/Santiago';

const PARTICULAS = new Set([
  'de',
  'del',
  'la',
  'las',
  'los',
  'y',
  'e',
  'da',
  'do',
  'das',
  'dos',
  'spa',
  'sa',
  'ltda',
  'eirl',
  'limitada',
]);

const ETIQUETA_DOCUMENTO: Record<string, string> = {
  revision_tecnica: 'Revisión técnica',
  permiso_circulacion: 'Permiso de circulación',
  soap: 'SOAP',
  padron: 'Padrón',
  seguro_carga: 'Seguro de carga',
  poliza_responsabilidad: 'Póliza responsabilidad civil',
  certificado_emisiones: 'Certificado de emisiones',
  licencia_conducir: 'Licencia de conducir',
  curso_b6: 'Curso B6',
  certificado_antecedentes: 'Certificado de antecedentes',
  examen_psicotecnico: 'Examen psicotécnico',
  hoja_vida_conductor: 'Hoja de vida del conductor',
  certificado_salud: 'Certificado de salud',
  otro: 'Otro',
};

export type EstadoCarga = 'cargando' | 'error' | 'listo';

export type Carga<T> = { estado: 'cargando' } | { estado: 'error' } | { estado: 'listo'; valor: T };

export interface OfertaInicio {
  expires_at: string;
}

export interface AsignacionInicio {
  status: string;
  sinConductor: boolean;
  pickupInicio: string | null;
  direccionOrigen: string;
}

export interface DocInicio {
  tipo: string;
  estado: 'vencido' | 'por_vencer' | 'vigente';
  referencia: string;
  clase: 'vehiculo' | 'conductor';
}

export interface CumplimientoInicio {
  vencidos: number;
  porVencer30d: number;
  documentos: DocInicio[];
}

export type EstadoVehiculoInicio = 'activo' | 'mantenimiento' | 'retirado';

export type FuentePosicionInicio = 'own' | 'mirror' | 'browser_gps';

export interface VehiculoFlotaInicio {
  plate: string;
  status?: EstadoVehiculoInicio;
  teltonikaImei: string | null;
  /** Canal de la posición. `browser_gps` es GPS del teléfono, no ausencia de GPS. */
  teltonikaSource?: FuentePosicionInicio | null;
  timestampDevice: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface DatosInicio {
  ofertas: Carga<OfertaInicio[]>;
  servicios: Carga<AsignacionInicio[]>;
  cumplimiento: Carga<CumplimientoInicio>;
  flota: Carga<VehiculoFlotaInicio[]>;
  vehiculos: Carga<number>;
  conductores: Carga<number>;
}

export interface ContextoInicio {
  nombreCompleto: string;
  legalName: string;
  esAdmin: boolean;
  ahora: Date;
}

export type FuenteReintento =
  | 'ofertas'
  | 'servicios'
  | 'cumplimiento'
  | 'flota'
  | 'vehiculos'
  | 'conductores';

export type HrefInicio =
  | '/app/ofertas'
  | '/app/servicios'
  | '/app/cumplimiento'
  | '/app/flota'
  | '/app/vehiculos'
  | '/app/conductores'
  | '/app/cobra-hoy/historial'
  | '/app/liquidaciones'
  | '/app/trayectos'
  | '/app/admin/dispositivos';

export type FilaAtencion =
  | { kind: 'skeleton'; id: string }
  | { kind: 'error'; id: string; bloque: string; fuente: FuenteReintento }
  | {
      kind: 'dato';
      id: 'ofertas' | 'sin-conductor' | 'documentos' | 'sin-senal';
      titulo: string;
      subtitulo: string | null;
      urgente: boolean;
      tono: 'warning' | 'danger' | 'neutral';
      href: HrefInicio;
      cta: 'ver' | 'asignar' | 'chevron';
    };

export type AtencionVista =
  | { tipo: 'calmo' }
  | { tipo: 'filas'; pendientes: number | null; filas: FilaAtencion[] };

export type KpiEnRuta =
  | { estado: 'cargando' }
  | { estado: 'error' }
  | { estado: 'listo'; enRuta: number; porRetirar: number };

export type KpiConectados =
  | { estado: 'cargando' }
  | { estado: 'error' }
  | {
      estado: 'listo';
      conectados: number;
      total: number;
      sinSenal: number;
      sinGps: number;
    };

export interface AccesoVista {
  id: string;
  label: string;
  to: HrefInicio;
  testId?: string;
  badge: number | null;
  badgeTono: 'warning' | 'danger' | null;
}

export interface PasoAlta {
  id: 'empresa' | 'vehiculo' | 'conductores' | 'documentos';
  numero: number;
  titulo: string;
  detalle: string;
  hecho: boolean;
  to: HrefInicio | null;
  cta: 'agregar' | 'invitar' | 'chevron' | null;
}

export type ModoInicio = 'resolviendo' | 'empresa-nueva' | 'operacion';

export interface InicioVista {
  modo: ModoInicio;
  saludo: string;
  fecha: string | null;
  iniciales: string;
  empresa: string;
  atencion: AtencionVista;
  enRuta: KpiEnRuta | null;
  conectados: KpiConectados | null;
  accesos: AccesoVista[];
  pasos: PasoAlta[] | null;
}

export function horaEnZona(ahora: Date, timeZone = ZONA_INICIO): number {
  const valor = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    hourCycle: 'h23',
  }).format(ahora);
  const hora = Number(valor);
  if (hora === 24 || Number.isNaN(hora)) {
    return 0;
  }
  return hora;
}

/** «Buenos días» 05–11, «Buenas tardes» 12–19, «Buenas noches» el resto. */
export function saludoPorHora(hora: number): string {
  if (hora >= 5 && hora < 12) {
    return 'Buenos días';
  }
  if (hora >= 12 && hora < 20) {
    return 'Buenas tardes';
  }
  return 'Buenas noches';
}

export function fechaLargaEs(ahora: Date, timeZone = ZONA_INICIO): string {
  const texto = new Intl.DateTimeFormat('es-CL', {
    timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(ahora);
  const sinComa = texto.replace(/,/g, '').replace(/\s+/g, ' ').trim();
  if (sinComa.length === 0) {
    return sinComa;
  }
  return sinComa.charAt(0).toUpperCase() + sinComa.slice(1);
}

export function nombreDePila(fullName: string): string {
  const primero = fullName
    .trim()
    .split(/\s+/)
    .filter((parte) => parte.length > 0)[0];
  return primero ?? '';
}

export function inicialesEmpresa(legalName: string): string {
  const palabras = legalName
    .split(/\s+/)
    .map((parte) => parte.replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g, ''))
    .filter((parte) => parte.length > 0 && !PARTICULAS.has(parte.toLowerCase()));
  const primera = palabras[0];
  if (!primera) {
    const letras = legalName.replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g, '');
    return letras.slice(0, 2).toUpperCase();
  }
  const segunda = palabras[1];
  if (!segunda) {
    return primera.slice(0, 2).toUpperCase();
  }
  return `${primera.charAt(0)}${segunda.charAt(0)}`.toUpperCase();
}

export function textoVencimientoOferta(expiresAt: string, ahoraMs: number): string | null {
  const ts = Date.parse(expiresAt);
  if (Number.isNaN(ts)) {
    return null;
  }
  const minutos = Math.round((ts - ahoraMs) / 60_000);
  if (minutos <= 0) {
    return 'La próxima está vencida';
  }
  if (minutos < 60) {
    return `La próxima vence en ${minutos} min`;
  }
  const horas = Math.round(minutos / 60);
  if (horas < 24) {
    return `La próxima vence en ${horas} h`;
  }
  const dias = Math.round(horas / 24);
  return `La próxima vence en ${dias} d`;
}

/**
 * La API de asignaciones no trae comuna: solo `address_raw` y región.
 * Si la dirección termina en un tramo sin dígitos («…, Quilicura»), se usa ese tramo.
 * Si no, el lugar se omite.
 */
export function comunaDesdeDireccion(direccion: string): string | null {
  const partes = direccion
    .split(',')
    .map((parte) => parte.trim())
    .filter((parte) => parte.length > 0);
  if (partes.length < 2) {
    return null;
  }
  const ultima = partes[partes.length - 1] ?? '';
  if (ultima.length < 3 || ultima.length > 40 || /\d/.test(ultima)) {
    return null;
  }
  return ultima;
}

function ymdEnZona(fecha: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA_INICIO,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(fecha);
}

function horaMinutoEnZona(fecha: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: ZONA_INICIO,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(fecha);
}

function ymdManana(ahora: Date): string {
  const hoy = ymdEnZona(ahora);
  const [anio, mes, dia] = hoy.split('-').map((parte) => Number(parte));
  const siguiente = new Date(Date.UTC(anio ?? 2026, (mes ?? 1) - 1, (dia ?? 1) + 1, 15, 0, 0));
  return ymdEnZona(siguiente);
}

export function textoProximoRetiro(
  pickupIso: string | null,
  direccion: string,
  ahora: Date,
): string | null {
  const comuna = comunaDesdeDireccion(direccion);
  const cuando = etiquetaCuando(pickupIso, ahora);
  if (cuando && comuna) {
    return `Retiro ${cuando} · ${comuna}`;
  }
  if (cuando) {
    return `Retiro ${cuando}`;
  }
  if (comuna) {
    return `Retiro · ${comuna}`;
  }
  return null;
}

function etiquetaCuando(pickupIso: string | null, ahora: Date): string | null {
  if (!pickupIso) {
    return null;
  }
  const instante = new Date(pickupIso);
  if (Number.isNaN(instante.getTime())) {
    return null;
  }
  const hora = horaMinutoEnZona(instante);
  const dia = ymdEnZona(instante);
  if (dia === ymdEnZona(ahora)) {
    return `hoy ${hora}`;
  }
  if (dia === ymdManana(ahora)) {
    return `mañana ${hora}`;
  }
  const corto = new Intl.DateTimeFormat('es-CL', {
    timeZone: ZONA_INICIO,
    day: 'numeric',
    month: 'short',
  })
    .format(instante)
    .replace(/\./g, '');
  return `${corto} ${hora}`;
}

function cuenta(n: number, uno: string, muchos: string): string {
  return `${n} ${n === 1 ? uno : muchos}`;
}

function patenteVisible(plate: string): string {
  return formatPlateForDisplay(normalizePlate(plate));
}

export interface ConteoFlota {
  total: number;
  conectados: number;
  sinSenal: number;
  sinGps: number;
  patentesSinSenal: string[];
}

function coordenadaValida(latitude: number | null, longitude: number | null): boolean {
  if (latitude == null || longitude == null) {
    return false;
  }
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return false;
  }
  return !(latitude === 0 && longitude === 0);
}

/**
 * IMEI que `estadoDispositivo` usa solo para distinguir «hay canal» de «no hay».
 * `browser_gps` y una posición con timestamp son canal: no se etiquetan sin GPS.
 */
function canalDe(vehiculo: VehiculoFlotaInicio): string | null {
  const imei = vehiculo.teltonikaImei?.trim() ?? '';
  if (imei.length > 0) {
    return imei;
  }
  if (
    vehiculo.teltonikaSource === 'own' ||
    vehiculo.teltonikaSource === 'mirror' ||
    vehiculo.teltonikaSource === 'browser_gps'
  ) {
    return vehiculo.teltonikaSource;
  }
  if (vehiculo.timestampDevice) {
    return 'posicion';
  }
  return null;
}

/**
 * Misma ventana de 30 min que la lista de vehículos (`CONECTADO_HASTA_S`).
 * «Sin GPS» es quien no tiene canal, o quien reporta fresco sin coordenada válida.
 * Un `retirado` no entra en ningún conteo. `browser_gps` se juzga por su posición.
 */
export function contarFlota(vehiculos: VehiculoFlotaInicio[], ahoraMs: number): ConteoFlota {
  const conteo: ConteoFlota = {
    total: 0,
    conectados: 0,
    sinSenal: 0,
    sinGps: 0,
    patentesSinSenal: [],
  };
  for (const vehiculo of vehiculos) {
    if (vehiculo.status === 'retirado') {
      continue;
    }
    conteo.total += 1;
    const estado = estadoDispositivo({
      teltonikaImei: canalDe(vehiculo),
      timestampDevice: vehiculo.timestampDevice,
      ahoraMs,
    });
    if (estado === 'sin_dispositivo') {
      conteo.sinGps += 1;
      continue;
    }
    const conGps = coordenadaValida(vehiculo.latitude, vehiculo.longitude);
    if (estado === 'conectado' && !conGps) {
      conteo.sinGps += 1;
      continue;
    }
    if (estado === 'sin_senal') {
      conteo.sinSenal += 1;
      conteo.patentesSinSenal.push(vehiculo.plate);
      continue;
    }
    conteo.conectados += 1;
  }
  return conteo;
}

export function pasosAlta(conteos: {
  vehiculos: number;
  conductores: number;
  documentos: number;
}): PasoAlta[] {
  return [
    {
      id: 'empresa',
      numero: 1,
      titulo: 'Crear tu empresa',
      detalle: 'Listo',
      hecho: true,
      to: null,
      cta: null,
    },
    {
      id: 'vehiculo',
      numero: 2,
      titulo: 'Agrega tu primer vehículo',
      detalle: 'Patente, tipo y capacidad',
      hecho: conteos.vehiculos > 0,
      to: '/app/vehiculos',
      cta: 'agregar',
    },
    {
      id: 'conductores',
      numero: 3,
      titulo: 'Suma a tus conductores',
      detalle: 'Entran con RUT y PIN',
      hecho: conteos.conductores > 0,
      to: '/app/conductores',
      cta: 'invitar',
    },
    {
      id: 'documentos',
      numero: 4,
      titulo: 'Sube los documentos',
      detalle: 'Revisión técnica, SOAP, licencias',
      hecho: conteos.documentos > 0,
      to: '/app/cumplimiento',
      cta: 'chevron',
    },
  ];
}

function modoDe(datos: DatosInicio): ModoInicio {
  if (datos.vehiculos.estado === 'cargando' || datos.conductores.estado === 'cargando') {
    return 'resolviendo';
  }
  if (datos.vehiculos.estado !== 'listo' || datos.conductores.estado !== 'listo') {
    return 'operacion';
  }
  if (datos.vehiculos.valor > 0 || datos.conductores.valor > 0) {
    return 'operacion';
  }
  if (datos.cumplimiento.estado === 'cargando') {
    return 'resolviendo';
  }
  if (datos.cumplimiento.estado !== 'listo') {
    return 'operacion';
  }
  if (datos.cumplimiento.valor.documentos.length > 0 || datos.cumplimiento.valor.vencidos > 0) {
    return 'operacion';
  }
  return 'empresa-nueva';
}

function proximaOferta(ofertas: OfertaInicio[]): OfertaInicio | null {
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
  return mejor;
}

function filaOfertas(carga: Carga<OfertaInicio[]>, ahoraMs: number): FilaAtencion | null {
  if (carga.estado === 'cargando') {
    return { kind: 'skeleton', id: 'ofertas' };
  }
  if (carga.estado === 'error') {
    return { kind: 'error', id: 'ofertas', bloque: 'Ofertas', fuente: 'ofertas' };
  }
  if (carga.valor.length === 0) {
    return null;
  }
  const proxima = proximaOferta(carga.valor);
  return {
    kind: 'dato',
    id: 'ofertas',
    titulo: cuenta(carga.valor.length, 'oferta por responder', 'ofertas por responder'),
    subtitulo: proxima ? textoVencimientoOferta(proxima.expires_at, ahoraMs) : null,
    urgente: true,
    tono: 'warning',
    href: '/app/ofertas',
    cta: 'ver',
  };
}

function proximaSinConductor(asignaciones: AsignacionInicio[]): AsignacionInicio | null {
  const sin = asignaciones.filter((item) => item.sinConductor);
  let mejor: AsignacionInicio | null = null;
  let mejorTs = Number.POSITIVE_INFINITY;
  for (const item of sin) {
    if (!item.pickupInicio) {
      continue;
    }
    const ts = Date.parse(item.pickupInicio);
    if (Number.isNaN(ts) || ts >= mejorTs) {
      continue;
    }
    mejor = item;
    mejorTs = ts;
  }
  if (mejor) {
    return mejor;
  }
  return sin[0] ?? null;
}

function filaServicios(carga: Carga<AsignacionInicio[]>, ahora: Date): FilaAtencion | null {
  if (carga.estado === 'cargando') {
    return { kind: 'skeleton', id: 'servicios' };
  }
  if (carga.estado === 'error') {
    return { kind: 'error', id: 'servicios', bloque: 'Servicios', fuente: 'servicios' };
  }
  const sin = carga.valor.filter((item) => item.sinConductor);
  if (sin.length === 0) {
    return null;
  }
  const proxima = proximaSinConductor(carga.valor);
  return {
    kind: 'dato',
    id: 'sin-conductor',
    titulo: cuenta(sin.length, 'servicio sin conductor', 'servicios sin conductor'),
    subtitulo: proxima
      ? textoProximoRetiro(proxima.pickupInicio, proxima.direccionOrigen, ahora)
      : null,
    urgente: false,
    tono: 'danger',
    href: '/app/servicios',
    cta: 'asignar',
  };
}

function etiquetaDocumento(tipo: string): string {
  return ETIQUETA_DOCUMENTO[tipo] ?? tipo;
}

function primerVencido(docs: DocInicio[]): string | null {
  const vehiculo = docs.find((doc) => doc.clase === 'vehiculo' && doc.estado === 'vencido');
  if (vehiculo) {
    return `${etiquetaDocumento(vehiculo.tipo)} ${patenteVisible(vehiculo.referencia)}`;
  }
  const conductor = docs.find((doc) => doc.clase === 'conductor' && doc.estado === 'vencido');
  if (conductor) {
    return `${etiquetaDocumento(conductor.tipo)} ${conductor.referencia}`;
  }
  return null;
}

function subtituloDocumentos(data: CumplimientoInicio): string | null {
  const partes: string[] = [];
  if (data.porVencer30d > 0) {
    partes.push(`+${data.porVencer30d} por vencer en 30 días`);
  }
  const primero = primerVencido(data.documentos);
  if (primero) {
    partes.push(primero);
  }
  if (partes.length === 0) {
    return null;
  }
  return partes.join(' · ');
}

function filaDocumentos(carga: Carga<CumplimientoInicio>): FilaAtencion | null {
  if (carga.estado === 'cargando') {
    return { kind: 'skeleton', id: 'cumplimiento' };
  }
  if (carga.estado === 'error') {
    return { kind: 'error', id: 'cumplimiento', bloque: 'Cumplimiento', fuente: 'cumplimiento' };
  }
  if (carga.valor.vencidos <= 0) {
    return null;
  }
  return {
    kind: 'dato',
    id: 'documentos',
    titulo: cuenta(carga.valor.vencidos, 'documento vencido', 'documentos vencidos'),
    subtitulo: subtituloDocumentos(carga.valor),
    urgente: false,
    tono: 'danger',
    href: '/app/cumplimiento',
    cta: 'chevron',
  };
}

function resumirPatentes(plates: string[]): string {
  const visibles = plates.slice(0, 3).map((plate) => patenteVisible(plate));
  const extra = plates.length - visibles.length;
  if (visibles.length === 0) {
    return '';
  }
  if (extra > 0) {
    return `${visibles.join(', ')} +${extra}`;
  }
  return visibles.join(', ');
}

function filaSenal(carga: Carga<VehiculoFlotaInicio[]>, ahoraMs: number): FilaAtencion | null {
  if (carga.estado === 'cargando') {
    return { kind: 'skeleton', id: 'flota' };
  }
  if (carga.estado === 'error') {
    return { kind: 'error', id: 'flota', bloque: 'Flota', fuente: 'flota' };
  }
  const conteo = contarFlota(carga.valor, ahoraMs);
  if (conteo.sinSenal === 0) {
    return null;
  }
  const minutos = Math.round(CONECTADO_HASTA_S / 60);
  const patentes = resumirPatentes(conteo.patentesSinSenal);
  const base = `Sin reportar +${minutos} min`;
  return {
    kind: 'dato',
    id: 'sin-senal',
    titulo: cuenta(conteo.sinSenal, 'vehículo sin señal', 'vehículos sin señal'),
    subtitulo: patentes.length > 0 ? `${base} · ${patentes}` : base,
    urgente: false,
    tono: 'neutral',
    href: '/app/flota',
    cta: 'chevron',
  };
}

function filaSiError(
  carga: Carga<unknown>,
  id: string,
  bloque: string,
  fuente: FuenteReintento,
): FilaAtencion | null {
  if (carga.estado !== 'error') {
    return null;
  }
  return { kind: 'error', id, bloque, fuente };
}

function buildAtencion(datos: DatosInicio, ahora: Date): AtencionVista {
  const filas = [
    filaOfertas(datos.ofertas, ahora.getTime()),
    filaServicios(datos.servicios, ahora),
    filaDocumentos(datos.cumplimiento),
    filaSenal(datos.flota, ahora.getTime()),
    filaSiError(datos.vehiculos, 'vehiculos', 'Vehículos', 'vehiculos'),
    filaSiError(datos.conductores, 'conductores', 'Conductores', 'conductores'),
  ].filter((fila): fila is FilaAtencion => fila != null);
  if (filas.length === 0) {
    return { tipo: 'calmo' };
  }
  const fuentes = [datos.ofertas, datos.servicios, datos.cumplimiento, datos.flota];
  const todasListas = fuentes.every((fuente) => fuente.estado === 'listo');
  return {
    tipo: 'filas',
    pendientes: todasListas ? sumaPendientes(datos, ahora.getTime()) : null,
    filas,
  };
}

function sumaPendientes(datos: DatosInicio, ahoraMs: number): number {
  const ofertas = datos.ofertas.estado === 'listo' ? datos.ofertas.valor.length : 0;
  const sinConductor =
    datos.servicios.estado === 'listo'
      ? datos.servicios.valor.filter((item) => item.sinConductor).length
      : 0;
  const vencidos = datos.cumplimiento.estado === 'listo' ? datos.cumplimiento.valor.vencidos : 0;
  const sinSenal =
    datos.flota.estado === 'listo' ? contarFlota(datos.flota.valor, ahoraMs).sinSenal : 0;
  return ofertas + sinConductor + vencidos + sinSenal;
}

function kpiEnRuta(carga: Carga<AsignacionInicio[]>): KpiEnRuta {
  if (carga.estado === 'cargando') {
    return { estado: 'cargando' };
  }
  if (carga.estado === 'error') {
    return { estado: 'error' };
  }
  let enRuta = 0;
  let porRetirar = 0;
  for (const item of carga.valor) {
    if (item.status === 'recogido') {
      enRuta += 1;
    } else if (item.status === 'asignado') {
      porRetirar += 1;
    }
  }
  return { estado: 'listo', enRuta, porRetirar };
}

function kpiConectados(carga: Carga<VehiculoFlotaInicio[]>, ahoraMs: number): KpiConectados {
  if (carga.estado === 'cargando') {
    return { estado: 'cargando' };
  }
  if (carga.estado === 'error') {
    return { estado: 'error' };
  }
  const conteo = contarFlota(carga.valor, ahoraMs);
  return {
    estado: 'listo',
    conectados: conteo.conectados,
    total: conteo.total,
    sinSenal: conteo.sinSenal,
    sinGps: conteo.sinGps,
  };
}

function acceso(parcial: {
  id: string;
  label: string;
  to: HrefInicio;
  testId: string;
  badge?: number | null;
  badgeTono?: 'warning' | 'danger' | null;
}): AccesoVista {
  return {
    id: parcial.id,
    label: parcial.label,
    to: parcial.to,
    testId: parcial.testId,
    badge: parcial.badge != null && parcial.badge > 0 ? parcial.badge : null,
    badgeTono: parcial.badge != null && parcial.badge > 0 ? (parcial.badgeTono ?? null) : null,
  };
}

function buildAccesos(datos: DatosInicio, esAdmin: boolean): AccesoVista[] {
  const ofertas = datos.ofertas.estado === 'listo' ? datos.ofertas.valor.length : null;
  const sinConductor =
    datos.servicios.estado === 'listo'
      ? datos.servicios.valor.filter((item) => item.sinConductor).length
      : null;
  const vencidos = datos.cumplimiento.estado === 'listo' ? datos.cumplimiento.valor.vencidos : null;
  const accesos: AccesoVista[] = [
    acceso({
      id: 'flota',
      label: 'Flota en vivo',
      to: '/app/flota',
      testId: 'dashboard-link-flota',
    }),
    acceso({
      id: 'ofertas',
      label: 'Ofertas',
      to: '/app/ofertas',
      testId: 'dashboard-link-ofertas',
      badge: ofertas,
      badgeTono: 'warning',
    }),
    acceso({
      id: 'servicios',
      label: 'Servicios',
      to: '/app/servicios',
      testId: 'dashboard-link-servicios',
      badge: sinConductor,
      badgeTono: 'danger',
    }),
    acceso({
      id: 'vehiculos',
      label: 'Vehículos',
      to: '/app/vehiculos',
      testId: 'dashboard-link-vehiculos',
    }),
    acceso({
      id: 'conductores',
      label: 'Conductores',
      to: '/app/conductores',
      testId: 'dashboard-link-conductores',
    }),
    acceso({
      id: 'cumplimiento',
      label: 'Cumplimiento',
      to: '/app/cumplimiento',
      testId: 'dashboard-link-cumplimiento',
      badge: vencidos,
      badgeTono: 'danger',
    }),
    acceso({
      id: 'cobra-hoy',
      label: 'Cobra hoy',
      to: '/app/cobra-hoy/historial',
      testId: 'dashboard-link-cobra-hoy',
    }),
    acceso({
      id: 'liquidaciones',
      label: 'Liquidaciones',
      to: '/app/liquidaciones',
      testId: 'dashboard-link-liquidaciones',
    }),
  ];
  if (esAdmin) {
    accesos.push(
      acceso({
        id: 'trayectos',
        label: 'Trayectos',
        to: '/app/trayectos',
        testId: 'dashboard-link-trayectos',
      }),
      acceso({
        id: 'dispositivos',
        label: 'Dispositivos',
        to: '/app/admin/dispositivos',
        testId: 'dashboard-link-dispositivos',
      }),
    );
  }
  return accesos;
}

function textoSaludo(empresaNueva: boolean, pila: string, ahora: Date): string {
  if (empresaNueva) {
    return pila.length > 0 ? `¡Bienvenido, ${pila}!` : '¡Bienvenido!';
  }
  const base = saludoPorHora(horaEnZona(ahora));
  return pila.length > 0 ? `${base}, ${pila}` : base;
}

export function buildInicioVista(datos: DatosInicio, ctx: ContextoInicio): InicioVista {
  const modo = modoDe(datos);
  const empresaNueva = modo === 'empresa-nueva';
  const enRuta = empresaNueva ? null : kpiEnRuta(datos.servicios);
  const conectados = empresaNueva ? null : kpiConectados(datos.flota, ctx.ahora.getTime());
  return {
    modo,
    saludo: textoSaludo(empresaNueva, nombreDePila(ctx.nombreCompleto), ctx.ahora),
    fecha: empresaNueva ? null : fechaLargaEs(ctx.ahora),
    iniciales: inicialesEmpresa(ctx.legalName),
    empresa: ctx.legalName,
    atencion: buildAtencion(datos, ctx.ahora),
    enRuta,
    conectados,
    accesos: buildAccesos(datos, ctx.esAdmin),
    pasos: empresaNueva ? pasosAlta({ vehiculos: 0, conductores: 0, documentos: 0 }) : null,
  };
}
