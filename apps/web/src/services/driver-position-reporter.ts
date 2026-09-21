/**
 * Reporter de posición del móvil del conductor — UN SOLO watcher por sesión
 * (Slot 3, GPS resiliente). Store de módulo consumido por
 * `useDriverPositionReporter` vía `useSyncExternalStore`.
 *
 * Qué hace además de `watchPosition`:
 *   - Throttle por tiempo y distancia con latido (`decidirReporte`).
 *   - Latido activo: si en `heartbeatMs` no llegó un fix con `timestamp`
 *     nuevo (camión detenido, `watchPosition` calla, o el browser repite el
 *     mismo `GeolocationPosition` cacheado), pide `getCurrentPosition` con
 *     `maximumAge: 0` y lo envía igual. Un callback repetido no reinicia el
 *     reloj: si lo hiciera, el latido no correría y el tracking se quedaría
 *     con el primer ping. Al volver la pestaña a `visible` pide un fix fresco.
 *   - Cola offline persistida (`ColaPosiciones`): todo lo que se decide enviar
 *     entra a la cola y se drena de inmediato; si falla, queda y se reintenta
 *     al volver `online`, al volver la pestaña a `visible`, cada `drainEveryMs`
 *     y en `flush()` (la tarjeta lo llama antes de confirmar la entrega).
 *   - Wake lock de pantalla mientras observa, si el navegador lo ofrece: con la
 *     pantalla apagada iOS suspende la PWA y no hay posiciones. Reportar con la
 *     app cerrada —o con Google Maps en primer plano, que suspende este
 *     documento— no es posible en un sitio web. Al volver a `visible` o en
 *     `pageshow` se rearma el watch: iOS no reanuda el `watchPosition` que
 *     quedó vivo en memoria, y `isWatching` impediría un `start()` nuevo.
 */
import {
  COLA_TOPE_DEFAULT,
  ColaPosiciones,
  type PuntoEnCola,
  THROTTLE_DEFAULT,
  decidirReporte,
} from './driver-position-queue.js';
import { type GeofenceEstado, geoPositionToBody, postDriverPosition } from './driver-position.js';

export interface GeofenceLectura {
  estado: GeofenceEstado;
  distanciaM: number | null;
  at: string;
}

export interface ReporterSnapshot {
  isWatching: boolean;
  assignmentId: string | null;
  lastPosition: { latitude: number; longitude: number; timestamp: string } | null;
  lastError: string | null;
  pointsSent: number;
  lastGeofence: GeofenceLectura | null;
  /** Puntos en cola esperando señal. */
  queued: number;
}

export const REPORTER_OPTS = {
  ...THROTTLE_DEFAULT,
  drainEveryMs: 20_000,
  queueCap: COLA_TOPE_DEFAULT,
  flushTimeoutMs: 8_000,
};

const INICIAL: ReporterSnapshot = {
  isWatching: false,
  assignmentId: null,
  lastPosition: null,
  lastError: null,
  pointsSent: 0,
  lastGeofence: null,
  queued: 0,
};

type WakeLockSentinel = { release(): Promise<void> };
type NavigatorConWakeLock = Navigator & {
  wakeLock?: { request(type: 'screen'): Promise<WakeLockSentinel> };
};

let snapshot: ReporterSnapshot = INICIAL;
const listeners = new Set<() => void>();
let watcherId: number | null = null;
let cola: ColaPosiciones | null = null;
let ultimoEnviado: PuntoEnCola | null = null;
let ultimoFixWallMs = 0;
/** Último `timestamp_device` observado. Un callback con el mismo valor no es un fix nuevo. */
let ultimoTimestampObservadoMs = 0;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let drainTimer: ReturnType<typeof setInterval> | null = null;
let drenando: Promise<{ enviados: number; restantes: number }> | null = null;
/** Llegó un punto mientras se drenaba: el ciclo en vuelo debe repetir. */
let volverADrenar = false;
let wakeLock: WakeLockSentinel | null = null;
let domListeners: { online: () => void; visibility: () => void; pageshow: () => void } | null =
  null;
/** Evita dos rearmes seguidos cuando `visibilitychange` y `pageshow` llegan juntos. */
let ultimoRearmeMs = 0;
const REARME_MIN_MS = 1_000;

