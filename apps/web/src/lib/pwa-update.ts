/**
 * La PWA instalada se queda en el bundle viejo: el service worker hace
 * `skipWaiting` + `clients.claim`, y el `registerSW.js` de vite-plugin-pwa
 * (`registerType: 'autoUpdate'`) solo recarga en el evento `activated` de
 * workbox-window. Ese evento no llega si el worker ya activó cuando la
 * página engancha el listener. En iOS la misma sesión puede durar días.
 *
 * Acá: al cambiar el controller, `location.reload()` una sola vez por
 * pestaña. La marca en sessionStorage frena el loop si el reload (o un
 * claim de WebKit) dispara `controllerchange` otra vez. A los 10 s se
 * borra, así el próximo deploy sí recarga. La primera toma de control
 * (página que todavía no tenía worker) no recarga: ese documento ya vino
 * de la red.
 *
 * El SW también puede navegar la ventana. Para que no se pisen, esta
 * página contesta el ping y el SW solo navega si nadie contestó.
 *
 * Al volver a primer plano se llama `registration.update()`. Sin eso iOS
 * no busca un SW nuevo mientras la PWA sigue abierta.
 */

export const PWA_RELOAD_MARK = 'booster:pwa-reload';
export const PWA_RELOAD_GUARD_MS = 10_000;
/** El SW avisa que tomó control. La pestaña contesta y se recarga sola. */
export const PWA_RELOAD_PING = 'booster:pwa-reload-ping';
export const PWA_RELOAD_ACK = 'booster:pwa-reload-ack';
/** Si nadie contesta en este plazo, el SW navega esa ventana (fallback). */
export const PWA_RELOAD_ACK_MS = 400;

export interface PwaWorkerMessage {
  data: unknown;
}

export interface PwaUpdateEnv {
  serviceWorker: {
    controller: object | null;
    addEventListener: (
      type: 'controllerchange' | 'message',
      listener: (event?: PwaWorkerMessage) => void,
    ) => void;
    ready: Promise<{ update: () => Promise<unknown> }>;
  };
  /** Respuesta al service worker. Sin esto el SW navega la ventana además. */
  reply: (message: unknown) => void;
  location: { reload: () => void };
  document: {
    visibilityState: DocumentVisibilityState;
    addEventListener: (type: 'visibilitychange', listener: () => void) => void;
  };
  session: {
    getItem: (key: string) => string | null;
    setItem: (key: string, value: string) => void;
    removeItem: (key: string) => void;
  };
  /** Storage o `registration.update()` que fallan. No se tragan. */
  report: (error: unknown) => void;
  schedule?: (fn: () => void, ms: number) => void;
}

export function installPwaUpdate(env: PwaUpdateEnv): void {
  const schedule =
    env.schedule ??
    ((fn, ms) => {
      setTimeout(fn, ms);
    });
  let hadController = env.serviceWorker.controller !== null;
  let reloaded = false;

  const readMark = (): string | null => {
    try {
      return env.session.getItem(PWA_RELOAD_MARK);
    } catch (error) {
      env.report(error);
      return null;
    }
  };

  const writeMark = (value: string | null): void => {
    try {
      if (value === null) {
        env.session.removeItem(PWA_RELOAD_MARK);
      } else {
        env.session.setItem(PWA_RELOAD_MARK, value);
      }
    } catch (error) {
      env.report(error);
    }
  };

  if (readMark() === '1') {
    schedule(() => {
      if (readMark() === '1') {
        writeMark(null);
      }
    }, PWA_RELOAD_GUARD_MS);
  }

  env.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded || readMark() === '1') {
      return;
    }
    if (!hadController) {
      hadController = true;
      return;
    }
    reloaded = true;
    writeMark('1');
    env.location.reload();
  });

  env.serviceWorker.addEventListener('message', (event) => {
    const mensaje = mensajeReload(event?.data);
    if (mensaje?.type !== PWA_RELOAD_PING) {
      return;
    }
    try {
      env.reply({ type: PWA_RELOAD_ACK, id: mensaje.id });
    } catch (error) {
      env.report(error);
    }
  });

  env.document.addEventListener('visibilitychange', () => {
    if (env.document.visibilityState !== 'visible') {
      return;
    }
    void env.serviceWorker.ready.then((registration) => registration.update()).catch(env.report);
  });
}

export function mensajeReload(data: unknown): { type: string; id: string } | null {
  if (typeof data !== 'object' || data === null) {
    return null;
  }
  if (!('type' in data) || !('id' in data)) {
    return null;
  }
  const { type, id } = data;
  if (typeof type !== 'string' || typeof id !== 'string' || id.length === 0) {
    return null;
  }
  return { type, id };
}

export interface ClienteParaRecarga {
  id: string;
  url: string;
  postMessage?: (message: unknown) => void;
  navigate: (url: string) => Promise<unknown>;
}

/**
 * Fallback del service worker. Solo recibe ventanas ya controladas.
 * Navega las que no contestan el ping: la pestaña con este módulo
 * contesta y se recarga en `controllerchange`, una sola vez.
 */
export async function recargarClientesSinAck(
  clientes: readonly ClienteParaRecarga[],
  esperarAcks: () => Promise<ReadonlySet<string>>,
): Promise<void> {
  const vivos = clientes.filter((cliente) => cliente.url.length > 0);
  for (const cliente of vivos) {
    cliente.postMessage?.({ type: PWA_RELOAD_PING, id: cliente.id });
  }
  const acks = await esperarAcks();
  await Promise.all(
    vivos
      .filter((cliente) => !acks.has(cliente.id))
      .map((cliente) => cliente.navigate(cliente.url)),
  );
}
