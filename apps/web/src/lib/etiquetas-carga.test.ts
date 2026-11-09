import { describe, expect, it } from 'vitest';
import { etiquetaEvento } from './etiquetas-carga.js';

describe('etiquetaEvento', () => {
  it('traduce los eventos de edición de la carga', () => {
    expect(etiquetaEvento('carga_editada')).toBe('Datos de la carga actualizados');
    expect(etiquetaEvento('cambio_solicitado')).toBe('Cambio propuesto al transportista');
    expect(etiquetaEvento('cambio_respondido')).toBe('Respuesta al cambio propuesto');
  });

  it('un tipo desconocido se muestra legible', () => {
    expect(etiquetaEvento('algo_nuevo_raro')).toBe('Algo nuevo raro');
    expect(etiquetaEvento('')).toBe('Evento');
  });
});
