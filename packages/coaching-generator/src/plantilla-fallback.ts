import { determinarFocoPrincipal } from './foco.js';
import type { FocoPrincipal, ParametrosCoaching, ResultadoCoaching } from './tipos.js';

/**
 * Coaching generado por plantilla determinística — fallback cuando
 * Gemini falla (timeout, quota, network) o cuando la generación AI
 * está deshabilitada (dev sin API key).
 *
 * Diseño: un mensaje pre-escrito por foco principal, parametrizado
 * con el count del tipo dominante + distancia del trip. Tono
 * consistente con el de Gemini para que el carrier no note el switch
 * de fuente.
 *
 * Función PURA. Sin I/O. Determinística.
 *
 * **Por qué importa el fallback**:
 *
 *   - Gemini API tiene SLA de ~99.9%, lo que para 10K coachings/mes
 *     son ~10 fallos. Sin fallback el carrier ve "calculando..." y
 *     el SRE recibe un page por error rate.
 *   - El fallback NO es "mejor que nada" — los mensajes están
 *     curados para sonar natural. La diferencia con Gemini es solo
 *     que no se contextualiza por carga, hora del día, etc.
 */

const PLANTILLAS_POR_FOCO: Readonly<Record<FocoPrincipal, (p: ParametrosCoaching) => string>> = {
  felicitacion: (p) =>
    `¡Excelente conducción en estos ${Math.round(p.trip.distanciaKm)} km! Sin eventos de frenado o aceleración brusca, ni excesos de velocidad. Mantén ese estilo y bajas tu consumo de combustible y desgaste del vehículo.`,

  frenado: (p) =>
    `${p.desglose.frenadosBruscos} frenados bruscos detectados en este viaje. Aumentar la distancia con el vehículo de adelante te permite frenar más suave: ahorras combustible, disco y tu propia espalda.`,

  aceleracion: (p) =>
    `${p.desglose.aceleracionesBruscas} arrancadas bruscas en este viaje. Acelerar más progresivamente, sobre todo al salir de semáforos, reduce hasta 15% el consumo de combustible y el desgaste del motor.`,

  curvas: (p) =>
    `${p.desglose.curvasBruscas} curvas tomadas con fuerza en este viaje. Reducir velocidad antes de la curva (no en la curva) te da control sobre la carga y baja el desgaste de neumáticos.`,

  velocidad: (p) =>
    `${p.desglose.excesosVelocidad} excesos de velocidad detectados. Mantenerse cerca del límite no solo evita multas: a 90 km/h el consumo es ~10% menor que a 110 km/h sin cambiar mucho el tiempo de viaje.`,

  multiple: (p) => {
    const total =
      p.desglose.aceleracionesBruscas +
      p.desglose.frenadosBruscos +
      p.desglose.curvasBruscas +
      p.desglose.excesosVelocidad;
    return `Detectamos ${total} eventos de conducción brusca en este viaje (${p.score}/100). Conducir más suave reduce hasta 15% el consumo de combustible y el desgaste del vehículo. Te enviamos un detalle por tipo en el dashboard.`;
  },
};

export function generarCoachingDeterministicoFromBreakdown(
  params: ParametrosCoaching,
): ResultadoCoaching {
  const focoPrincipal = determinarFocoPrincipal(params.desglose);
  const fn = PLANTILLAS_POR_FOCO[focoPrincipal];
  return {
    mensaje: fn(params),
    focoPrincipal,
    fuente: 'plantilla',
  };
}
