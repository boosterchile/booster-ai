/**
 * Titular del certificado de un viaje (`.specs/frente2-cierre` §3.3, decisión
 * D2 del PO). La titular identifica la carpeta del PDF en GCS
 * (`certificates/{titular}/…`) y es quien lo descarga.
 *
 * - Con generador de carga: el generador.
 * - Viaje propio del transportista sin generador (cliente externo): la
 *   transportista de la asignación; el PDF nombra al cliente.
 * - Sin ninguna de las dos (p. ej. WhatsApp antes del vínculo): nadie.
 */
export function titularCertificado(
  trip: { generadorCargaEmpresaId: string | null; origenAlta: string },
  transportistaEmpresaId: string | null,
): string | null {
  if (trip.generadorCargaEmpresaId) {
    return trip.generadorCargaEmpresaId;
  }
  if (trip.origenAlta === 'propio_transportista') {
    return transportistaEmpresaId;
  }
  return null;
}

/** El cliente externo que nombra el PDF de un viaje propio sin generador. */
export function clienteExternoDelCertificado(trip: {
  generadorCargaEmpresaId: string | null;
  origenAlta: string;
  clienteExternoNombre: string | null;
  clienteExternoRut: string | null;
}): { nombre: string; rut: string | null } | null {
  if (
    trip.generadorCargaEmpresaId ||
    trip.origenAlta !== 'propio_transportista' ||
    !trip.clienteExternoNombre
  ) {
    return null;
  }
  return { nombre: trip.clienteExternoNombre, rut: trip.clienteExternoRut };
}
