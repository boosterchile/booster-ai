import {
  AVL_ID_CAN,
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
 * de `io_data`); el DIN1 (AVL 1) solo entra si ese punto no trae 239.
 * El 250 acerca bordes, no abre un trayecto por su cuenta.
 * Los litros salen solo del AVL 84 (×0.1). El 89 (%) y el 83 (acumulado)
 * no se convierten a un nivel.
 * Golpe único: puntos por timestamp de dispositivo; ΔL ≤ −U en 5 min
 * con v ≤ 5 km/h; ignición on u off, las dos valen. No se marca en marcha.
 * U = max(U_empresa, 2 % del estanque) si hay capacidad; si no, U_empresa.
 * U_empresa null o fuera de [5, 20] → 8 L.
 * Hormiga: dentro del trayecto al que se atribuye el episodio (mismo criterio
 * que el golpe), ≥2 caídas de al menos 2 L, v ≤ 5, fines separados ≥10 min,
 * suma ≥ U_hormiga (default 10, config 8–30). Si el tramo es largo, la suma
 * mira una ventana móvil de 6 h por timestamp de dispositivo. No cruza
 * trayectos. Un solo episodio no es hormiga.
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

export const NOTA_SIN_BAJA = 'El nivel no bajó en este trayecto, así que no calculamos km/L.';
export const NOTA_NIVEL_SUBIO = 'El nivel subió en este trayecto. No calculamos km/L.';
export const NOTA_SIN_LECTURA =
  'No hay una lectura válida de litros en este trayecto. No calculamos km/L.';

export type SensorCombustible = 'ausente' | 'presente' | 'degradado';

export interface PuntoSegmentacion {
  vehiculoId: string;
  empresaId: string;
  patente: string;
  /** Litros de estanque si se conocen. `null` → U = U_empresa o 8 L. */
  capacidadEstanqueL: number | null;
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

function segmentarVehiculo(
  puntos: PuntoSegmentacion[],
  config: ConfigRoboCombustible,
): TrayectoTeltonika[] {
  if (puntos.length === 0) {
    return [];
  }
  const resueltos = resolverPuntos(puntos);
  const sensor = clasificarSensor(resueltos);
  const rachas = aplicarIo250(resueltos, rachasActivas(resueltos));
  const robos =
    sensor === 'presente'
      ? detectarRobos(resueltos, puntos[0]?.capacidadEstanqueL ?? null, config.uGolpeL)
      : [];
  const episodios = sensor === 'presente' ? detectarEpisodiosHormiga(resueltos) : [];

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
    const litros = litrosDelTrayecto(slice);
    const combustible = resolverCombustible(sensor, litros, distanciaDe(slice));
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
        distanciaKm: combustible.distanciaKm,
        litrosIniciales: combustible.litrosIniciales,
        litrosFinales: combustible.litrosFinales,
        kmPorLitro: combustible.kmPorLitro,
        notaCombustible: combustible.notaCombustible,
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
  if (Object.hasOwn(io, '239')) {
    return leerBinario(io, '239');
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
  const io81 = punto.io['81'];
  if (io81 === undefined) {
    return null;
  }
  const { telemetry } = interpretCanLvcan([
    { id: AVL_ID_CAN.CAN_VEHICLE_SPEED, value: io81, byteSize: 2 },
  ]);
  return telemetry.vehicleSpeedKmh ?? null;
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

function clasificarSensor(puntos: PuntoResuelto[]): SensorCombustible {
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

function litrosDe(io: Record<string, number>): number | null {
  const raw = io['84'];
  if (raw === undefined || !Number.isFinite(raw)) {
    return null;
  }
  const { telemetry } = interpretCanLvcan([
    { id: AVL_ID_CAN.CAN_FUEL_LEVEL_L, value: raw, byteSize: 2 },
  ]);
  return telemetry.fuelLevelL ?? null;
}

function litrosDelTrayecto(puntos: PuntoResuelto[]): { ini: number; fin: number } | null {
  let ini: number | null = null;
  let fin: number | null = null;
  for (const punto of puntos) {
    const litros = litrosDe(punto.io);
    if (litros == null) {
      continue;
    }
    if (ini == null) {
      ini = litros;
    }
    fin = litros;
  }
  if (ini == null || fin == null) {
    return null;
  }
  return { ini, fin };
}

function distanciaDe(puntos: PuntoResuelto[]): number {
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

function resolverCombustible(
  sensor: SensorCombustible,
  litros: { ini: number; fin: number } | null,
  distanciaKm: number,
): {
  distanciaKm: number;
  litrosIniciales: number | null;
  litrosFinales: number | null;
  kmPorLitro: number | null;
  notaCombustible: string | null;
} {
  const distancia = redondear(distanciaKm, 3);
  if (sensor === 'ausente') {
    return {
      distanciaKm: distancia,
      litrosIniciales: null,
      litrosFinales: null,
      kmPorLitro: null,
      notaCombustible: null,
    };
  }
  if (sensor === 'degradado' || !litros) {
    return {
      distanciaKm: distancia,
      litrosIniciales: null,
      litrosFinales: null,
      kmPorLitro: null,
      notaCombustible: NOTA_SIN_LECTURA,
    };
  }
  const delta = litros.ini - litros.fin;
  const litrosIniciales = redondear(litros.ini, 1);
  const litrosFinales = redondear(litros.fin, 1);
  if (delta > 0) {
    return {
      distanciaKm: distancia,
      litrosIniciales,
      litrosFinales,
      kmPorLitro: redondear(distanciaKm / Math.max(delta, EPSILON_L), 2),
      notaCombustible: null,
    };
  }
  return {
    distanciaKm: distancia,
    litrosIniciales,
    litrosFinales,
    kmPorLitro: null,
    notaCombustible: delta < 0 ? NOTA_NIVEL_SUBIO : NOTA_SIN_BAJA,
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
): VentanaRobo[] {
  const umbral = umbralRoboLitros(capacidadEstanqueL, uEmpresaL);
  const muestras: Array<{ tMs: number; litros: number }> = [];
  for (const punto of puntos) {
    const litros = litrosDe(punto.io);
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
function detectarEpisodiosHormiga(puntos: PuntoResuelto[]): Episodio[] {
  const muestras: Array<{ tMs: number; litros: number }> = [];
  for (const punto of puntos) {
    const litros = litrosDe(punto.io);
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
