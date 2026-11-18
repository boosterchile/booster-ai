import { z } from 'zod';
import { isoCalendarDateSchema } from '../primitives/dates.js';

/**
 * Booster Fleet: configuración del servicio de gestión de flota para el
 * dueño del transportista. Las reglas de combustible, documentos y
 * mantenciones viven acá, puras, para que el API y la pantalla compartan
 * el mismo contrato.
 */
export const CONFIGURACION_BOOSTER_FLEET = {
  slug: 'booster-fleet',
  nombre: 'Booster Fleet',
  servicio: 'gestion_de_flota',
  audiencia: 'dueno_transportista',
  ventanaCombustibleDias: 7,
  diasPorVencerDocumento: 30,
  diasMantencionProxima: 15,
  umbralConsumoAltoVsMediana: 1.25,
  kmMinimosCompararConsumo: 50,
  paresMinimosCompararConsumo: 2,
} as const;

export const DOCUMENTOS_VEHICULO_OBLIGATORIOS = [
  'revision_tecnica',
  'permiso_circulacion',
  'soap',
] as const;

export const DOCUMENTOS_CONDUCTOR_OBLIGATORIOS = [
  'licencia_conducir',
  'examen_psicotecnico',
] as const;

const SENALES = [
  'posible_robo',
  'sin_telemetria',
  'sin_movimiento',
  'sin_sensor',
  'falta_capacidad',
  'dato_no_confiable',
  'consumo_alto',
  'en_orden',
] as const;

const ESTADOS_DOC = [
  'vencido',
  'faltante',
  'sin_fecha',
  'sin_archivo',
  'por_vencer',
  'vigente',
] as const;

const TIPOS_MANTENCION = ['preventiva', 'correctiva', 'inspeccion'] as const;

export const senalCombustibleSchema = z.enum(SENALES);
export const estadoDocumentoControlSchema = z.enum(ESTADOS_DOC);
export const tipoMantencionSchema = z.enum(TIPOS_MANTENCION);
export const estadoMantencionSchema = z.enum(['vencida', 'proxima', 'programada', 'realizada']);

export const programarMantencionSchema = z.object({
  vehiculo_id: z.string().uuid(),
  tipo: tipoMantencionSchema,
  titulo: z.string().trim().min(3, 'El título necesita al menos 3 caracteres').max(160),
  programada_para: isoCalendarDateSchema,
  kilometraje_objetivo: z.number().int().min(0).max(5_000_000).optional(),
  notas: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .transform((valor) => (valor && valor.length > 0 ? valor : undefined)),
});

export const realizarMantencionSchema = z.object({
  kilometraje_realizado: z.number().int().min(0).max(5_000_000).optional(),
});

const itemDocumentoSchema = z.object({
  tipo: z.string(),
  estado: estadoDocumentoControlSchema,
  fecha_vencimiento: z.string().nullable(),
  archivo: z.boolean(),
});

const mantencionSchema = z.object({
  id: z.string().uuid(),
  vehiculo_id: z.string().uuid(),
  patente: z.string(),
  tipo: tipoMantencionSchema,
  titulo: z.string(),
  programada_para: z.string(),
  kilometraje_objetivo: z.number().int().nullable(),
  estado: estadoMantencionSchema,
  realizada_en: z.string().nullable(),
  notas: z.string().nullable(),
});

/**
 * La desviación de combustible más reciente de un vehículo en la ventana.
 * Solo viene en los vehículos con señal `posible_robo`. `desde`, `hasta` y
 * `litros` son la ventana de la baja; `lat` y `lon`, dónde empezó. Cualquiera
 * puede venir en null si la telemetría no lo trae. `total` cuenta los
 * trayectos de la ventana con aviso.
 */
