import {
  AVL_ID_CAN,
  type AvlIdCan,
  type CanLvcanTelemetry,
  type MinimalIoEntry,
  PORCENTAJE_ESTANQUE_ROBO,
  UMBRAL_ROBO_GOLPE_DEFAULT_L,
  UMBRAL_ROBO_GOLPE_MAX_L,
  UMBRAL_ROBO_GOLPE_MIN_L,
  UMBRAL_ROBO_HORMIGA_DEFAULT_L,
  UMBRAL_ROBO_HORMIGA_MAX_L,
  UMBRAL_ROBO_HORMIGA_MIN_L,
  interpretCanLvcan,
} from '@booster-ai/shared-schemas';
import { haversineKm } from '../services/calcular-cobertura-telemetria.js';
import { esCoordenadaGpsValida } from '../services/coordenada-gps.js';

/**
 * Segmenta trayectos de flota a partir de pings Teltonika ya leídos.
 * Pura: sin I/O. La ignición primaria es el AVL 239 (presente en el censo
 * de `io_data`). RPM CAN (85) > 0 también cuenta como encendido: hay camiones
 * con el 239 siempre en 0 porque el cable de ignición no está conectado.
 * El DIN1 (AVL 1) solo entra si ese punto no trae 239 ni RPM > 0.
 * El 250 acerca bordes, no abre un trayecto por su cuenta.
 * Fuente de combustible por trayecto, si el punto no trae provisioning
 * (`fuenteCombustibleCan` undefined): nivel en litros (84, ×0.1); si no hay,
 * litros consumidos por el Δ del contador 83 (×0.1); si no, nivel en % (89).
 * Con provisioning, solo entra el IO configurado. `sin_sensor` o null no
 * inventan litros. El 84 provisionado se lee como porcentaje (JLKT54:
 * raw = 20 × %) y los litros son porcentaje/100 × capacidad. Sin capacidad
 * no hay litros. El 89 no se convierte a litros y el 83 no es un nivel.
 * Los litros y el km/L
 * se calculan sobre el tramo entre la primera y la última lectura, solo si
 * ese tramo cubre ≥ 90 % de la distancia del trayecto y suma ≥ 5 L y ≥ 10 km.
 * El aviso de robo solo existe con el 84: un robo no pasa por el contador 83.
 * Golpe único: puntos por timestamp de dispositivo; ΔL ≤ −U en 5 min
 * con v ≤ 5 km/h; ignición on u off, las dos valen. No se marca en marcha.
 * U = max(U_empresa, 2 % del estanque) si hay capacidad; si no, U_empresa.
 * U_empresa null o fuera de [5, 20] → 8 L.
 * Hormiga: dentro del trayecto al que se atribuye el episodio (mismo criterio
 * que el golpe), ≥2 caídas de al menos 2 L, v ≤ 5, fines separados ≥10 min,
 * suma ≥ U_hormiga (default 10, config 8–30). Si el tramo es largo, la suma
 * mira una ventana móvil de 6 h por timestamp de dispositivo. No cruza
 * trayectos. Un solo episodio no es hormiga.
 * Credibilidad: no se emite el badge ni el pin si el trayecto atribuido
 * mide menos de 1 km, o si el nivel al inicio de la caída está bajo.
 * Con capacidad conocida, bajo el 14 % de esa capacidad. Sin capacidad, si
 * la ventana trae AVL 89, bajo 14 %. Si no hay capacidad ni 89, bajo 28 L
 * (14 % del estanque de 200 L que JLKT54 deriva: el raw del 84 vale 20 ×
 * el raw del 89). U y U_hormiga no cambian.
 * `tMs` es la hora del AVL, no la de recepción GPRS.
 * Pin: `eventLat`/`eventLon` salen del primer punto con fix válido dentro de
 * la ventana de la caída del golpe, en orden de `tMs`. Si no hay golpe y sí
 * hormiga, el pin es el del primer episodio que califica y tiene fix. Sin fix
 * usable quedan en null: no se copia la traza del trayecto.
 */

export const UMBRAL_ROBO_BASE_L = UMBRAL_ROBO_GOLPE_DEFAULT_L;
export const PORCENTAJE_ESTANQUE = PORCENTAJE_ESTANQUE_ROBO;
export const UMBRAL_EPISODIO_HORMIGA_L = 2;
export const SEPARACION_EPISODIO_MS = 10 * 60 * 1000;
export const VENTANA_HORMIGA_MS = 6 * 60 * 60 * 1000;
export const VENTANA_ROBO_MS = 5 * 60 * 1000;
export const VELOCIDAD_ROBO_MAX_KMH = 5;
export const UMBRAL_MOVIMIENTO_KMH = 5;
export const GAP_CORTE_MS = 15 * 60 * 1000;
export const VENTANA_IO250_MS = 2 * 60 * 1000;
export const EPSILON_L = 1e-6;
/** Fracción mínima de la distancia del trayecto que tiene que cubrir la lectura. */
export const COBERTURA_MINIMA = 0.9;
/**
 * Muestra mínima para un km/L: el 83 viene en pasos de 0,5 L y el 84 oscila
 * con el oleaje. Con menos litros o menos km el número no es confiable.
 */
export const LITROS_MINIMOS_KM_POR_LITRO = 5;
export const KM_MINIMOS_KM_POR_LITRO = 10;
/**
 * Por debajo de esto el trayecto es una maniobra o una cola. No se emite
 * el aviso de golpe ni el de hormiga, ni el pin.
 */
export const DISTANCIA_MINIMA_AVISO_ROBO_KM = 1;
/**
 * Estanque casi vacío: el 84 oscila (censo JLKT54, AVL 89 bajo 14 %).
 * Con capacidad conocida se compara el nivel al inicio de la caída contra
 * este porcentaje. Sin capacidad, si la ventana trae AVL 89, se usa ese %.
 */
export const NIVEL_PCT_MINIMO_AVISO_ROBO = 14;
/**
 * Sin capacidad y sin AVL 89. 28 L es el 14 % del estanque de 200 L que el
 * único equipo con AVL 84 del censo (JLKT54) deriva en el firmware
 * (el raw del 84 vale 20 × el raw del 89).
 */
export const LITROS_MINIMOS_NIVEL_AVISO_ROBO = 28;

export const NOTA_SIN_BAJA = 'El nivel no bajó en este trayecto, así que no calculamos km/L.';
export const NOTA_NIVEL_SUBIO = 'El nivel subió en este trayecto. No calculamos km/L.';
export const NOTA_SIN_LECTURA =
  'No hay una lectura válida de litros en este trayecto. No calculamos km/L.';
