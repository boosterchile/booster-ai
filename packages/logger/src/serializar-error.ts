/**
 * Serialización de `Error` para el log (spec `.specs/errores-conexion-postgres`).
 *
 * `redactObjectValues` recorre el registro con `Object.entries` antes de que
 * pino serialice. De un `Error` solo quedaban sus propiedades enumerables: se
 * perdían `message`, `stack` y la causa completa, que es donde un error de
 * consulta de Drizzle guarda el motivo real (el error de `pg`).
 *
 * Un error de consulta trae además los valores (`params`) como propiedad y
 * dentro del texto `params: …` del mensaje y del stack. Son datos de negocio
 * (IMEI, coordenadas, RUT) y no se escriben: se conserva solo cuántos eran.
 */

interface ErrorDeConsulta extends Error {
  query: string;
  params: unknown;
}

function esErrorDeConsulta(err: Error): err is ErrorDeConsulta {
  return 'params' in err && 'query' in err && typeof err.query === 'string';
}

function marcaDeOmitidos(params: unknown): string {
  return `[omitidos: ${Array.isArray(params) ? params.length : 1}]`;
}

/**
 * Quita de un texto del error (mensaje o stack) los valores de la consulta.
 * Drizzle los escribe como `params: ${params}`, así que el fragmento exacto
 * se puede reconstruir y reemplazar sin tocar el resto.
 */
function sinValores(err: Error, texto: string): string {
  if (!esErrorDeConsulta(err)) {
    return texto;
  }
  return texto.replace(`params: ${err.params}`, `params: ${marcaDeOmitidos(err.params)}`);
}

/** Mensaje del error sin los valores de la consulta. */
export function mensajeSinValores(err: Error): string {
  return sinValores(err, err.message);
}

/** Stack del error sin los valores de la consulta. */
export function stackSinValores(err: Error): string {
  return sinValores(err, err.stack ?? `${err.name}: ${err.message}`);
}

/**
 * Convierte un `Error` en un objeto plano: tipo, mensaje, stack, sus
 * propiedades propias y la causa. `transformar` se aplica a cada valor (es la
 * redacción de PII del llamador) y es quien corta los ciclos.
 */
export function serializarError(
  err: Error,
  transformar: (valor: unknown) => unknown,
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    type: err.name,
    message: transformar(mensajeSinValores(err)),
    stack: transformar(stackSinValores(err)),
  };
  const deConsulta = esErrorDeConsulta(err);
  for (const [clave, valor] of Object.entries(err)) {
    if (clave === 'cause') {
      continue;
    }
    out[clave] = deConsulta && clave === 'params' ? marcaDeOmitidos(valor) : transformar(valor);
  }
  // `cause` es no enumerable cuando viene de `new Error(msg, { cause })` y
  // enumerable cuando el constructor la asigna (Drizzle): se lee directo.
  if (err.cause !== undefined) {
    out.cause = transformar(err.cause);
  }
  return out;
}