export const desviacionCombustibleSchema = z.object({
  trayecto_id: z.string(),
  inicio: z.string(),
  fin: z.string(),
  tipo: z.enum(['golpe', 'hormiga']),
  desde: z.string().nullable(),
  hasta: z.string().nullable(),
  litros: z.number().nullable(),
  lat: z.number().nullable(),
  lon: z.number().nullable(),
  total: z.number().int().min(1),
});

export const panelBoosterFleetSchema = z.object({
  configuracion: z.object({
    slug: z.literal(CONFIGURACION_BOOSTER_FLEET.slug),
    nombre: z.literal(CONFIGURACION_BOOSTER_FLEET.nombre),
    servicio: z.literal(CONFIGURACION_BOOSTER_FLEET.servicio),
    audiencia: z.literal(CONFIGURACION_BOOSTER_FLEET.audiencia),
    ventana_combustible_dias: z.literal(CONFIGURACION_BOOSTER_FLEET.ventanaCombustibleDias),
  }),
  combustible: z.object({
    desde: z.string(),
    hasta: z.string(),
    truncado: z.boolean(),
    /**
     * Con `truncado`, el instante del punto de telemetría más antiguo que se
     * leyó: las cifras son desde ahí. No viene si la ventana se leyó completa.
     */
    cobertura_desde: z.string().optional(),
    /** Instante en que se hizo la lectura de combustible que se muestra. */
    leido_en: z.string().optional(),
    /**
     * Falso si esa lectura tiene más de 10 minutos. Solo pasa cuando se
     * pidió con `?combustible=guardada`: la pantalla la muestra mientras
     * pide una al día.
     */
    al_dia: z.boolean().optional(),
    litros: z.number().nullable(),
    km: z.number().nullable(),
    litros_por_100_km: z.number().nullable(),
    con_alerta: z.number().int(),
    vehiculos: z.array(
      z.object({
        vehiculo_id: z.string().uuid(),
        patente: z.string(),
        senal: senalCombustibleSchema,
        litros: z.number().nullable(),
        km: z.number().nullable(),
        litros_por_100_km: z.number().nullable(),
        alertas: z.array(z.enum(['golpe', 'hormiga', 'falta_capacidad'])),
        desviacion: desviacionCombustibleSchema.optional(),
      }),
    ),
  }),
  documental: z.object({
    vehiculos_al_dia: z.number().int(),
    vehiculos_con_hallazgo: z.number().int(),
    conductores_al_dia: z.number().int(),
    conductores_con_hallazgo: z.number().int(),
    vehiculos: z.array(
      z.object({
        vehiculo_id: z.string().uuid(),
        patente: z.string(),
        al_dia: z.boolean(),
        estado: estadoDocumentoControlSchema,
        documentos: z.array(itemDocumentoSchema),
      }),
    ),
    conductores: z.array(
      z.object({
        conductor_id: z.string().uuid(),
        nombre: z.string(),
        rut: z.string(),
        al_dia: z.boolean(),
        estado: estadoDocumentoControlSchema,
        documentos: z.array(itemDocumentoSchema),
      }),
    ),
  }),
  mantenciones: z.object({
    vencidas: z.number().int(),
    proximas: z.number().int(),
    programadas: z.number().int(),
    truncadas: z.boolean(),
    en_taller: z.array(
      z.object({
        vehiculo_id: z.string().uuid(),
        patente: z.string(),
      }),
    ),
    items: z.array(mantencionSchema),
  }),
});

export type PanelBoosterFleet = z.infer<typeof panelBoosterFleetSchema>;
export type MantencionBoosterFleet = z.infer<typeof mantencionSchema>;
export type ProgramarMantencionInput = z.infer<typeof programarMantencionSchema>;
export type SenalCombustible = z.infer<typeof senalCombustibleSchema>;
export type DesviacionCombustible = z.infer<typeof desviacionCombustibleSchema>;
export type EstadoDocumentoControl = z.infer<typeof estadoDocumentoControlSchema>;
export type EstadoMantencion = z.infer<typeof estadoMantencionSchema>;