export const NOTA_COBERTURA_PARCIAL =
  'El camión no informó combustible durante todo el trayecto. No calculamos km/L.';
export const NOTA_FALTA_CAPACIDAD = 'Falta la capacidad del estanque.';
export const NOTA_IO84_INUSABLE =
  'El IO 84 no trae un porcentaje de estanque usable. No calculamos litros.';
export const NOTA_IO83_INUSABLE = 'El IO 83 no trae un consumo usable. No calculamos litros.';
export const NOTA_IO89_INUSABLE = 'El IO 89 no trae un porcentaje usable. No calculamos litros.';

/**
 * JLKT54: el firmware escribe AVL 84 como `raw = 20 × porcentaje` (asume
 * estanque de 200 L; `raw × 0.1` coincide con ese 200). Porcentaje válido
 * solo en 0–100. Data Ops puede afinar el mapeo; no se autodetecta.
 */
export const AVL84_RAW_POR_PORCIENTO = 20;

export type SensorCombustible = 'ausente' | 'presente' | 'degradado';
/** De dónde salen los datos de combustible de un trayecto. */
export type FuenteCombustible = 'nivel_litros' | 'consumo_can' | 'nivel_porcentaje';
/** Mejor fuente que informó un vehículo en la ventana. */
export type CombustibleVehiculo = FuenteCombustible | 'sin_sensor';
/** IO CAN provisionado en el vehículo. `sin_sensor` no usa 84/83/89. */
export type FuenteCombustibleCan = '84' | '83' | '89' | 'sin_sensor';

export interface ResumenCombustibleVehiculo {
  vehiculoId: string;
  patente: string;
  combustible: CombustibleVehiculo;
}

export interface PuntoSegmentacion {
  vehiculoId: string;
  empresaId: string;
  patente: string;
  /** Litros de estanque si se conocen. `null` → U = U_empresa o 8 L. */
  capacidadEstanqueL: number | null;
  /**
   * Provisioning. `undefined` conserva el camino legado (84 > 83 > 89) para
   * callers que todavía no leen la columna. `null` equivale a `sin_sensor`.
   */
  fuenteCombustibleCan?: FuenteCombustibleCan | null | undefined;
  tMs: number;
  lat: number | null;
  lng: number | null;
  /** `velocidad_kmh` de la columna. `null` si no hay fix de velocidad. */
  speedKmh: number | null;
  /** IO numéricos ya filtrados. Clave = AVL ID en string, como `io_data`. */
  io: Record<string, number>;
}

export interface TrayectoTeltonika {
  id: string;
  vehiculoId: string;
  empresaId: string;
  patente: string;
  inicio: string;
  fin: string;
  distanciaKm: number;
  litrosIniciales: number | null;
  litrosFinales: number | null;
  kmPorLitro: number | null;
  /** `null` = el trayecto no trae ninguna lectura de combustible usable. */
  fuenteCombustible: FuenteCombustible | null;
  /** ΔL del 84 o Δ del contador 83 en el tramo leído. Null sin baja, sin cobertura o bajo 5 L / 10 km. */
  litrosConsumidos: number | null;
  /** AVL 89 (%) al inicio y al final del trayecto, si viene. */
  nivelPctInicial: number | null;
  nivelPctFinal: number | null;
  notaCombustible: string | null;
  posibleRoboCombustible: boolean;
  /** Varias caídas chicas en el mismo trayecto. Distinto del golpe único. */
  posibleRoboHormiga: boolean;
  /**
   * Fix del inicio de la ventana de caída (primer punto con lat/lon válida
   * ordenado por timestamp de dispositivo). Null sin badge o sin fix usable.
   */
  eventLat: number | null;
  eventLon: number | null;
  sensorCombustible: SensorCombustible;
  ctaSensor: boolean;
  /** Hay porcentaje usable del 84 y falta la capacidad para pasarlo a litros. */
  ctaCapacidadEstanque: boolean;
}

interface PuntoResuelto extends PuntoSegmentacion {
  ignicion: boolean | null;
  velocidad: number | null;
  activo: boolean;
}

interface Racha {
  startIdx: number;
  endIdx: number;
}

/** Umbrales de la empresa. `null` = default de dominio. */
export interface ConfigRoboCombustible {
  uGolpeL: number | null;
  uHormigaL: number | null;
}

export const CONFIG_ROBO_DEFAULT: ConfigRoboCombustible = {
  uGolpeL: null,
  uHormigaL: null,
};

export function umbralRoboLitros(
  capacidadEstanqueL: number | null,
  uEmpresaL: number | null = null,
): number {
  const base = litrosEnRango(
    uEmpresaL,
    UMBRAL_ROBO_GOLPE_MIN_L,
    UMBRAL_ROBO_GOLPE_MAX_L,
    UMBRAL_ROBO_BASE_L,
  );
  if (
    capacidadEstanqueL == null ||
    !Number.isFinite(capacidadEstanqueL) ||
    capacidadEstanqueL <= 0
  ) {
    return base;
  }
  return Math.max(base, PORCENTAJE_ESTANQUE * capacidadEstanqueL);
}

export function umbralHormigaLitros(uEmpresaL: number | null): number {
  return litrosEnRango(
    uEmpresaL,
    UMBRAL_ROBO_HORMIGA_MIN_L,
    UMBRAL_ROBO_HORMIGA_MAX_L,
    UMBRAL_ROBO_HORMIGA_DEFAULT_L,
  );
}

function litrosEnRango(valor: number | null, min: number, max: number, fallback: number): number {
  if (valor == null || !Number.isFinite(valor) || valor < min || valor > max) {
    return fallback;
  }
  return valor;
}