function emit(patch: Partial<ReporterSnapshot>): void {
  snapshot = { ...snapshot, ...patch };
  for (const l of listeners) {
    l();
  }
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSnapshot(): ReporterSnapshot {
  return snapshot;
}

function geolocation(): Geolocation | null {
  return typeof navigator !== 'undefined' && navigator.geolocation ? navigator.geolocation : null;
}

export function start(assignmentId: string): void {
  if (watcherId != null && snapshot.assignmentId === assignmentId) {
    return; // idempotente: ya observa esta asignación
  }
  if (watcherId != null) {
    detenerObservacion(); // otra asignación: un solo watcher por sesión
  }
  const geo = geolocation();
  if (!geo) {
    emit({ assignmentId, lastError: 'Geolocation no disponible en este navegador.' });
    return;
  }
  cola = new ColaPosiciones(assignmentId, { tope: REPORTER_OPTS.queueCap });
  ultimoEnviado = null;
  ultimoFixWallMs = Date.now();
  ultimoTimestampObservadoMs = 0;
  emit({
    assignmentId,
    isWatching: true,
    lastError: null,
    lastGeofence: null,
    queued: cola.pendientes(),
  });
  watcherId = geo.watchPosition((pos) => onFix(pos, false), onErrorGeolocation, {
    enableHighAccuracy: true,
    timeout: 15_000,
    maximumAge: 5_000,
  });
  heartbeatTimer = setInterval(latido, REPORTER_OPTS.heartbeatMs);
  drainTimer = setInterval(() => void drenar(), REPORTER_OPTS.drainEveryMs);
  instalarListenersDom();
  void pedirWakeLock();
  void drenar(); // lo que quedó en cola de una sesión anterior
}

export function stop(): void {
  detenerObservacion();
  emit({ isWatching: false });
}

/** Drena la cola ahora. Acotado: si no alcanza, devuelve lo que quedó. */
export async function flush(
  timeoutMs: number = REPORTER_OPTS.flushTimeoutMs,
): Promise<{ enviados: number; restantes: number }> {
  const tope = new Promise<{ enviados: number; restantes: number }>((resolve) => {
    setTimeout(() => resolve({ enviados: 0, restantes: cola?.pendientes() ?? 0 }), timeoutMs);
  });
  return Promise.race([drenar(), tope]);
}

function detenerObservacion(): void {
  const geo = geolocation();
  if (watcherId != null && geo) {
    geo.clearWatch(watcherId);
  }
  watcherId = null;
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  if (drainTimer) {
    clearInterval(drainTimer);
    drainTimer = null;
  }
  void soltarWakeLock();
}

const PERMISSION_DENIED = 1;

/** Sin permiso no hay observación posible: se detiene y se explica, para que
 *  la tarjeta muestre «Reintentar» en vez de «Reportando» con 0 puntos.
 *  TIMEOUT / POSITION_UNAVAILABLE son transitorios: se sigue observando. */
function onErrorGeolocation(err: GeolocationPositionError): void {
  if (err.code === PERMISSION_DENIED) {
    detenerObservacion();
    emit({
      isWatching: false,
      lastError:
        'Permiso de ubicación denegado. Actívalo para app.boosterchile.com en los ajustes del teléfono y toca Reintentar.',
    });
    return;
  }
  emit({ lastError: `Geolocation error: ${err.message}` });
}

function onFix(pos: GeolocationPosition, esLatido: boolean): void {
  const body = geoPositionToBody(pos);
  const ts = Date.parse(body.timestamp_device);
  if (Number.isFinite(ts) && ts > ultimoTimestampObservadoMs) {
    ultimoTimestampObservadoMs = ts;
    ultimoFixWallMs = Date.now();
  }
  emit({
    lastPosition: {
      latitude: body.latitude,
      longitude: body.longitude,
      timestamp: body.timestamp_device,
    },
  });
  const decision = esLatido ? 'enviar' : decidirReporte(ultimoEnviado, body, REPORTER_OPTS);
  if (decision === 'omitir' || !cola) {
    return;
  }
  if (!cola.encolar(body)) {
    // Fix grosero (p. ej. accuracy de miles de km): no anclar el throttle
    // ni ensuciar la cola. El siguiente válido se trata como primer envío.
    return;
  }
  ultimoEnviado = body;
  emit({ queued: cola.pendientes() });
  void drenar();
}

/** Sin un timestamp nuevo en `heartbeatMs`: `watchPosition` calló, o solo
 *  repite un fix cacheado. `maximumAge: 0` pide una lectura nueva; si el
 *  browser igual devuelve la vieja, el reloj no se reinicia y se reintenta. */
function latido(): void {
  if (Date.now() - ultimoFixWallMs < REPORTER_OPTS.heartbeatMs) {
    return;
  }
  pedirFixFresco();
}

function pedirFixFresco(): void {
  const geo = geolocation();
  if (!geo || watcherId == null || typeof geo.getCurrentPosition !== 'function') {
    return;
  }
  geo.getCurrentPosition((pos) => onFix(pos, true), onErrorGeolocation, {
    enableHighAccuracy: true,
    timeout: 10_000,
    maximumAge: 0,
  });
}

/**
 * Tras una suspensión (Maps en primer plano, Safari en background) el id de
 * `watchPosition` sigue en memoria pero el callback no vuelve a disparar.
 * `clearWatch` + un watch nuevo con `maximumAge: 0` es lo que iOS acepta.
 */
function rearmarWatch(): void {
  const geo = geolocation();
  if (!geo || watcherId == null) {
    return;
  }
  const ahora = Date.now();
  if (ahora - ultimoRearmeMs < REARME_MIN_MS) {
    return;
  }
  ultimoRearmeMs = ahora;
  geo.clearWatch(watcherId);
  watcherId = geo.watchPosition((pos) => onFix(pos, false), onErrorGeolocation, {
    enableHighAccuracy: true,
    timeout: 15_000,
    maximumAge: 0,
  });
  pedirFixFresco();
}

async function drenar(): Promise<{ enviados: number; restantes: number }> {
  if (!cola || !snapshot.assignmentId) {
    return { enviados: 0, restantes: 0 };
  }
  if (drenando) {
    // Un drenaje en vuelo no ve lo que se encola después de su último `shift`:
    // se le pide que repita al terminar en vez de abrir un segundo ciclo.
    volverADrenar = true;
    return drenando;
  }
  const assignmentId = snapshot.assignmentId;
  const c = cola;
  drenando = (async () => {
    let total = { enviados: 0, restantes: 0 };
    do {
      volverADrenar = false;
      const r = await c.drenar(async (punto) => {
        const res = await postDriverPosition(assignmentId, punto);
        emit({ pointsSent: snapshot.pointsSent + 1, lastError: null });
        if (res.geofence) {
          emit({
            lastGeofence: {
              estado: res.geofence.estado,
              distanciaM: res.geofence.distancia_m,
              at: punto.timestamp_device,
            },
          });
        }
        return res;
      });
      total = { enviados: total.enviados + r.enviados, restantes: r.restantes };
      emit({
        queued: c.pendientes(),
        ...(r.detenido === 'fallo'
          ? { lastError: `Sin señal: ${r.restantes} posición(es) en cola, se reintenta solo.` }
          : {}),
      });
      if (r.detenido) {
        break; // fallo o asignación cerrada: no insistir en el mismo ciclo
      }
    } while (volverADrenar && c.pendientes() > 0);
    return total;
  })();
  try {
    return await drenando;
  } finally {
    drenando = null;
    if (volverADrenar && c.pendientes() > 0) {
      void drenar(); // pedido que llegó entre el último chequeo y el cierre
    }
  }
}

function instalarListenersDom(): void {
  if (domListeners || typeof window === 'undefined' || typeof document === 'undefined') {
    return;
  }
  const alVolver = (): void => {
    void drenar();
    void pedirWakeLock();
    rearmarWatch();
  };
  domListeners = {
    online: () => void drenar(),
    visibility: () => {
      if (document.visibilityState === 'visible') {
        alVolver();
      }
    },
    pageshow: () => alVolver(),
  };
  window.addEventListener('online', domListeners.online);
  document.addEventListener('visibilitychange', domListeners.visibility);
  window.addEventListener('pageshow', domListeners.pageshow);
}

function quitarListenersDom(): void {
  if (!domListeners) {
    return;
  }
  window.removeEventListener('online', domListeners.online);
  document.removeEventListener('visibilitychange', domListeners.visibility);
  window.removeEventListener('pageshow', domListeners.pageshow);
  domListeners = null;
}

async function pedirWakeLock(): Promise<void> {
  if (watcherId == null || wakeLock || typeof navigator === 'undefined') {
    return;
  }
  const wl = (navigator as NavigatorConWakeLock).wakeLock;
  if (!wl) {
    return; // capacidad opcional del navegador, no un error del reporte
  }
  try {
    wakeLock = await wl.request('screen');
  } catch {
    // El navegador lo negó (batería baja, pestaña oculta). Se vuelve a pedir
    // al volver a `visible`; el reporte sigue igual mientras la app esté abierta.
    wakeLock = null;
  }
}

async function soltarWakeLock(): Promise<void> {
  const wl = wakeLock;
  wakeLock = null;
  if (wl) {
    try {
      await wl.release();
    } catch {
      // Ya estaba liberado por el sistema: nada que hacer.
    }
  }
}

/** Solo para tests: estado limpio, sin timers ni listeners. */
export function __resetForTests(): void {
  detenerObservacion();
  quitarListenersDom();
  listeners.clear();
  cola = null;
  ultimoEnviado = null;
  ultimoFixWallMs = 0;
  ultimoTimestampObservadoMs = 0;
  ultimoRearmeMs = 0;
  drenando = null;
  volverADrenar = false;
  snapshot = INICIAL;
}