export interface VehiculoBoosterFleet {
  id: string;
  patente: string;
  estado: 'activo' | 'mantenimiento' | 'retirado';
  tieneTeltonika: boolean;
}

export interface TrayectoBoosterFleet {
  id: string;
  inicio: string;
  fin: string;
  eventoDesde: string | null;
  eventoHasta: string | null;
  eventoLitros: number | null;
  eventLat: number | null;
  eventLon: number | null;
  vehiculoId: string;
  litrosConsumidos: number | null;
  kmCubiertos: number | null;
  kmPorLitro: number | null;
  notaCombustible: string | null;
  posibleRoboCombustible: boolean;
  posibleRoboHormiga: boolean;
  ctaCapacidadEstanque: boolean;
  fuenteCombustible: 'nivel_litros' | 'consumo_can' | 'nivel_porcentaje' | null;
}

export interface DocumentoBoosterFleet {
  duenoId: string;
  tipo: string;
  fechaVencimiento: string | null;
}

export interface ConductorBoosterFleet {
  id: string;
  nombre: string;
  rut: string;
  licenciaVencimiento: string | null;
}

export interface MantencionEntrada {
  id: string;
  vehiculoId: string;
  patente: string;
  tipo: (typeof TIPOS_MANTENCION)[number];
  titulo: string;
  programadaPara: string;
  kilometrajeObjetivo: number | null;
  realizadaEn: string | null;
  canceladaEn: string | null;
  notas: string | null;
}

export interface EntradaPanelBoosterFleet {
  hoy: string;
  desde: string;
  hasta: string;
  truncado: boolean;
  mantencionesTruncadas: boolean;
  vehiculos: readonly VehiculoBoosterFleet[];
  trayectos: readonly TrayectoBoosterFleet[];
  /** Con `truncado`, desde cuándo son los puntos que se leyeron. */
  coberturaDesde?: string | null | undefined;
  /** Cuándo se hizo la lectura de combustible. */
  leidoEn?: string | undefined;
  /** Si esa lectura tiene menos de 10 minutos. */
  alDia?: boolean | undefined;
  documentosVehiculo: readonly DocumentoBoosterFleet[];
  conductores: readonly ConductorBoosterFleet[];
  documentosConductor: readonly DocumentoBoosterFleet[];
  mantenciones: readonly MantencionEntrada[];
}

const GRAVEDAD_SENAL: Record<SenalCombustible, number> = {
  posible_robo: 0,
  sin_telemetria: 1,
  sin_sensor: 2,
  falta_capacidad: 3,
  dato_no_confiable: 4,
  consumo_alto: 5,
  sin_movimiento: 6,
  en_orden: 7,
};

const GRAVEDAD_DOC: Record<EstadoDocumentoControl, number> = {
  vencido: 0,
  faltante: 1,
  sin_fecha: 2,
  sin_archivo: 3,
  por_vencer: 4,
  vigente: 5,
};

const GRAVEDAD_MANTENCION: Record<EstadoMantencion, number> = {
  vencida: 0,
  proxima: 1,
  programada: 2,
  realizada: 3,
};

const RANGO_VIGENCIA = {
  vencido: 0,
  sin_fecha: 1,
  por_vencer: 2,
  vigente: 3,
} as const;

type Vigencia = keyof typeof RANGO_VIGENCIA;

const MS_DIA = 86_400_000;

/** Día de calendario en la zona pedida. Una zona inválida cae a America/Santiago. */
export function fechaEnZona(ahora: Date, zona: string): string {
  const formato = (timeZone: string) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(ahora);
  try {
    return formato(zona);
  } catch (error) {
    if (!(error instanceof RangeError)) {
      throw error;
    }
    return formato('America/Santiago');
  }
}

export function diasHasta(fecha: string, hoy: string): number {
  const desde = Date.parse(`${hoy}T00:00:00Z`);
  const hasta = Date.parse(`${fecha}T00:00:00Z`);
  if (!Number.isFinite(desde) || !Number.isFinite(hasta)) {
    return Number.NaN;
  }
  return Math.round((hasta - desde) / MS_DIA);
}