export function segmentarTrayectosTeltonika(
  puntos: readonly PuntoSegmentacion[],
  config: ConfigRoboCombustible = CONFIG_ROBO_DEFAULT,
): TrayectoTeltonika[] {
  const porVehiculo = new Map<string, PuntoSegmentacion[]>();
  for (const punto of puntos) {
    const lista = porVehiculo.get(punto.vehiculoId);
    if (lista) {
      lista.push(punto);
    } else {
      porVehiculo.set(punto.vehiculoId, [punto]);
    }
  }

  const trayectos: TrayectoTeltonika[] = [];
  for (const delVehiculo of porVehiculo.values()) {
    delVehiculo.sort((a, b) => a.tMs - b.tMs);
    trayectos.push(...segmentarVehiculo(delVehiculo, config));
  }

  trayectos.sort((a, b) => {
    const fin = Date.parse(b.fin) - Date.parse(a.fin);
    if (fin !== 0) {
      return fin;
    }
    const inicio = Date.parse(b.inicio) - Date.parse(a.inicio);
    if (inicio !== 0) {
      return inicio;
    }
    if (a.vehiculoId < b.vehiculoId) {
      return -1;
    }
    if (a.vehiculoId > b.vehiculoId) {
      return 1;
    }
    return 0;
  });
  return trayectos;
}

const RANGO_COMBUSTIBLE: Record<CombustibleVehiculo, number> = {
  sin_sensor: 0,
  nivel_porcentaje: 1,
  consumo_can: 2,
  nivel_litros: 3,
};

/**
 * Mejor fuente de combustible que informó cada vehículo en la ventana
 * (84 > 83 > 89 > ninguna). Un IO fuera de rango no cuenta. Orden por patente.
 */
export function resumirCombustibleVehiculos(
  puntos: readonly PuntoSegmentacion[],
): ResumenCombustibleVehiculo[] {
  const porVehiculo = new Map<string, PuntoSegmentacion[]>();
  for (const punto of puntos) {
    const lista = porVehiculo.get(punto.vehiculoId);
    if (lista) {
      lista.push(punto);
    } else {
      porVehiculo.set(punto.vehiculoId, [punto]);
    }
  }
  const resumen: ResumenCombustibleVehiculo[] = [];
  for (const delVehiculo of porVehiculo.values()) {
    const primero = delVehiculo[0];
    if (!primero) {
      continue;
    }
    resumen.push({
      vehiculoId: primero.vehiculoId,
      patente: primero.patente,
      combustible: combustibleDelVehiculo(delVehiculo),
    });
  }
  return resumen.sort((a, b) => a.patente.localeCompare(b.patente, 'es'));
}

/** `undefined` = camino legado. `null` y `sin_sensor` no inventan litros. */
export function resolverFuenteProvisionada(
  fuente: FuenteCombustibleCan | null | undefined,
): FuenteCombustibleCan | 'auto' {
  if (fuente === undefined) {
    return 'auto';
  }
  if (fuente == null || fuente === 'sin_sensor') {
    return 'sin_sensor';
  }
  return fuente;
}

/**
 * Porcentaje 0–100 escondido en el AVL 84 de JLKT54 (`raw / 20`).
 * Fuera de rango → null: no se inventan litros.
 */
export function porcentajeDesdeAvl84(raw: number): number | null {
  if (!Number.isFinite(raw) || raw < 0) {
    return null;
  }
  const pct = raw / AVL84_RAW_POR_PORCIENTO;
  if (pct > 100) {
    return null;
  }
  return pct;
}

function combustibleDelVehiculo(puntos: readonly PuntoSegmentacion[]): CombustibleVehiculo {
  const fuente = resolverFuenteProvisionada(puntos[0]?.fuenteCombustibleCan);
  if (fuente === 'sin_sensor') {
    return 'sin_sensor';
  }
  if (fuente === 'auto') {
    let mejor: CombustibleVehiculo = 'sin_sensor';
    for (const punto of puntos) {
      const delPunto = combustibleDelPunto(punto.io);
      if (RANGO_COMBUSTIBLE[delPunto] > RANGO_COMBUSTIBLE[mejor]) {
        mejor = delPunto;
      }
    }
    return mejor;
  }
  if (fuente === '83') {
    return 'consumo_can';
  }
  if (fuente === '89') {
    const hayPct = puntos.some((punto) => nivelPctDe(punto.io) != null);
    if (hayPct && capacidadConocida(puntos[0]?.capacidadEstanqueL ?? null)) {
      return 'nivel_litros';
    }
    return 'nivel_porcentaje';
  }
  const hayPct = puntos.some((punto) => porcentajeDeIo84(punto.io) != null);
  if (hayPct && !capacidadConocida(puntos[0]?.capacidadEstanqueL ?? null)) {
    return 'nivel_porcentaje';
  }
  return 'nivel_litros';
}

interface ContextoCombustible {
  fuente: FuenteCombustibleCan | 'auto';
  capacidadEstanqueL: number | null;
}

function contextoDe(puntos: readonly PuntoSegmentacion[]): ContextoCombustible {
  return {
    fuente: resolverFuenteProvisionada(puntos[0]?.fuenteCombustibleCan),
    capacidadEstanqueL: puntos[0]?.capacidadEstanqueL ?? null,
  };
}

function combustibleDelPunto(io: Record<string, number>): CombustibleVehiculo {
  if (litrosDe(io) != null) {
    return 'nivel_litros';
  }
  if (consumoAcumuladoDe(io) != null) {
    return 'consumo_can';
  }
  if (nivelPctDe(io) != null) {
    return 'nivel_porcentaje';
  }
  return 'sin_sensor';
}

