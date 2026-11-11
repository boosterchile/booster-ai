/**
 * Reparto de la huella de una ruta entre sus servicios (ADR-089, spec
 * huella-consolidada §3.3 y §3.4).
 *
 * La actividad de un servicio es su masa por la distancia directa entre su
 * origen y su destino (toneladas-kilómetro). No son los kilómetros que el
 * camión recorrió con esa carga: así la parte de un servicio no depende del
 * orden en que el transportista armó las paradas.
 *
 *     parte_i = total × actividad_i / Σ actividad_j
 *
 * Invariante: las partes publicadas suman exactamente el total publicado. Se
 * consigue con aritmética entera y redondeo por resto mayor: cada parte se
 * redondea hacia abajo y las unidades que faltan van a las de mayor resto, con
 * desempate por identificador de servicio. El resultado no depende del orden
 * en que llegan los servicios.
 */

export interface ServicioParaReparto {
  readonly servicioId: string;
  /** Peso declarado. 0 si no lo declara: solo es válido cuando viaja solo. */
  readonly masaKg: number;
  /** Distancia directa entre el origen y el destino del servicio. */
  readonly distanciaDirectaKm: number;
}

export interface ParteDeServicio<K extends string> {
  readonly servicioId: string;
  /** Actividad del servicio en toneladas-kilómetro, a 3 decimales. */
  readonly actividadTkm: number;
  /** Participación en la ruta, en porcentaje a 2 decimales. Suman 100. */
  readonly participacionPct: number;
  /** Su parte de cada total, en la unidad y precisión del total (3 decimales). */
  readonly partes: Readonly<Record<K, number>>;
}

/** Versión del método de reparto; va en el certificado (spec §3.10). */
export const VERSION_METODO_REPARTO = 'tkm-distancia-directa-v1';

/** Las emisiones se publican en kg con 3 decimales: la unidad entera es el gramo. */
const UNIDADES_POR_KG = 1000;
/** La participación se publica en porcentaje con 2 decimales. */
const UNIDADES_DE_PARTICIPACION = 10_000n;

function exigirNoNegativo(valor: number, que: string): void {
  if (!Number.isFinite(valor) || valor < 0) {
    throw new Error(`${que} debe ser un número finito mayor o igual a 0, recibido ${valor}`);
  }
}

/**
 * Reparte `total` unidades enteras en proporción a `pesos`. La suma del
 * resultado es exactamente `total`. Las unidades sobrantes van a los de mayor
 * resto; ante empate, al que viene antes en la lista.
 */
function repartirEntero(total: bigint, pesos: readonly bigint[]): bigint[] {
  const suma = pesos.reduce((a, p) => a + p, 0n);
  const partes = pesos.map((p) => (total * p) / suma);
  const restos = pesos.map((p, indice) => ({ indice, resto: (total * p) % suma }));
  let sobrante = total - partes.reduce((a, p) => a + p, 0n);
  restos.sort((a, b) => (a.resto === b.resto ? a.indice - b.indice : a.resto > b.resto ? -1 : 1));
  for (const { indice } of restos) {
    if (sobrante === 0n) {
      break;
    }
    partes[indice] = (partes[indice] ?? 0n) + 1n;
    sobrante -= 1n;
  }
  return partes;
}

/**
 * Reparte cada total entre los servicios de una ruta según su actividad.
 *
 * `totales` lleva los componentes que el certificado publica (por ejemplo
 * `wtw`, `ttw` y `wtt`). Cada uno se reparte por separado y cada uno cumple el
 * invariante de suma.
 *
 * Un servicio cancelado después de recogido participa con su actividad
 * completa (spec §3.7): quien llama lo incluye en `servicios` y decide después
 * a quién le emite certificado.
 *
 * Devuelve los servicios ordenados por identificador.
 */
export function repartirPorActividad<K extends string>(input: {
  readonly totales: Readonly<Record<K, number>>;
  readonly servicios: readonly ServicioParaReparto[];
}): ParteDeServicio<K>[] {
  const { totales } = input;
  if (input.servicios.length === 0) {
    throw new Error('el reparto necesita al menos un servicio');
  }
  const servicios = [...input.servicios].sort((a, b) =>
    a.servicioId < b.servicioId ? -1 : a.servicioId > b.servicioId ? 1 : 0,
  );
  for (const [i, srv] of servicios.entries()) {
    if (i > 0 && servicios[i - 1]?.servicioId === srv.servicioId) {
      throw new Error(`servicio repetido en el reparto: ${srv.servicioId}`);
    }
    exigirNoNegativo(srv.masaKg, `masaKg de ${srv.servicioId}`);
    exigirNoNegativo(srv.distanciaDirectaKm, `distanciaDirectaKm de ${srv.servicioId}`);
  }
  const claves = Object.keys(totales) as K[];
  for (const clave of claves) {
    exigirNoNegativo(totales[clave], `total ${clave}`);
  }

  // Actividad exacta en gramos-metro, para que la proporción no arrastre
  // error de punto flotante.
  let pesos = servicios.map(
    (srv) =>
      BigInt(Math.round(srv.masaKg * 1000)) * BigInt(Math.round(srv.distanciaDirectaKm * 1000)),
  );
  if (pesos.every((p) => p === 0n)) {
    if (servicios.length > 1) {
      throw new Error(
        'ningún servicio de la ruta tiene actividad (masa × distancia): no hay con qué repartir',
      );
    }
    // Un servicio que viaja solo se lleva el total, declare o no su peso.
    pesos = [1n];
  }

  const participaciones = repartirEntero(UNIDADES_DE_PARTICIPACION, pesos);
  const repartos = new Map(
    claves.map((clave) => [
      clave,
      repartirEntero(BigInt(Math.round(totales[clave] * UNIDADES_POR_KG)), pesos),
    ]),
  );

  return servicios.map((srv, i) => ({
    servicioId: srv.servicioId,
    actividadTkm: Math.round((srv.masaKg / 1000) * srv.distanciaDirectaKm * 1000) / 1000,
    participacionPct: Number(participaciones[i] ?? 0n) / 100,
    partes: Object.fromEntries(
      claves.map((clave) => [clave, Number(repartos.get(clave)?.[i] ?? 0n) / UNIDADES_POR_KG]),
    ) as Record<K, number>,
  }));
}