function redondear1(valor: number): number {
  return Math.round(valor * 10) / 10;
}

function vigenciaDe(fecha: string | null, hoy: string): Vigencia {
  if (fecha == null) {
    return 'sin_fecha';
  }
  const dias = diasHasta(fecha, hoy);
  if (!Number.isFinite(dias)) {
    return 'sin_fecha';
  }
  if (dias < 0) {
    return 'vencido';
  }
  if (dias <= CONFIGURACION_BOOSTER_FLEET.diasPorVencerDocumento) {
    return 'por_vencer';
  }
  return 'vigente';
}

function peorDoc(a: EstadoDocumentoControl, b: EstadoDocumentoControl): EstadoDocumentoControl {
  return GRAVEDAD_DOC[a] <= GRAVEDAD_DOC[b] ? a : b;
}

interface AcumuladoCombustible {
  viajes: number;
  litrosMedidos: number;
  hayLitros: boolean;
  litrosConfiables: number;
  kmConfiables: number;
  golpe: boolean;
  hormiga: boolean;
  faltaCapacidad: boolean;
  hayFuente: boolean;
  notaNoConfiable: boolean;
  desviaciones: TrayectoBoosterFleet[];
}

function vacioAcumulado(): AcumuladoCombustible {
  return {
    viajes: 0,
    litrosMedidos: 0,
    hayLitros: false,
    litrosConfiables: 0,
    kmConfiables: 0,
    golpe: false,
    hormiga: false,
    faltaCapacidad: false,
    hayFuente: false,
    notaNoConfiable: false,
    desviaciones: [],
  };
}

/** Cuándo ocurrió: el fin de la baja si se conoce; si no, el fin del trayecto. */
function instanteDesviacion(trayecto: TrayectoBoosterFleet): string {
  return trayecto.eventoHasta ?? trayecto.fin;
}

function desviacionDe(
  desviaciones: readonly TrayectoBoosterFleet[],
): DesviacionCombustible | undefined {
  let reciente: TrayectoBoosterFleet | undefined;
  for (const trayecto of desviaciones) {
    if (!reciente || instanteDesviacion(trayecto) > instanteDesviacion(reciente)) {
      reciente = trayecto;
    }
  }
  if (!reciente) {
    return undefined;
  }
  return {
    trayecto_id: reciente.id,
    inicio: reciente.inicio,
    fin: reciente.fin,
    tipo: reciente.posibleRoboCombustible ? 'golpe' : 'hormiga',
    desde: reciente.eventoDesde,
    hasta: reciente.eventoHasta,
    litros: reciente.eventoLitros,
    lat: reciente.eventLat,
    lon: reciente.eventLon,
    total: desviaciones.length,
  };
}

function acumular(trayecto: TrayectoBoosterFleet, acumulado: AcumuladoCombustible): void {
  acumulado.viajes += 1;
  if (trayecto.litrosConsumidos != null && Number.isFinite(trayecto.litrosConsumidos)) {
    acumulado.litrosMedidos += trayecto.litrosConsumidos;
    acumulado.hayLitros = true;
  }
  const confiable =
    trayecto.kmPorLitro != null &&
    trayecto.kmCubiertos != null &&
    trayecto.kmCubiertos > 0 &&
    trayecto.litrosConsumidos != null &&
    trayecto.litrosConsumidos > 0;
  if (confiable && trayecto.kmCubiertos != null && trayecto.litrosConsumidos != null) {
    acumulado.kmConfiables += trayecto.kmCubiertos;
    acumulado.litrosConfiables += trayecto.litrosConsumidos;
  }
  if (trayecto.posibleRoboCombustible || trayecto.posibleRoboHormiga) {
    acumulado.desviaciones.push(trayecto);
  }
  acumulado.golpe = acumulado.golpe || trayecto.posibleRoboCombustible;
  acumulado.hormiga = acumulado.hormiga || trayecto.posibleRoboHormiga;
  acumulado.faltaCapacidad = acumulado.faltaCapacidad || trayecto.ctaCapacidadEstanque;
  acumulado.hayFuente = acumulado.hayFuente || trayecto.fuenteCombustible != null;
  const notaMala = trayecto.notaCombustible?.includes('dato no confiable') === true;
  acumulado.notaNoConfiable = acumulado.notaNoConfiable || notaMala;
}

