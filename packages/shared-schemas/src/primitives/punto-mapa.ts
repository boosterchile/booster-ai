/**
 * Lee un punto (lat/lng) desde texto pegado: coordenadas sueltas o un link
 * de Google Maps. Los links cortos (`maps.app.goo.gl`, `goo.gl`) no traen
 * coordenadas; se marcan para resolverlos en el servidor (CORS no deja
 * seguir el redirect desde el browser).
 *
 * El recorte es lineal, sin expresiones regulares: el texto lo pega el
 * usuario y CodeQL marca como ReDoS cualquier cuantificador ambiguo.
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

const LARGO_MAXIMO = 4_000;

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

function esDigito(caracter: string | undefined): boolean {
  return caracter !== undefined && caracter >= '0' && caracter <= '9';
}

function esLetra(caracter: string | undefined): boolean {
  if (!caracter) {
    return false;
  }
  const codigo = caracter.toLowerCase().charCodeAt(0);
  return codigo >= 97 && codigo <= 122;
}

function saltarEspacios(texto: string, desde: number): number {
  let indice = desde;
  while (texto[indice] === ' ' || texto[indice] === '\t') {
    indice += 1;
  }
  return indice;
}

/**
 * Número de coordenada a partir de `desde`: signo, 1 a 3 enteros y hasta
 * 12 decimales. Null si el carácter inicial no abre un número.
 */
function leerNumero(texto: string, desde: number): { raw: string; fin: number } | null {
  let indice = desde;
  if (texto[indice] === '+' || texto[indice] === '-') {
    indice += 1;
  }
  let enteros = 0;
  while (esDigito(texto[indice]) && enteros < 3) {
    indice += 1;
    enteros += 1;
  }
  if (enteros === 0 || esDigito(texto[indice])) {
    return null;
  }
  if (texto[indice] === '.') {
    indice += 1;
    let decimales = 0;
    while (esDigito(texto[indice]) && decimales < 12) {
      indice += 1;
      decimales += 1;
    }
    if (decimales === 0 || esDigito(texto[indice])) {
      return null;
    }
  }
  return { raw: texto.slice(desde, indice), fin: indice };
}

function coordenadasSueltas(texto: string): PuntoMapa | null {
  const primero = leerNumero(texto, 0);
  if (!primero) {
    return null;
  }
  let indice = saltarEspacios(texto, primero.fin);
  const separador = texto[indice];
  if (separador !== ',' && separador !== ';') {
    return null;
  }
  indice = saltarEspacios(texto, indice + 1);
  const segundo = leerNumero(texto, indice);
  if (!segundo) {
    return null;
  }
  if (saltarEspacios(texto, segundo.fin) !== texto.length) {
    return null;
  }
  return parsearPar(primero.raw, segundo.raw);
}

function marcaLongitud(texto: string, desde: number): string | null {
  const resto = texto.slice(desde, desde + 8).toLowerCase();
  if (resto.startsWith('longitud')) {
    return 'longitud';
  }
  if (resto.startsWith('long')) {
    return 'long';
  }
  if (resto.startsWith('lng')) {
    return 'lng';
  }
  if (resto.startsWith('lon')) {
    return 'lon';
  }
  return null;
}

function leerEtiquetado(texto: string): PuntoMapa | null {
  const lower = texto.toLowerCase();
  for (let indice = 0; indice < texto.length; indice += 1) {
    const marca = lower.startsWith('latitud', indice)
      ? 'latitud'
      : lower.startsWith('lat', indice)
        ? 'lat'
        : null;
    if (!marca || esLetra(texto[indice - 1])) {
      continue;
    }
    let cursor = saltarEspacios(texto, indice + marca.length);
    if (texto[cursor] === ':' || texto[cursor] === '=') {
      cursor = saltarEspacios(texto, cursor + 1);
    }
    const latitud = leerNumero(texto, cursor);
    if (!latitud) {
      continue;
    }
    const antes = latitud.fin;
    cursor = latitud.fin;
    while (
      texto[cursor] === ' ' ||
      texto[cursor] === '\t' ||
      texto[cursor] === ',' ||
      texto[cursor] === ';'
    ) {
      cursor += 1;
    }
    if (cursor === antes) {
      continue;
    }
    const lon = marcaLongitud(texto, cursor);
    if (!lon) {
      continue;
    }
    cursor = saltarEspacios(texto, cursor + lon.length);
    if (texto[cursor] === ':' || texto[cursor] === '=') {
      cursor = saltarEspacios(texto, cursor + 1);
    }
    const longitud = leerNumero(texto, cursor);
    if (!longitud) {
      continue;
    }
    const punto = parsearPar(latitud.raw, longitud.raw);
    if (punto) {
      return punto;
    }
  }
  return null;
}

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
    if (decodificar(nombreCrudo) !== clave) {
      continue;
    }
    return decodificar(valorCrudo);
  }
  return null;
}

function decodificar(valor: string): string {
  try {
    return decodeURIComponent(valor.replaceAll('+', ' '));
  } catch {
    return valor;
  }
}

