/**
 * Anticipo de cómo saldrá la huella antes del viaje (`.specs/frente2-cierre`
 * §3.1, decisión D4 del PO): al declarar el camión de un viaje propio y en
 * las ofertas del transportista.
 *
 * Solo sabe si el camión tiene Teltonika. No promete «Medido»: la huella sale
 * medida solo si el camión envía su consumo por CAN y el Teltonika cubre el
 * viaje (ADR-028 §2, ADR-091 §1); eso se sabe al cerrar, no antes.
 */
export interface AnticipoHuella {
  /** La presentación de ADR-091 que se espera como mínimo. */
  presentacion: 'medido_teltonika' | 'estimado';
  frase: string;
}

/** Cobertura mínima para que la distancia cuente como medida (ADR-077 §2). */
const COBERTURA_DISTANCIA_MEDIDA_PCT = 80;

export function anticipoHuella(input: { tieneTeltonika: boolean | null }): AnticipoHuella | null {
  if (input.tieneTeltonika === null) {
    return null;
  }
  if (!input.tieneTeltonika) {
    return {
      presentacion: 'estimado',
      frase:
        'La huella saldrá «Estimado»: el camión no tiene Teltonika y la distancia se calcula con la ruta.',
    };
  }
  return {
    presentacion: 'medido_teltonika',
    frase: `Con el Teltonika la distancia saldrá medida si cubre el ${COBERTURA_DISTANCIA_MEDIDA_PCT} % del viaje. Sale «Medido» solo si el camión envía su consumo por CAN.`,
  };
}