function litrosPor100(litros: number, km: number): number | null {
  if (!(km > 0)) {
    return null;
  }
  return redondear1((100 * litros) / km);
}

function mediana(valores: readonly number[]): number {
  const orden = [...valores].sort((a, b) => a - b);
  const medio = Math.floor(orden.length / 2);
  if (orden.length % 2 === 1) {
    return orden[medio] ?? 0;
  }
  const izquierda = orden[medio - 1] ?? 0;
  const derecha = orden[medio] ?? 0;
  return (izquierda + derecha) / 2;
}

function senalDe(
  vehiculo: VehiculoBoosterFleet,
  acumulado: AcumuladoCombustible,
  consumoAlto: boolean,
): SenalCombustible {
  if (acumulado.golpe || acumulado.hormiga) {
    return 'posible_robo';
  }
  if (!vehiculo.tieneTeltonika) {
    return 'sin_telemetria';
  }
  if (acumulado.viajes === 0) {
    return 'sin_movimiento';
  }
  if (!acumulado.hayFuente) {
    return 'sin_sensor';
  }
  const hayConfiable = acumulado.kmConfiables > 0 && acumulado.litrosConfiables > 0;
  if (!hayConfiable && acumulado.faltaCapacidad) {
    return 'falta_capacidad';
  }
  if (!hayConfiable && acumulado.notaNoConfiable) {
    return 'dato_no_confiable';
  }
  if (consumoAlto) {
    return 'consumo_alto';
  }
  return 'en_orden';
}

