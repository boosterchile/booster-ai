import type { MetodoPrecision, RouteDataSource } from '../tipos.js';
import { derivarNivelCertificacion } from './derivar-nivel.js';

/**
 * Línea de método del certificado/reporte y de la UI (ADR-077 §4).
 *
 * Se deriva SIEMPRE de las tres dimensiones de ADR-028 §1
 * (`metodo_precision × fuente_dato_ruta × coverage_pct`) — nunca de texto
 * libre ni de un flag del cliente — y es la única frase que describe de dónde
 * salió el número: el PDF (ambas plantillas) y la app la muestran tal cual.
 * No existe un segundo vocabulario.
 *
 * Vocabulario cerrado (ADR-077 §4):
 *   - «medida» aplica solo a la DISTANCIA (fuentes GPS). Las emisiones de un
 *     nivel secundario son «modeladas» o «estimadas».
 *   - «verificable», «certificado» y «medición de emisiones» solo existen en
 *     la línea de `primario_verificable` (y esta función nunca las produce
 *     fuera de ella).
 *   - La cobertura se trunca hacia abajo (`Math.floor`): nunca se sobre-declara
 *     lo medido (mismo criterio que `declaracionDistancia` del certificado).
 *
 * El nivel sale de `derivarNivelCertificacion` (fuente única de la matriz), así
 * que `movil_gps` jamás produce la línea primaria aunque el método sea
 * `exacto_canbus` (ADR-077 §2: combinación imposible por construcción).
 */
export interface LineaMetodoInput {
  precisionMethod: MetodoPrecision;
  routeDataSource: RouteDataSource;
  /** Fracción del viaje cubierta por la fuente principal, [0..100]. */
  coveragePct: number;
}

export function lineaMetodoCertificacion(input: LineaMetodoInput): string {
  // Valida coveragePct (lanza fuera de [0, 100]) y decide el nivel.
  const nivel = derivarNivelCertificacion(input);
  const cobertura = `cobertura ${Math.floor(input.coveragePct)} %`;

  if (nivel === 'primario_verificable') {
    return `Combustible medido por CAN bus del vehículo · Ruta GPS del vehículo (${cobertura})`;
  }

  const distancia = describirDistancia(input.routeDataSource, cobertura);
  const consumo = describirConsumo(input.precisionMethod);
  return `${distancia} · ${consumo}`;
}

function describirDistancia(fuente: RouteDataSource, cobertura: string): string {
  switch (fuente) {
    case 'teltonika_gps':
      return `Distancia medida por GPS del vehículo (${cobertura})`;
    case 'movil_gps':
      return `Distancia medida por GPS del móvil del conductor (${cobertura})`;
    case 'maps_directions':
      return 'Distancia estimada por ruta (Google Routes)';
    case 'manual_declared':
      return 'Distancia declarada por el cliente';
    default: {
      const _never: never = fuente;
      throw new Error(`fuente_dato_ruta desconocida: ${String(_never)}`);
    }
  }
}

function describirConsumo(metodo: MetodoPrecision): string {
  switch (metodo) {
    case 'exacto_canbus':
      // Solo se llega acá en un nivel secundario (cobertura < 95 % o fuente no
      // fija al vehículo): el consumo sí se leyó del CAN, pero el viaje no
      // alcanza el nivel primario. Se dice tal cual, sin la palabra prohibida.
      return 'Consumo medido por CAN bus del vehículo, sin nivel primario';
    case 'modelado':
      return 'Consumo modelado según GLEC v3.0';
    case 'por_defecto':
      return 'Consumo estimado con factores por defecto según GLEC v3.0';
    default: {
      const _never: never = metodo;
      throw new Error(`metodo_precision desconocido: ${String(_never)}`);
    }
  }
}