function sinPuerto(host: string): string {
  const corte = host.lastIndexOf(':');
  if (corte <= 0) {
    return host;
  }
  const puerto = host.slice(corte + 1);
  if (puerto.length === 0 || puerto.length > 5) {
    return host;
  }
  for (const caracter of puerto) {
    if (!esDigito(caracter)) {
      return host;
    }
  }
  return host.slice(0, corte);
}

function leerUrl(texto: string): UrlLeida | null {
  if (texto.length > LARGO_MAXIMO || !texto.toLowerCase().startsWith('https://')) {
    return null;
  }
  const resto = texto.slice('https://'.length);
  let corte = resto.length;
  for (let indice = 0; indice < resto.length; indice += 1) {
    const caracter = resto[indice];
    if (caracter === '/' || caracter === '?' || caracter === '#') {
      corte = indice;
      break;
    }
  }
  const autoridad = resto.slice(0, corte);
  if (!autoridad || autoridad.startsWith('[')) {
    return null;
  }
  let cola = resto.slice(corte);
  let hash = '';
  const hashEn = cola.indexOf('#');
  if (hashEn >= 0) {
    hash = cola.slice(hashEn);
    cola = cola.slice(0, hashEn);
  }
  let pathname = cola;
  let search = '';
  const queryEn = cola.indexOf('?');
  if (queryEn >= 0) {
    pathname = cola.slice(0, queryEn);
    search = cola.slice(queryEn);
  }
  if (!pathname) {
    pathname = '/';
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
  if (!hostPuerto || hostPuerto.startsWith('[')) {
    return null;
  }
  return {
    hostname: sinPuerto(hostPuerto).toLowerCase(),
    pathname,
    search,
    hash,
    username,
    password,
    href: texto,
    parametro: (clave) => parametroDe(search, clave),
  };
}

function puntoMarcado(texto: string, marca: string, separador: string): PuntoMapa | null {
  let desde = 0;
  while (desde < texto.length) {
    const en = texto.indexOf(marca, desde);
    if (en < 0) {
      return null;
    }
    const primero = leerNumero(texto, en + marca.length);
    if (primero && texto.startsWith(separador, primero.fin)) {
      const segundo = leerNumero(texto, primero.fin + separador.length);
      if (segundo) {
        const punto = parsearPar(primero.raw, segundo.raw);
        if (punto) {
          return punto;
        }
      }
    }
    desde = en + marca.length;
  }
  return null;
}

function parEnValor(valor: string): PuntoMapa | null {
  let indice = 0;
  while (indice < valor.length) {
    const primero = leerNumero(valor, indice);
    if (!primero) {
      indice += 1;
      continue;
    }
    let cursor = saltarEspacios(valor, primero.fin);
    const separador = valor[cursor];
    if (separador !== ',' && separador !== ';') {
      indice = primero.fin;
      continue;
    }
    cursor = saltarEspacios(valor, cursor + 1);
    const segundo = leerNumero(valor, cursor);
    if (segundo) {
      const punto = parsearPar(primero.raw, segundo.raw);
      if (punto) {
        return punto;
      }
    }
    indice = primero.fin;
  }
  return null;
}

function extraerDeUrl(url: UrlLeida): PuntoMapa | null {
  const texto = `${url.pathname}${url.search}${url.hash}`;
  return (
    puntoMarcado(texto, '!3d', '!4d') ??
    puntoMarcado(texto, '@', ',') ??
    ['q', 'query', 'll', 'center', 'destination', 'origin'].reduce<PuntoMapa | null>(
      (hallado, clave) => {
        if (hallado) {
          return hallado;
        }
        const valor = url.parametro(clave);
        return valor ? parEnValor(valor) : null;
      },
      null,
    )
  );
}

function esRutaDeMapas(url: UrlLeida): boolean {
  return url.hostname.startsWith('maps.') || url.pathname.startsWith('/maps');
}

/**
 * Clasifica lo que el generador pegó. No hace red.
 */
export function clasificarTextoPunto(raw: string): ClasificacionTextoPunto {
  const texto = raw.trim();
  if (!texto || texto.length > LARGO_MAXIMO) {
    return { tipo: 'texto' };
  }

  const sueltas = coordenadasSueltas(texto);
  if (sueltas) {
    return { tipo: 'punto', punto: sueltas };
  }
  const etiquetado = leerEtiquetado(texto);
  if (etiquetado) {
    return { tipo: 'punto', punto: etiquetado };
  }

  const url = leerUrl(texto);
  if (!url || url.username || url.password) {
    return { tipo: 'texto' };
  }
  if (HOSTS_CORTOS.has(url.hostname)) {
    return { tipo: 'enlace', url: url.href };
  }
  if (!HOSTS_GOOGLE.has(url.hostname) || !esRutaDeMapas(url)) {
    return { tipo: 'texto' };
  }
  const punto = extraerDeUrl(url);
  if (punto) {
    return { tipo: 'punto', punto };
  }
  return { tipo: 'enlace', url: url.href };
}