function armarCombustible(entrada: EntradaPanelBoosterFleet): PanelBoosterFleet['combustible'] {
  const flota = entrada.vehiculos.filter((v) => v.estado !== 'retirado');
  const porVehiculo = new Map<string, AcumuladoCombustible>();
  for (const vehiculo of flota) {
    porVehiculo.set(vehiculo.id, vacioAcumulado());
  }
  let litrosFlota = 0;
  let hayLitrosFlota = false;
  let litrosConfiablesFlota = 0;
  let kmConfiablesFlota = 0;
  for (const trayecto of entrada.trayectos) {
    const acumulado = porVehiculo.get(trayecto.vehiculoId);
    if (!acumulado) {
      continue;
    }
    acumular(trayecto, acumulado);
  }
  for (const acumulado of porVehiculo.values()) {
    if (acumulado.hayLitros) {
      litrosFlota += acumulado.litrosMedidos;
      hayLitrosFlota = true;
    }
    litrosConfiablesFlota += acumulado.litrosConfiables;
    kmConfiablesFlota += acumulado.kmConfiables;
  }

  const comparables = flota.flatMap((vehiculo) => {
    const acumulado = porVehiculo.get(vehiculo.id);
    if (
      !acumulado ||
      acumulado.kmConfiables < CONFIGURACION_BOOSTER_FLEET.kmMinimosCompararConsumo
    ) {
      return [];
    }
    const ratio = litrosPor100(acumulado.litrosConfiables, acumulado.kmConfiables);
    if (ratio == null) {
      return [];
    }
    return [{ id: vehiculo.id, ratio }];
  });

  const vehiculos = flota
    .map((vehiculo) => {
      const acumulado = porVehiculo.get(vehiculo.id) ?? vacioAcumulado();
      const ratio = litrosPor100(acumulado.litrosConfiables, acumulado.kmConfiables);
      const pares = comparables.filter((par) => par.id !== vehiculo.id);
      const consumoAlto =
        ratio != null &&
        acumulado.kmConfiables >= CONFIGURACION_BOOSTER_FLEET.kmMinimosCompararConsumo &&
        pares.length >= CONFIGURACION_BOOSTER_FLEET.paresMinimosCompararConsumo &&
        ratio >
          mediana(pares.map((par) => par.ratio)) *
            CONFIGURACION_BOOSTER_FLEET.umbralConsumoAltoVsMediana;
      const alertas: Array<'golpe' | 'hormiga' | 'falta_capacidad'> = [];
      if (acumulado.golpe) {
        alertas.push('golpe');
      }
      if (acumulado.hormiga) {
        alertas.push('hormiga');
      }
      if (acumulado.faltaCapacidad) {
        alertas.push('falta_capacidad');
      }
      const desviacion = desviacionDe(acumulado.desviaciones);
      return {
        vehiculo_id: vehiculo.id,
        patente: vehiculo.patente,
        senal: senalDe(vehiculo, acumulado, consumoAlto),
        litros: acumulado.hayLitros ? redondear1(acumulado.litrosMedidos) : null,
        km: acumulado.kmConfiables > 0 ? redondear1(acumulado.kmConfiables) : null,
        litros_por_100_km: ratio,
        alertas,
        ...(desviacion ? { desviacion } : {}),
      };
    })
    .sort(
      (a, b) =>
        GRAVEDAD_SENAL[a.senal] - GRAVEDAD_SENAL[b.senal] ||
        a.patente.localeCompare(b.patente, 'es'),
    );

  return {
    desde: entrada.desde,
    hasta: entrada.hasta,
    truncado: entrada.truncado,
    ...(entrada.truncado && entrada.coberturaDesde
      ? { cobertura_desde: entrada.coberturaDesde }
      : {}),
    ...(entrada.leidoEn ? { leido_en: entrada.leidoEn } : {}),
    ...(entrada.alDia === undefined ? {} : { al_dia: entrada.alDia }),
    litros: hayLitrosFlota ? redondear1(litrosFlota) : null,
    km: kmConfiablesFlota > 0 ? redondear1(kmConfiablesFlota) : null,
    litros_por_100_km: litrosPor100(litrosConfiablesFlota, kmConfiablesFlota),
    con_alerta: vehiculos.filter((v) => v.senal !== 'en_orden').length,
    vehiculos,
  };
}

interface FilaDoc {
  fechaVencimiento: string | null;
}

function mejorVigencia(
  filas: readonly FilaDoc[],
  hoy: string,
): { estado: Vigencia; fecha: string | null } | null {
  if (filas.length === 0) {
    return null;
  }
  let elegido = filas[0];
  if (!elegido) {
    return null;
  }
  for (const fila of filas.slice(1)) {
    const actual = vigenciaDe(elegido.fechaVencimiento, hoy);
    const candidata = vigenciaDe(fila.fechaVencimiento, hoy);
    const mejorRango = RANGO_VIGENCIA[candidata] > RANGO_VIGENCIA[actual];
    const empateMasLejana =
      candidata === actual && (fila.fechaVencimiento ?? '') > (elegido.fechaVencimiento ?? '');
    if (mejorRango || empateMasLejana) {
      elegido = fila;
    }
  }
  return { estado: vigenciaDe(elegido.fechaVencimiento, hoy), fecha: elegido.fechaVencimiento };
}

function fechaMasCercana(a: string | null, b: string): string {
  if (a == null) {
    return b;
  }
  return a < b ? a : b;
}

