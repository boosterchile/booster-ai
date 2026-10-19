import type { Logger } from '@booster-ai/logger';
import { type PuntoMapa, clasificarTextoPunto } from '@booster-ai/shared-schemas';
import { getBusinessCounter } from '../observability/business-metrics.js';
import { setResultAttributes, withBusinessSpan } from '../observability/business-span.js';

/**
 * Saca lat/lng de un link de Google Maps. Los links cortos
 * (`maps.app.goo.gl`) no traen coordenadas: hay que seguir el redirect.
 * Solo se habla con hosts de Google Maps, por HTTPS y sin credenciales en
 * la URL. Un host fuera de la lista corta la cadena (no es un proxy abierto).
 */

const HOSTS_PERMITIDOS = new Set([
  'maps.app.goo.gl',
  'maps.google.com',
  'maps.google.cl',
  'www.google.com',
  'google.com',
  'www.google.cl',
]);

const MAX_SALTOS = 5;
const TIMEOUT_MS = 4_000;

const enlaceCounter = getBusinessCounter('lugar_enlace_resuelto_total');

export type MotivoEnlace = 'url_invalida' | 'host_no_permitido' | 'sin_coordenadas' | 'red';

export type ResultadoEnlace = { ok: true; punto: PuntoMapa } | { ok: false; motivo: MotivoEnlace };

function hostPermitido(url: URL): boolean {
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') {
    return false;
  }
  const host = url.hostname.toLowerCase();
  if (host.includes(':') || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) {
    return false;
  }
  return HOSTS_PERMITIDOS.has(host);
}

async function cerrarCuerpo(response: Response, logger: Logger): Promise<void> {
  if (!response.body) {
    return;
  }
  try {
    await response.body.cancel();
  } catch (err) {
    logger.warn({ err }, 'resolverEnlaceMapa: no se pudo cerrar el body');
  }
}

async function resolverInner(
  texto: string,
  fetchImpl: typeof fetch,
  logger: Logger,
): Promise<ResultadoEnlace> {
  const inicial = clasificarTextoPunto(texto);
  if (inicial.tipo === 'punto') {
    return { ok: true, punto: inicial.punto };
  }
  if (inicial.tipo === 'texto') {
    return { ok: false, motivo: 'url_invalida' };
  }

  let actual = inicial.url;
  for (let salto = 0; salto < MAX_SALTOS; salto += 1) {
    let url: URL;
    try {
      url = new URL(actual);
    } catch {
      return { ok: false, motivo: 'url_invalida' };
    }
    if (!hostPermitido(url)) {
      logger.warn({ host: url.hostname }, 'resolverEnlaceMapa: host fuera de la lista');
      return { ok: false, motivo: 'host_no_permitido' };
    }
    const clasificado = clasificarTextoPunto(url.toString());
    if (clasificado.tipo === 'punto') {
      return { ok: true, punto: clasificado.punto };
    }

    let response: Response;
    try {
      response = await fetchImpl(url.toString(), {
        method: 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { accept: 'text/html', 'user-agent': 'booster-enlace-mapa' },
      });
    } catch (err) {
      logger.warn({ err, host: url.hostname }, 'resolverEnlaceMapa: fallo de red');
      return { ok: false, motivo: 'red' };
    }

    const location = response.headers.get('location');
    await cerrarCuerpo(response, logger);
    if (!location || response.status < 300 || response.status >= 400) {
      return { ok: false, motivo: 'sin_coordenadas' };
    }
    try {
      actual = new URL(location, url).toString();
    } catch {
      return { ok: false, motivo: 'url_invalida' };
    }
  }
  return { ok: false, motivo: 'sin_coordenadas' };
}

export async function resolverEnlaceMapa(opts: {
  texto: string;
  fetchImpl: typeof fetch;
  logger: Logger;
}): Promise<ResultadoEnlace> {
  return await withBusinessSpan({ name: 'lugar.resolver_enlace' }, async (span) => {
    const resultado = await resolverInner(opts.texto, opts.fetchImpl, opts.logger);
    setResultAttributes(span, {
      'booster.enlace.ok': resultado.ok,
      'booster.enlace.motivo': resultado.ok ? undefined : resultado.motivo,
    });
    enlaceCounter.add(1, {
      resultado: resultado.ok ? 'ok' : 'degradado',
      motivo: resultado.ok ? 'ok' : resultado.motivo,
    });
    return resultado;
  });
}
