/**
 * Decisión pura del alta por exención (`.specs/alta-membresia` SC4).
 *
 * No toca Firebase ni la base: el servicio solo ejecuta lo que esto devuelve.
 * Un correo que ya es usuario, o una solicitud ya aprobada, no puede acuñar
 * otro usuario de Firebase. Una pendiente se aprueba desde la lista, para no
 * duplicarla con otro nombre.
 */

export interface SolicitudAltaVista {
  id: string;
  estado: 'pendiente_aprobacion' | 'aprobado' | 'rechazado';
}

export type DecisionAltaExencion =
  | { accion: 'crear_y_aprobar' }
  | {
      accion: 'rechazar';
      codigo: 'email_already_registered' | 'alta_ya_emitida' | 'solicitud_pendiente';
    };

export function decidirAltaExencion(input: {
  usuarioExiste: boolean;
  solicitudes: readonly SolicitudAltaVista[];
}): DecisionAltaExencion {
  if (input.usuarioExiste) {
    return { accion: 'rechazar', codigo: 'email_already_registered' };
  }
  if (input.solicitudes.some((solicitud) => solicitud.estado === 'aprobado')) {
    return { accion: 'rechazar', codigo: 'alta_ya_emitida' };
  }
  if (input.solicitudes.some((solicitud) => solicitud.estado === 'pendiente_aprobacion')) {
    return { accion: 'rechazar', codigo: 'solicitud_pendiente' };
  }
  return { accion: 'crear_y_aprobar' };
}