function itemObligatorio(
  tipo: string,
  filas: readonly FilaDoc[],
  hoy: string,
  respaldo: string | null,
): PanelBoosterFleet['documental']['vehiculos'][number]['documentos'][number] {
  const mejor = mejorVigencia(filas, hoy);
  if (respaldo == null) {
    if (!mejor) {
      return { tipo, estado: 'faltante', fecha_vencimiento: null, archivo: false };
    }
    return {
      tipo,
      estado: mejor.estado,
      fecha_vencimiento: mejor.fecha,
      archivo: true,
    };
  }
  const vigenciaFicha = vigenciaDe(respaldo, hoy);
  if (!mejor) {
    return {
      tipo,
      estado: vigenciaFicha === 'vigente' ? 'sin_archivo' : vigenciaFicha,
      fecha_vencimiento: respaldo,
      archivo: false,
    };
  }
  return {
    tipo,
    estado: peorDoc(mejor.estado, vigenciaFicha),
    fecha_vencimiento: fechaMasCercana(mejor.fecha, respaldo),
    archivo: true,
  };
}

function documentosDeActivo(
  obligatorios: readonly string[],
  filas: readonly DocumentoBoosterFleet[],
  duenoId: string,
  hoy: string,
  respaldoLicencia: string | null,
): PanelBoosterFleet['documental']['vehiculos'][number]['documentos'] {
  const propios = filas.filter((fila) => fila.duenoId === duenoId);
  const obligados = new Set<string>(obligatorios);
  const items = obligatorios.map((tipo) =>
    itemObligatorio(
      tipo,
      propios.filter((fila) => fila.tipo === tipo),
      hoy,
      tipo === 'licencia_conducir' ? respaldoLicencia : null,
    ),
  );
  const extras = new Map<string, DocumentoBoosterFleet[]>();
  for (const fila of propios) {
    if (obligados.has(fila.tipo)) {
      continue;
    }
    const grupo = extras.get(fila.tipo) ?? [];
    grupo.push(fila);
    extras.set(fila.tipo, grupo);
  }
  for (const [tipo, grupo] of extras) {
    const mejor = mejorVigencia(grupo, hoy);
    if (!mejor || mejor.estado === 'vigente') {
      continue;
    }
    items.push({
      tipo,
      estado: mejor.estado,
      fecha_vencimiento: mejor.fecha,
      archivo: true,
    });
  }
  return items.sort(
    (a, b) => GRAVEDAD_DOC[a.estado] - GRAVEDAD_DOC[b.estado] || a.tipo.localeCompare(b.tipo, 'es'),
  );
}

function peorDe(items: readonly { estado: EstadoDocumentoControl }[]): EstadoDocumentoControl {
  let peor: EstadoDocumentoControl = 'vigente';
  for (const item of items) {
    peor = peorDoc(peor, item.estado);
  }
  return peor;
}

function armarDocumental(entrada: EntradaPanelBoosterFleet): PanelBoosterFleet['documental'] {
  const flota = entrada.vehiculos.filter((v) => v.estado !== 'retirado');
  const vehiculos = flota
    .map((vehiculo) => {
      const documentos = documentosDeActivo(
        DOCUMENTOS_VEHICULO_OBLIGATORIOS,
        entrada.documentosVehiculo,
        vehiculo.id,
        entrada.hoy,
        null,
      );
      const estado = peorDe(documentos);
      return {
        vehiculo_id: vehiculo.id,
        patente: vehiculo.patente,
        al_dia: documentos.every((doc) => doc.estado === 'vigente'),
        estado,
        documentos,
      };
    })
    .sort(
      (a, b) =>
        GRAVEDAD_DOC[a.estado] - GRAVEDAD_DOC[b.estado] || a.patente.localeCompare(b.patente, 'es'),
    );
  const conductores = [...entrada.conductores]
    .map((conductor) => {
      const documentos = documentosDeActivo(
        DOCUMENTOS_CONDUCTOR_OBLIGATORIOS,
        entrada.documentosConductor,
        conductor.id,
        entrada.hoy,
        conductor.licenciaVencimiento,
      );
      const estado = peorDe(documentos);
      return {
        conductor_id: conductor.id,
        nombre: conductor.nombre,
        rut: conductor.rut,
        al_dia: documentos.every((doc) => doc.estado === 'vigente'),
        estado,
        documentos,
      };
    })
    .sort(
      (a, b) =>
        GRAVEDAD_DOC[a.estado] - GRAVEDAD_DOC[b.estado] || a.nombre.localeCompare(b.nombre, 'es'),
    );
  return {
    vehiculos_al_dia: vehiculos.filter((v) => v.al_dia).length,
    vehiculos_con_hallazgo: vehiculos.filter((v) => !v.al_dia).length,
    conductores_al_dia: conductores.filter((c) => c.al_dia).length,
    conductores_con_hallazgo: conductores.filter((c) => !c.al_dia).length,
    vehiculos,
    conductores,
  };
}

