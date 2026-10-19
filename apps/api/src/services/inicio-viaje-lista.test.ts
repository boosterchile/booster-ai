import { describe, expect, it } from 'vitest';
import { avanceHito, pipelineDe, serializarFilaLista } from './inicio-viaje-lista.js';

describe('inicio viaje lista', () => {
  it('clasifica el pipeline del generador', () => {
    expect(pipelineDe('ofertas_enviadas')).toBe('buscando');
    expect(pipelineDe('emparejando')).toBe('buscando');
    expect(pipelineDe('asignado')).toBe('asignada');
    expect(pipelineDe('en_proceso')).toBe('en_camino');
    expect(pipelineDe('entregado')).toBe('entregada');
    expect(pipelineDe('cancelado')).toBe('fuera');
  });

  it('el avance es un hito, y sin match no inventa un porcentaje', () => {
    expect(avanceHito('esperando_match', null)).toBeNull();
    expect(avanceHito('asignado', 'asignado')).toBe(50);
    expect(avanceHito('en_proceso', 'recogido')).toBe(75);
    expect(avanceHito('entregado', 'entregado')).toBe(100);
  });

  it('la fila del listado trae transportista y avance sin perder el resto', () => {
    const fila = serializarFilaLista({
      id: 't-1',
      status: 'en_proceso',
      tracking_code: 'BST-4790',
      transportista_nombre: 'Van Oosterwyk',
      assignment_status: 'recogido',
      ofertas_pendientes: '2',
    });
    expect(fila.id).toBe('t-1');
    expect(fila.transportista_nombre).toBe('Van Oosterwyk');
    expect(fila.avance_pct).toBe(75);
    expect(fila.ofertas_pendientes).toBe(2);
  });

  it('una asignación cancelada no cuenta como transportista', () => {
    const fila = serializarFilaLista({
      status: 'esperando_match',
      transportista_nombre: 'Viejo',
      assignment_status: 'cancelado',
    });
    expect(fila.transportista_nombre).toBeNull();
    expect(fila.avance_pct).toBeNull();
  });
});
