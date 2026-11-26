import { describe, expect, it } from 'vitest';
import { anticipoHuella } from './anticipo-huella.js';

/**
 * `.specs/frente2-cierre` §3.1 (D4): antes del viaje, la pantalla anticipa
 * cómo saldrá la huella según el camión. No promete «Medido»: eso depende de
 * que el camión envíe el consumo por CAN y de la cobertura (ADR-028, ADR-091).
 */
describe('anticipoHuella', () => {
  it('sin camión elegido: no anticipa', () => {
    expect(anticipoHuella({ tieneTeltonika: null })).toBeNull();
  });

  it('sin Teltonika: saldrá «Estimado»', () => {
    expect(anticipoHuella({ tieneTeltonika: false })).toEqual({
      presentacion: 'estimado',
      frase:
        'La huella saldrá «Estimado»: el camión no tiene Teltonika y la distancia se calcula con la ruta.',
    });
  });

  it('con Teltonika: la distancia saldrá medida, sin prometer «Medido»', () => {
    const a = anticipoHuella({ tieneTeltonika: true });
    expect(a?.presentacion).toBe('medido_teltonika');
    expect(a?.frase).toBe(
      'Con el Teltonika la distancia saldrá medida si cubre el 80 % del viaje. Sale «Medido» solo si el camión envía su consumo por CAN.',
    );
    expect(a?.frase).not.toMatch(/^Medido/);
  });
});