/** null si está cancelada: el panel no la muestra. */
export function clasificarMantencion(
  mantencion: MantencionEntrada,
  hoy: string,
): MantencionBoosterFleet | null {
  if (mantencion.canceladaEn != null) {
    return null;
  }
  let estado: EstadoMantencion;
  if (mantencion.realizadaEn != null) {
    estado = 'realizada';
  } else {
    const dias = diasHasta(mantencion.programadaPara, hoy);
    if (!Number.isFinite(dias) || dias < 0) {
      estado = 'vencida';
    } else if (dias <= CONFIGURACION_BOOSTER_FLEET.diasMantencionProxima) {
      estado = 'proxima';
    } else {
      estado = 'programada';
    }
  }
  return {
    id: mantencion.id,
    vehiculo_id: mantencion.vehiculoId,
    patente: mantencion.patente,
    tipo: mantencion.tipo,
    titulo: mantencion.titulo,
    programada_para: mantencion.programadaPara,
    kilometraje_objetivo: mantencion.kilometrajeObjetivo,
    estado,
    realizada_en: mantencion.realizadaEn,
    notas: mantencion.notas,
  };
}

function armarMantenciones(entrada: EntradaPanelBoosterFleet): PanelBoosterFleet['mantenciones'] {
  const items = entrada.mantenciones
    .flatMap((mantencion) => {
      const clasificada = clasificarMantencion(mantencion, entrada.hoy);
      return clasificada ? [clasificada] : [];
    })
    .sort(
      (a, b) =>
        GRAVEDAD_MANTENCION[a.estado] - GRAVEDAD_MANTENCION[b.estado] ||
        a.programada_para.localeCompare(b.programada_para) ||
        a.patente.localeCompare(b.patente, 'es'),
    );
  return {
    vencidas: items.filter((item) => item.estado === 'vencida').length,
    proximas: items.filter((item) => item.estado === 'proxima').length,
    programadas: items.filter((item) => item.estado === 'programada').length,
    truncadas: entrada.mantencionesTruncadas,
    en_taller: entrada.vehiculos
      .filter((vehiculo) => vehiculo.estado === 'mantenimiento')
      .map((vehiculo) => ({ vehiculo_id: vehiculo.id, patente: vehiculo.patente }))
      .sort((a, b) => a.patente.localeCompare(b.patente, 'es')),
    items,
  };
}

export function componerPanelBoosterFleet(entrada: EntradaPanelBoosterFleet): PanelBoosterFleet {
  return {
    configuracion: {
      slug: CONFIGURACION_BOOSTER_FLEET.slug,
      nombre: CONFIGURACION_BOOSTER_FLEET.nombre,
      servicio: CONFIGURACION_BOOSTER_FLEET.servicio,
      audiencia: CONFIGURACION_BOOSTER_FLEET.audiencia,
      ventana_combustible_dias: CONFIGURACION_BOOSTER_FLEET.ventanaCombustibleDias,
    },
    combustible: armarCombustible(entrada),
    documental: armarDocumental(entrada),
    mantenciones: armarMantenciones(entrada),
  };
}