function segmentarVehiculo(
  puntos: PuntoSegmentacion[],
  config: ConfigRoboCombustible,
): TrayectoTeltonika[] {
  if (puntos.length === 0) {
    return [];
  }
  const resueltos = resolverPuntos(puntos);
  const ctx = contextoDe(puntos);
  const sensor = clasificarSensor(resueltos, ctx);
  const leerLitros = lectorLitrosNivel(ctx);
  const rachas = aplicarIo250(resueltos, rachasActivas(resueltos));
  const robos =
    sensor === 'presente'
      ? detectarRobos(resueltos, ctx.capacidadEstanqueL, config.uGolpeL, leerLitros)
      : [];
  const episodios =
    sensor === 'presente'
      ? detectarEpisodiosHormiga(resueltos, ctx.capacidadEstanqueL, leerLitros)
      : [];

  const crudos: Array<{
    inicioMs: number;
    finMs: number;
    trayecto: Omit<
      TrayectoTeltonika,
      'posibleRoboCombustible' | 'posibleRoboHormiga' | 'eventLat' | 'eventLon'
    >;
  }> = [];

  for (const racha of rachas) {
    const slice = resueltos.slice(racha.startIdx, racha.endIdx + 1);
    if (slice.length < 2) {
      continue;
    }
    const primero = slice[0];
    const ultimo = slice[slice.length - 1];
    if (!primero || !ultimo) {
      continue;
    }
    crudos.push({
      inicioMs: primero.tMs,
      finMs: ultimo.tMs,
      trayecto: {
        id: `${primero.vehiculoId}:${new Date(primero.tMs).toISOString()}`,
        vehiculoId: primero.vehiculoId,
        empresaId: primero.empresaId,
        patente: primero.patente,
        inicio: new Date(primero.tMs).toISOString(),
        fin: new Date(ultimo.tMs).toISOString(),
        ...combustibleDelTrayecto(sensor, slice, ctx),
        sensorCombustible: sensor,
        ctaSensor: sensor === 'ausente',
      },
    });
  }

  const marcados = new Set<number>();
  const geoEvento = new Map<number, { lat: number; lon: number }>();
  if (sensor === 'presente') {
    for (const robo of robos) {
      for (const indice of indicesDelRobo(crudos, robo)) {
        const crudo = crudos[indice];
        if (!crudo || !trayectoCreibleParaAviso(crudo.trayecto.distanciaKm)) {
          continue;
        }
        marcados.add(indice);
        if (!geoEvento.has(indice) && robo.eventLat != null && robo.eventLon != null) {
          geoEvento.set(indice, { lat: robo.eventLat, lon: robo.eventLon });
        }
      }
    }
  }

  const marcadosHormiga = new Set<number>();
  if (sensor === 'presente' && episodios.length > 0) {
    const umbralHormiga = umbralHormigaLitros(config.uHormigaL);
    const porTrayecto = new Map<number, Episodio[]>();
    for (const episodio of episodios) {
      for (const indice of indicesDelRobo(crudos, episodio)) {
        const crudo = crudos[indice];
        if (!crudo || !trayectoCreibleParaAviso(crudo.trayecto.distanciaKm)) {
          continue;
        }
        const lista = porTrayecto.get(indice);
        if (lista) {
          lista.push(episodio);
        } else {
          porTrayecto.set(indice, [episodio]);
        }
      }
    }
    for (const [indice, delTrayecto] of porTrayecto) {
      const califica = episodiosEnVentanaHormiga(delTrayecto, umbralHormiga);
      if (!califica) {
        continue;
      }
      marcadosHormiga.add(indice);
      if (!geoEvento.has(indice)) {
        const geo = primerGeoEpisodio(califica);
        if (geo) {
          geoEvento.set(indice, geo);
        }
      }
    }
  }

  return crudos.map((c, i) => {
    const geo = geoEvento.get(i);
    return {
      ...c.trayecto,
      posibleRoboCombustible: marcados.has(i),
      posibleRoboHormiga: marcadosHormiga.has(i),
      eventLat: geo?.lat ?? null,
      eventLon: geo?.lon ?? null,
    };
  });
}

function resolverPuntos(puntos: PuntoSegmentacion[]): PuntoResuelto[] {
  let ignicion: boolean | null = null;
  let movimiento: boolean | null = null;
  const resueltos: PuntoResuelto[] = [];
  for (const punto of puntos) {
    const ignicionPunto = leerIgnicion(punto.io);
    if (ignicionPunto !== null) {
      ignicion = ignicionPunto;
    }
    const movimientoPunto = leerBinario(punto.io, '240');
    if (movimientoPunto !== null) {
      movimiento = movimientoPunto;
    }
    const velocidad = resolverVelocidad(punto);
    const activo = ignicion === true && enMovimiento(movimiento, velocidad);
    resueltos.push({ ...punto, ignicion, velocidad, activo });
  }
  return resueltos;
}

function leerIgnicion(io: Record<string, number>): boolean | null {
  const ignicion239 = Object.hasOwn(io, '239') ? leerBinario(io, '239') : null;
  if (ignicion239 === true) {
    return true;
  }
  // El motor gira aunque el 239 diga 0: el cable de ignición no está leyendo.
  const rpm = rpmDe(io);
  if (rpm != null && rpm > 0) {
    return true;
  }
  if (Object.hasOwn(io, '239')) {
    return ignicion239;
  }
  if (Object.hasOwn(io, '1')) {
    return leerBinario(io, '1');
  }
  return null;
}

function leerBinario(io: Record<string, number>, clave: string): boolean | null {
  const valor = io[clave];
  if (valor === 0) {
    return false;
  }
  if (valor === 1) {
    return true;
  }
  return null;
}

function resolverVelocidad(punto: PuntoSegmentacion): number | null {
  if (punto.speedKmh != null && Number.isFinite(punto.speedKmh) && punto.speedKmh >= 0) {
    return punto.speedKmh;
  }
  const io24 = punto.io['24'];
  if (io24 != null && Number.isFinite(io24) && io24 >= 0 && io24 <= 350) {
    return io24;
  }
  return leerCan(punto.io, AVL_ID_CAN.CAN_VEHICLE_SPEED).vehicleSpeedKmh ?? null;
}

function enMovimiento(movimiento: boolean | null, velocidad: number | null): boolean {
  if (movimiento === true) {
    return true;
  }
  return velocidad != null && velocidad > UMBRAL_MOVIMIENTO_KMH;
}

function rachasActivas(puntos: PuntoResuelto[]): Racha[] {
  const rachas: Racha[] = [];
  let startIdx: number | null = null;
  let lastIdx: number | null = null;
  const cerrar = (): void => {
    if (startIdx !== null && lastIdx !== null) {
      rachas.push({ startIdx, endIdx: lastIdx });
    }
    startIdx = null;
    lastIdx = null;
  };
  for (let i = 0; i < puntos.length; i++) {
    const punto = puntos[i];
    if (!punto?.activo) {
      cerrar();
      continue;
    }
    if (startIdx === null || lastIdx === null) {
      startIdx = i;
      lastIdx = i;
      continue;
    }
    const previo = puntos[lastIdx];
    if (!previo || punto.tMs - previo.tMs > GAP_CORTE_MS) {
      cerrar();
      startIdx = i;
      lastIdx = i;
      continue;
    }
    lastIdx = i;
  }
  cerrar();
  return rachas;
}

