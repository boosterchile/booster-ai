/**
 * Lee un punto (lat/lng) desde texto pegado: coordenadas sueltas o un link
 * de Google Maps. Los links cortos (`maps.app.goo.gl`, `goo.gl`) no traen
 * coordenadas; se marcan para resolverlos en el servidor (CORS no deja
 * seguir el redirect desde el browser).
 */

export interface PuntoMapa {
  latitude: number;
  longitude: number;
}

export type ClasificacionTextoPunto =
  | { tipo: 'punto'; punto: PuntoMapa }
  | { tipo: 'enlace'; url: string }
  | { tipo: 'texto' };

const HOSTS_CORTOS = new Set(['maps.app.goo.gl', 'goo.gl']);

const HOSTS_GOOGLE = new Set([
  'maps.google.com',
  'maps.google.cl',
  'www.google.com',
  'google.com',
  'www.google.cl',
]);

function puntoValido(latitude: number, longitude: number): PuntoMapa | null {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return null;
  }
  // 0 en cualquier eje es null island o un eje vacío, nunca un punto en Chile.
  if (latitude === 0 || longitude === 0) {
    return null;
  }
  return { latitude, longitude };
}

function parsearPar(latitud: string, longitud: string): PuntoMapa | null {
  return puntoValido(Number(latitud), Number(longitud));
}

/**
 * URL https mínima. El paquete de schemas no incluye la lib DOM, así que
 * no usa el constructor global `URL`.
 */
interface UrlLeida {
  hostname: string;
  pathname: string;
  search: string;
  hash: string;
  username: string;
  password: string;
  href: string;
  parametro(clave: string): string | null;
}

function parametroDe(search: string, clave: string): string | null {
  const query = search.startsWith('?') ? search.slice(1) : search;
  if (!query) {
    return null;
  }
  for (const parte of query.split('&')) {
    if (!parte) {
      continue;
    }
    const eq = parte.indexOf('=');
    const nombreCrudo = eq === -1 ? parte : parte.slice(0, eq);
    const valorCrudo = eq === -1 ? '' : parte.slice(eq + 1);
    const nombre = decodificar(nombreCrudo);
    if (nombre !== clave) {
      continue;
    }
    return decodificar(valorCrudo);
  }
  return null;
}

function decodificar(valor: string): string {
  try {
    return decodeURIComponent(valor.replace(/\+/g, ' '));
  } catch {
    return valor;
  }
}

function leerUrl(texto: string): UrlLeida | null {
  const match = /^(https:)\/\/([^/?#]+)([^?#]*)(\?[^#]*)?(#.*)?$/i.exec(texto);
  const autoridad = match?.[2];
  if (!match || !autoridad) {
    return null;
  }
  let username = '';
  let password = '';
  let hostPuerto = autoridad;
  const arroba = autoridad.lastIndexOf('@');
  if (arroba >= 0) {
    const userinfo = autoridad.slice(0, arroba);
    hostPuerto = autoridad.slice(arroba + 1);
    const sep = userinfo.indexOf(':');
    username = sep >= 0 ? userinfo.slice(0, sep) : userinfo;
    password = sep >= 0 ? userinfo.slice(sep + 1) : '';
  }
  if (hostPuerto === '' || hostPuerto.startsWith('[')) {
    return null;
  }
  const ruta = match[3];
  const search = match[4] ?? '';
  return {
    hostname: hostPuerto.replace(/:\d+$/, '').toLowerCase(),
    pathname: ruta && ruta.length > 0 ? ruta : '/',
    search,
    hash: match[5] ?? '',
    username,
    password,
    href: texto,
    parametro: (clave) => parametroDe(search, clave),
  };
}

function extraerDeUrl(url: UrlLeida): PuntoMapa | null {
  const texto = `${url.pathname}${url.search}${url.hash}`;
  const pin = texto.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  if (pin?.[1] && pin[2]) {
    const punto = parsearPar(pin[1], pin[2]);
    if (punto) {
      return punto;
    }
  }
  const at = texto.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (at?.[1] && at[2]) {
    const punto = parsearPar(at[1], at[2]);
    if (punto) {
      return punto;
    }
  }
  for (const clave of ['q', 'query', 'll', 'center', 'destination', 'origin']) {
    const valor = url.parametro(clave);
    if (!valor) {
      continue;
    }
    const par = valor.match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
    if (par?.[1] && par[2]) {
      const punto = parsearPar(par[1], par[2]);
      if (punto) {
        return punto;
      }
    }
  }
  return null;
}

function esRutaDeMapas(url: UrlLeida): boolean {
  return url.hostname.startsWith('maps.') || url.pathname.startsWith('/maps');
}

/**
 * Clasifica lo que el generador pegó. No hace red.
 */
export function clasificarTextoPunto(raw: string): ClasificacionTextoPunto {
  const texto = raw.trim();
  if (!texto) {
    return { tipo: 'texto' };
  }

  const coordenadas = texto.match(/^(-?\d{1,3}(?:\.\d+)?)\s*[,;]\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (coordenadas?.[1] && coordenadas[2]) {
    const punto = parsearPar(coordenadas[1], coordenadas[2]);
    if (punto) {
      return { tipo: 'punto', punto };
    }
  }

  const etiquetado = texto.match(
    /lat(?:itud)?\s*[:=]?\s*(-?\d{1,3}(?:\.\d+)?)[\s,;]+(?:lng|lon|long(?:itud)?)\s*[:=]?\s*(-?\d{1,3}(?:\.\d+)?)/i,
  );
  if (etiquetado?.[1] && etiquetado[2]) {
    const punto = parsearPar(etiquetado[1], etiquetado[2]);
    if (punto) {
      return { tipo: 'punto', punto };
    }
  }

  const url = leerUrl(texto);
  if (!url || url.username || url.password) {
    return { tipo: 'texto' };
  }
  const host = url.hostname;
  if (HOSTS_CORTOS.has(host)) {
    return { tipo: 'enlace', url: url.href };
  }
  if (!HOSTS_GOOGLE.has(host) || !esRutaDeMapas(url)) {
    return { tipo: 'texto' };
  }
  const punto = extraerDeUrl(url);
  if (punto) {
    return { tipo: 'punto', punto };
  }
  return { tipo: 'enlace', url: url.href };
}