function aplicarIo250(puntos: PuntoResuelto[], rachas: Racha[]): Racha[] {
  const originales = rachas.map((r) => ({
    startMs: puntos[r.startIdx]?.tMs ?? 0,
    endMs: puntos[r.endIdx]?.tMs ?? 0,
  }));
  for (let i = 0; i < puntos.length; i++) {
    const borde = leerBinario(puntos[i]?.io ?? {}, '250');
    if (borde === null) {
      continue;
    }
    const t = puntos[i]?.tMs ?? 0;
    for (let r = 0; r < rachas.length; r++) {
      const racha = rachas[r];
      const original = originales[r];
      if (!racha || !original) {
        continue;
      }
      if (borde === true) {
        const delta = original.startMs - t;
        if (delta > 0 && delta <= VENTANA_IO250_MS && !caeEnOtra(rachas, r, i)) {
          racha.startIdx = Math.min(racha.startIdx, i);
        }
      } else {
        const delta = t - original.endMs;
        if (delta > 0 && delta <= VENTANA_IO250_MS && !caeEnOtra(rachas, r, i)) {
          racha.endIdx = Math.max(racha.endIdx, i);
        }
      }
    }
  }
  return rachas.filter((r) => r.endIdx > r.startIdx);
}

function caeEnOtra(rachas: Racha[], propia: number, idx: number): boolean {
  return rachas.some((r, i) => i !== propia && idx >= r.startIdx && idx <= r.endIdx);
}

function clasificarSensor(puntos: PuntoResuelto[], ctx: ContextoCombustible): SensorCombustible {
  if (ctx.fuente === 'sin_sensor') {
    return 'ausente';
  }
  if (ctx.fuente === '84') {
    const hayPct = puntos.some((punto) => porcentajeDeIo84(punto.io) != null);
    if (hayPct && capacidadConocida(ctx.capacidadEstanqueL)) {
      return 'presente';
    }
    return 'degradado';
  }
  if (ctx.fuente === '83') {
    return puntos.some((punto) => consumoAcumuladoDe(punto.io) != null) ? 'presente' : 'degradado';
  }
  if (ctx.fuente === '89') {
    const hayPct = puntos.some((punto) => nivelPctDe(punto.io) != null);
    if (hayPct && capacidadConocida(ctx.capacidadEstanqueL)) {
      return 'presente';
    }
    return 'degradado';
  }
  let claveCombustible = false;
  for (const punto of puntos) {
    if (litrosDe(punto.io) != null) {
      return 'presente';
    }
    if (
      Object.hasOwn(punto.io, '84') ||
      Object.hasOwn(punto.io, '83') ||
      Object.hasOwn(punto.io, '89')
    ) {
      claveCombustible = true;
    }
  }
  return claveCombustible ? 'degradado' : 'ausente';
}

function lectorLitrosNivel(
  ctx: ContextoCombustible,
): (io: Record<string, number>) => number | null {
  if (ctx.fuente === 'auto') {
    return litrosDe;
  }
  if ((ctx.fuente === '84' || ctx.fuente === '89') && capacidadConocida(ctx.capacidadEstanqueL)) {
    const capacidad = ctx.capacidadEstanqueL;
    const leerPct = ctx.fuente === '84' ? porcentajeDeIo84 : nivelPctDe;
    return (io) => {
      const pct = leerPct(io);
      if (pct == null) {
        return null;
      }
      return (pct / 100) * capacidad;
    };
  }
  return () => null;
}

function porcentajeDeIo84(io: Record<string, number>): number | null {
  const raw = io['84'];
  if (raw === undefined) {
    return null;
  }
  return porcentajeDesdeAvl84(raw);
}

function litrosDe(io: Record<string, number>): number | null {
  return leerCan(io, AVL_ID_CAN.CAN_FUEL_LEVEL_L).fuelLevelL ?? null;
}

function consumoAcumuladoDe(io: Record<string, number>): number | null {
  return leerCan(io, AVL_ID_CAN.CAN_FUEL_CONSUMED_L).fuelConsumedL ?? null;
}

function nivelPctDe(io: Record<string, number>): number | null {
  return leerCan(io, AVL_ID_CAN.CAN_FUEL_LEVEL_PCT).fuelLevelPct ?? null;
}

function rpmDe(io: Record<string, number>): number | null {
  return leerCan(io, AVL_ID_CAN.CAN_ENGINE_RPM).engineRpm ?? null;
}

const BYTES_CAN: Record<AvlIdCan, NonNullable<MinimalIoEntry['byteSize']>> = {
  [AVL_ID_CAN.CAN_VEHICLE_SPEED]: 2,
  [AVL_ID_CAN.CAN_FUEL_CONSUMED_L]: 4,
  [AVL_ID_CAN.CAN_FUEL_LEVEL_L]: 2,
  [AVL_ID_CAN.CAN_ENGINE_RPM]: 2,
  [AVL_ID_CAN.CAN_TOTAL_MILEAGE]: 4,
  [AVL_ID_CAN.CAN_FUEL_LEVEL_PCT]: 1,
};

/** Un IO CAN validado por el catálogo `can-lvcan`. Ausente o fuera de rango → vacío. */
function leerCan(io: Record<string, number>, id: AvlIdCan): CanLvcanTelemetry {
  const raw = io[String(id)];
  if (raw === undefined || !Number.isFinite(raw)) {
    return {};
  }
  return interpretCanLvcan([{ id, value: raw, byteSize: BYTES_CAN[id] }]).telemetry;
}

interface Lectura {
  idx: number;
  valor: number;
}

function lecturasDe(
  puntos: readonly PuntoResuelto[],
  leer: (io: Record<string, number>) => number | null,
): Lectura[] {
  const lecturas: Lectura[] = [];
  for (let idx = 0; idx < puntos.length; idx++) {
    const valor = leer(puntos[idx]?.io ?? {});
    if (valor != null) {
      lecturas.push({ idx, valor });
    }
  }
  return lecturas;
}

function distanciaDe(puntos: readonly PuntoResuelto[]): number {
  let km = 0;
  let previo: { lat: number; lng: number } | null = null;
  for (const punto of puntos) {
    if (punto.lat == null || punto.lng == null || !esCoordenadaGpsValida(punto.lat, punto.lng)) {
      continue;
    }
    if (previo) {
      km += haversineKm(previo.lat, previo.lng, punto.lat, punto.lng);
    }
    previo = { lat: punto.lat, lng: punto.lng };
  }
  return km;
}

type CombustibleTrayecto = Pick<
  TrayectoTeltonika,
  | 'distanciaKm'
  | 'litrosIniciales'
  | 'litrosFinales'
  | 'kmPorLitro'
  | 'fuenteCombustible'
  | 'litrosConsumidos'
  | 'nivelPctInicial'
  | 'nivelPctFinal'
  | 'notaCombustible'
  | 'ctaCapacidadEstanque'
>;

function baseCombustible(
  distanciaKm: number,
  nivelPctInicial: number | null,
  nivelPctFinal: number | null,
): CombustibleTrayecto {
  return {
    distanciaKm: redondear(distanciaKm, 3),
    litrosIniciales: null,
    litrosFinales: null,
    kmPorLitro: null,
    fuenteCombustible: null,
    litrosConsumidos: null,
    nivelPctInicial,
    nivelPctFinal,
    notaCombustible: null,
    ctaCapacidadEstanque: false,
  };
}

function combustibleSegunFuente(
  fuente: '84' | '83' | '89',
  puntos: PuntoResuelto[],
  capacidadEstanqueL: number | null,
): CombustibleTrayecto {
  const distanciaKm = distanciaDe(puntos);
  const base = baseCombustible(distanciaKm, null, null);

  if (fuente === '89') {
    return combustibleDesdeNivelPct(
      puntos,
      lecturasDe(puntos, nivelPctDe),
      capacidadEstanqueL,
      NOTA_IO89_INUSABLE,
    );
  }

  if (fuente === '83') {
    const consumo = lecturasDe(puntos, consumoAcumuladoDe);
    const primerConsumo = consumo[0];
    const ultimoConsumo = consumo[consumo.length - 1];
    if (consumo.length < 2 || !primerConsumo || !ultimoConsumo) {
      return { ...base, notaCombustible: NOTA_IO83_INUSABLE };
    }
    const delta = ultimoConsumo.valor - primerConsumo.valor;
    if (!(delta > 0)) {
      return {
        ...base,
        fuenteCombustible: 'consumo_can',
        notaCombustible: delta < 0 ? NOTA_NIVEL_SUBIO : NOTA_SIN_BAJA,
      };
    }
    return {
      ...base,
      fuenteCombustible: 'consumo_can',
      ...consumoCubierto(puntos, primerConsumo.idx, ultimoConsumo.idx, delta, distanciaKm),
    };
  }

  return combustibleDesdeNivelPct(
    puntos,
    lecturasDe(puntos, porcentajeDeIo84),
    capacidadEstanqueL,
    NOTA_IO84_INUSABLE,
  );
}

/**
 * Porcentaje de estanque × capacidad. Sin N no hay litros.
 * El km/L sale del consumo cubierto que ya existe; el guardrail de economía
 * no se duplica acá.
 */
function combustibleDesdeNivelPct(
  puntos: PuntoResuelto[],
  porcentajes: Lectura[],
  capacidadEstanqueL: number | null,
  notaInusable: string,
): CombustibleTrayecto {
  const distanciaKm = distanciaDe(puntos);
  const base = baseCombustible(distanciaKm, null, null);
  const primerPct = porcentajes[0];
  const ultimoPct = porcentajes[porcentajes.length - 1];
  if (!primerPct || !ultimoPct) {
    return { ...base, notaCombustible: notaInusable };
  }
  if (!capacidadConocida(capacidadEstanqueL)) {
    return {
      ...base,
      fuenteCombustible: 'nivel_porcentaje',
      nivelPctInicial: redondear(primerPct.valor, 1),
      nivelPctFinal: redondear(ultimoPct.valor, 1),
      notaCombustible: NOTA_FALTA_CAPACIDAD,
      ctaCapacidadEstanque: true,
    };
  }
  const litrosIni = (primerPct.valor / 100) * capacidadEstanqueL;
  const litrosFin = (ultimoPct.valor / 100) * capacidadEstanqueL;
  const conNivel: CombustibleTrayecto = {
    ...base,
    fuenteCombustible: 'nivel_litros',
    litrosIniciales: redondear(litrosIni, 1),
    litrosFinales: redondear(litrosFin, 1),
    nivelPctInicial: redondear(primerPct.valor, 1),
    nivelPctFinal: redondear(ultimoPct.valor, 1),
  };
  const delta = litrosIni - litrosFin;
  if (!(delta > 0)) {
    return { ...conNivel, notaCombustible: delta < 0 ? NOTA_NIVEL_SUBIO : NOTA_SIN_BAJA };
  }
  return {
    ...conNivel,
    ...consumoCubierto(puntos, primerPct.idx, ultimoPct.idx, delta, distanciaKm),
  };
}

/**
 * Fuente por trayecto: 84 (nivel en L) > Δ del 83 (litros consumidos, ≥ 2
 * lecturas) > 89 (nivel en %). Sin ninguna, el trayecto queda sin dato.
 */
function combustibleDelTrayecto(
  sensor: SensorCombustible,
  puntos: PuntoResuelto[],
  ctx: ContextoCombustible,
): CombustibleTrayecto {
  if (ctx.fuente === 'sin_sensor') {
    return baseCombustible(distanciaDe(puntos), null, null);
  }
  if (ctx.fuente === '84' || ctx.fuente === '83' || ctx.fuente === '89') {
    return combustibleSegunFuente(ctx.fuente, puntos, ctx.capacidadEstanqueL);
  }
  const distanciaKm = distanciaDe(puntos);
  const porcentaje = lecturasDe(puntos, nivelPctDe);
  const base: CombustibleTrayecto = {
    ...baseCombustible(
      distanciaKm,
      porcentaje[0]?.valor ?? null,
      porcentaje[porcentaje.length - 1]?.valor ?? null,
    ),
  };

  const nivel = lecturasDe(puntos, litrosDe);
  const primerNivel = nivel[0];
  const ultimoNivel = nivel[nivel.length - 1];
  if (primerNivel && ultimoNivel) {
    const conNivel: CombustibleTrayecto = {
      ...base,
      fuenteCombustible: 'nivel_litros',
      litrosIniciales: redondear(primerNivel.valor, 1),
      litrosFinales: redondear(ultimoNivel.valor, 1),
    };
    const delta = primerNivel.valor - ultimoNivel.valor;
    if (!(delta > 0)) {
      return { ...conNivel, notaCombustible: delta < 0 ? NOTA_NIVEL_SUBIO : NOTA_SIN_BAJA };
    }
    return {
      ...conNivel,
      ...consumoCubierto(puntos, primerNivel.idx, ultimoNivel.idx, delta, distanciaKm),
    };
  }

  const consumo = lecturasDe(puntos, consumoAcumuladoDe);
  const primerConsumo = consumo[0];
  const ultimoConsumo = consumo[consumo.length - 1];
  if (consumo.length >= 2 && primerConsumo && ultimoConsumo) {
    return {
      ...base,
      fuenteCombustible: 'consumo_can',
      ...consumoCubierto(
        puntos,
        primerConsumo.idx,
        ultimoConsumo.idx,
        ultimoConsumo.valor - primerConsumo.valor,
        distanciaKm,
      ),
    };
  }

  if (porcentaje.length > 0) {
    return { ...base, fuenteCombustible: 'nivel_porcentaje' };
  }
  return { ...base, notaCombustible: sensor === 'ausente' ? null : NOTA_SIN_LECTURA };
}

/**
 * Litros y km/L sobre el tramo leído, con la distancia de ese mismo tramo.
 * Si cubre menos del 90 % del trayecto, el CAN se cortó en el camino: no se
 * calcula, para no inflar el km/L con kilómetros sin litros. Bajo 5 L o 10 km
 * tampoco, y sin nota por fila: la UI lo explica una vez.
 */
function consumoCubierto(
  puntos: PuntoResuelto[],
  desdeIdx: number,
  hastaIdx: number,
  litros: number,
  distanciaTotalKm: number,
): Pick<TrayectoTeltonika, 'litrosConsumidos' | 'kmPorLitro' | 'notaCombustible'> {
  const cubiertaKm = distanciaDe(puntos.slice(desdeIdx, hastaIdx + 1));
  if (cubiertaKm + 1e-9 < COBERTURA_MINIMA * distanciaTotalKm) {
    return { litrosConsumidos: null, kmPorLitro: null, notaCombustible: NOTA_COBERTURA_PARCIAL };
  }
  if (litros + 1e-9 < LITROS_MINIMOS_KM_POR_LITRO || cubiertaKm + 1e-9 < KM_MINIMOS_KM_POR_LITRO) {
    return { litrosConsumidos: null, kmPorLitro: null, notaCombustible: null };
  }
  return {
    litrosConsumidos: redondear(litros, 1),
    kmPorLitro: redondear(cubiertaKm / Math.max(litros, EPSILON_L), 2),
    notaCombustible: null,
  };
}

interface VentanaRobo {
  desdeMs: number;
  hastaMs: number;
  eventLat: number | null;
  eventLon: number | null;
}

function detectarRobos(
  puntos: PuntoResuelto[],
  capacidadEstanqueL: number | null,
  uEmpresaL: number | null,
  leerLitros: (io: Record<string, number>) => number | null,
): VentanaRobo[] {
  const umbral = umbralRoboLitros(capacidadEstanqueL, uEmpresaL);
  const muestras: Array<{ tMs: number; litros: number }> = [];
  for (const punto of puntos) {
    const litros = leerLitros(punto.io);
    if (litros != null) {
      muestras.push({ tMs: punto.tMs, litros });
    }
  }
  const robos: VentanaRobo[] = [];
  for (let j = 1; j < muestras.length; j++) {
    const fin = muestras[j];
    if (!fin) {
      continue;
    }
    for (let k = j - 1; k >= 0; k--) {
      const inicio = muestras[k];
      if (!inicio) {
        continue;
      }
      if (fin.tMs - inicio.tMs > VENTANA_ROBO_MS) {
        break;
      }
      const caida = inicio.litros - fin.litros;
      if (caida + 1e-9 < umbral) {
        continue;
      }
      if (!ventanaDetenida(puntos, inicio.tMs, fin.tMs)) {
        continue;
      }
      if (!nivelCreibleParaAviso(puntos, inicio.tMs, fin.tMs, inicio.litros, capacidadEstanqueL)) {
        continue;
      }
      const geo = geoAlInicioDeVentana(puntos, inicio.tMs, fin.tMs);
      robos.push({
        desdeMs: inicio.tMs,
        hastaMs: fin.tMs,
        eventLat: geo?.lat ?? null,
        eventLon: geo?.lon ?? null,
      });
      break;
    }
  }
  return robos;
}

interface Episodio extends VentanaRobo {
  deltaL: number;
}

/**
 * Caídas de al menos 2 L en ≤5 min con v ≤ 5. Los fines a menos de 10 min
 * son el mismo episodio (se queda el ΔL mayor). No es el golpe único.
 */
function detectarEpisodiosHormiga(
  puntos: PuntoResuelto[],
  capacidadEstanqueL: number | null,
  leerLitros: (io: Record<string, number>) => number | null,
): Episodio[] {
  const muestras: Array<{ tMs: number; litros: number }> = [];
  for (const punto of puntos) {
    const litros = leerLitros(punto.io);
    if (litros != null) {
      muestras.push({ tMs: punto.tMs, litros });
    }
  }
  const candidatos: Episodio[] = [];
  for (let j = 1; j < muestras.length; j++) {
    const fin = muestras[j];
    if (!fin) {
      continue;
    }
    let mejor: { desdeMs: number; deltaL: number } | null = null;
    for (let k = j - 1; k >= 0; k--) {
      const inicio = muestras[k];
      if (!inicio) {
        continue;
      }
      if (fin.tMs - inicio.tMs > VENTANA_ROBO_MS) {
        break;
      }
      const caida = inicio.litros - fin.litros;
      if (caida + 1e-9 < UMBRAL_EPISODIO_HORMIGA_L) {
        continue;
      }
      if (!ventanaDetenida(puntos, inicio.tMs, fin.tMs)) {
        continue;
      }
      if (!nivelCreibleParaAviso(puntos, inicio.tMs, fin.tMs, inicio.litros, capacidadEstanqueL)) {
        continue;
      }
      if (!mejor || caida > mejor.deltaL) {
        mejor = { desdeMs: inicio.tMs, deltaL: caida };
      }
    }
    if (!mejor) {
      continue;
    }
    const geo = geoAlInicioDeVentana(puntos, mejor.desdeMs, fin.tMs);
    candidatos.push({
      desdeMs: mejor.desdeMs,
      hastaMs: fin.tMs,
      deltaL: mejor.deltaL,
      eventLat: geo?.lat ?? null,
      eventLon: geo?.lon ?? null,
    });
  }
  return colapsarEpisodios(candidatos);
}

function colapsarEpisodios(candidatos: Episodio[]): Episodio[] {
  const ordenados = [...candidatos].sort((a, b) => a.hastaMs - b.hastaMs || b.deltaL - a.deltaL);
  const kept: Episodio[] = [];
  for (const candidato of ordenados) {
    const ultimo = kept[kept.length - 1];
    if (!ultimo || candidato.hastaMs - ultimo.hastaMs >= SEPARACION_EPISODIO_MS) {
      kept.push(candidato);
      continue;
    }
    if (candidato.deltaL > ultimo.deltaL) {
      const previo = kept[kept.length - 2];
      if (!previo || candidato.hastaMs - previo.hastaMs >= SEPARACION_EPISODIO_MS) {
        kept[kept.length - 1] = candidato;
      }
    }
  }
  return kept;
}

/**
 * Primera ventana de 6 h (por el fin del episodio) con ≥2 episodios cuya
 * suma de |ΔL| alcanza el umbral. Los episodios ya están acotados al trayecto.
 */
function episodiosEnVentanaHormiga(episodios: Episodio[], umbral: number): Episodio[] | null {
  const ordenados = [...episodios].sort((a, b) => a.hastaMs - b.hastaMs);
  for (let i = 0; i < ordenados.length; i++) {
    const fin = ordenados[i];
    if (!fin) {
      continue;
    }
    const enVentana: Episodio[] = [];
    for (let j = i; j >= 0; j--) {
      const episodio = ordenados[j];
      if (!episodio) {
        continue;
      }
      if (fin.hastaMs - episodio.hastaMs > VENTANA_HORMIGA_MS) {
        break;
      }
      enVentana.push(episodio);
    }
    enVentana.reverse();
    if (enVentana.length < 2) {
      continue;
    }
    const suma = enVentana.reduce((total, episodio) => total + episodio.deltaL, 0);
    if (suma + 1e-9 >= umbral) {
      return enVentana;
    }
  }
  return null;
}

function primerGeoEpisodio(episodios: readonly Episodio[]): { lat: number; lon: number } | null {
  for (const episodio of episodios) {
    if (episodio.eventLat != null && episodio.eventLon != null) {
      return { lat: episodio.eventLat, lon: episodio.eventLon };
    }
  }
  return null;
}

function capacidadConocida(capacidadEstanqueL: number | null): capacidadEstanqueL is number {
  return (
    capacidadEstanqueL != null && Number.isFinite(capacidadEstanqueL) && capacidadEstanqueL > 0
  );
}

/**
 * Nivel al inicio de la caída. Con capacidad, el 14 % de esa capacidad
 * (el AVL 89 no pisa ese cálculo). Sin capacidad, el primer 89 de la
 * ventana —en un ping ordenado, el inicio— si viene. Si no hay ninguno
 * de los dos, el piso absoluto en litros.
 */
function nivelCreibleParaAviso(
  puntos: readonly PuntoResuelto[],
  desdeMs: number,
  hastaMs: number,
  litrosInicio: number,
  capacidadEstanqueL: number | null,
): boolean {
  if (capacidadConocida(capacidadEstanqueL)) {
    const piso = (NIVEL_PCT_MINIMO_AVISO_ROBO / 100) * capacidadEstanqueL;
    return litrosInicio + 1e-9 >= piso;
  }
  const pct = pctEnVentana(puntos, desdeMs, hastaMs);
  if (pct != null) {
    return pct + 1e-9 >= NIVEL_PCT_MINIMO_AVISO_ROBO;
  }
  return litrosInicio + 1e-9 >= LITROS_MINIMOS_NIVEL_AVISO_ROBO;
}

/** Primer AVL 89 de la ventana, en orden de timestamp de dispositivo. */
function pctEnVentana(
  puntos: readonly PuntoResuelto[],
  desdeMs: number,
  hastaMs: number,
): number | null {
  for (const punto of puntos) {
    if (punto.tMs < desdeMs) {
      continue;
    }
    if (punto.tMs > hastaMs) {
      break;
    }
    const pct = nivelPctDe(punto.io);
    if (pct != null) {
      return pct;
    }
  }
  return null;
}

function trayectoCreibleParaAviso(distanciaKm: number): boolean {
  return distanciaKm + 1e-9 >= DISTANCIA_MINIMA_AVISO_ROBO_KM;
}

/** v ≤ 5 km/h en todo el intervalo. La ignición no entra en el gate. */
function ventanaDetenida(puntos: PuntoResuelto[], desdeMs: number, hastaMs: number): boolean {
  let vistos = 0;
  for (const punto of puntos) {
    if (punto.tMs < desdeMs || punto.tMs > hastaMs) {
      continue;
    }
    vistos += 1;
    if (punto.velocidad == null || punto.velocidad > VELOCIDAD_ROBO_MAX_KMH) {
      return false;
    }
  }
  return vistos > 0;
}

/**
 * Primer fix válido de la ventana, en orden de timestamp de dispositivo.
 * Se prefiere el inicio de la caída; si ese punto no tiene lat/lon usable
 * (null o null island), el siguiente dentro de la misma ventana. Fuera de
 * `[desdeMs, hastaMs]` no se mira.
 */
function geoAlInicioDeVentana(
  puntos: readonly PuntoResuelto[],
  desdeMs: number,
  hastaMs: number,
): { lat: number; lon: number } | null {
  for (const punto of puntos) {
    if (punto.tMs < desdeMs) {
      continue;
    }
    if (punto.tMs > hastaMs) {
      break;
    }
    if (punto.lat != null && punto.lng != null && esCoordenadaGpsValida(punto.lat, punto.lng)) {
      return { lat: punto.lat, lon: punto.lng };
    }
  }
  return null;
}

function indicesDelRobo(
  trayectos: Array<{ inicioMs: number; finMs: number }>,
  robo: VentanaRobo,
): number[] {
  const solapados: number[] = [];
  for (let i = 0; i < trayectos.length; i++) {
    const trayecto = trayectos[i];
    if (!trayecto) {
      continue;
    }
    if (trayecto.finMs >= robo.desdeMs && trayecto.inicioMs <= robo.hastaMs) {
      solapados.push(i);
    }
  }
  if (solapados.length > 0) {
    return solapados;
  }
  let mejor: number | null = null;
  for (let i = 0; i < trayectos.length; i++) {
    const trayecto = trayectos[i];
    if (!trayecto || trayecto.finMs > robo.desdeMs) {
      continue;
    }
    if (mejor == null || trayecto.finMs > (trayectos[mejor]?.finMs ?? Number.NEGATIVE_INFINITY)) {
      mejor = i;
    }
  }
  return mejor == null ? [] : [mejor];
}

function redondear(valor: number, decimales: number): number {
  const factor = 10 ** decimales;
  return Math.round((valor + Number.EPSILON) * factor) / factor;
}
