import { describe, expect, it } from 'vitest';
import { medicionHuella } from '../../src/certificacion/medicion-huella.js';

/**
 * `.specs/frente2-cierre` §3.1, criterio 1: qué se midió (distancia,
 * combustible, peso) con su fuente y su clase, y el nivel con lo que le
 * faltaría para llegar a primario verificable (ADR-028 §2, ADR-077, ADR-091).
 */
const base = {
  precisionMethod: 'modelado' as const,
  routeDataSource: 'teltonika_gps' as const,
  coveragePct: 92,
  certificationLevel: 'secundario_modeled' as const,
  pesoDeclaradoKg: 12000,
};

function fila(r: ReturnType<typeof medicionHuella>, magnitud: string) {
  return r.filas.find((f) => f.magnitud === magnitud);
}

describe('medicionHuella — filas', () => {
  it('distancia con Teltonika sobre 80 %: medida, con la cobertura', () => {
    expect(fila(medicionHuella(base), 'distancia')).toEqual({
      magnitud: 'distancia',
      fuente: 'Teltonika del camión (cobertura 92 %)',
      clase: 'medido',
    });
  });

  it('distancia con Teltonika bajo 80 %: estimada', () => {
    expect(fila(medicionHuella({ ...base, coveragePct: 79.9 }), 'distancia')?.clase).toBe(
      'estimado',
    );
  });

  it('distancia del teléfono: medida, pero por el teléfono', () => {
    expect(fila(medicionHuella({ ...base, routeDataSource: 'movil_gps' }), 'distancia')).toEqual({
      magnitud: 'distancia',
      fuente: 'GPS del teléfono del conductor (cobertura 92 %)',
      clase: 'medido',
    });
  });

  it('distancia de Google Routes: estimada; declarada a mano: declarada; sin fuente: sin dato', () => {
    expect(
      fila(medicionHuella({ ...base, routeDataSource: 'maps_directions' }), 'distancia'),
    ).toEqual({
      magnitud: 'distancia',
      fuente: 'Ruta calculada con Google Routes',
      clase: 'estimado',
    });
    expect(
      fila(medicionHuella({ ...base, routeDataSource: 'manual_declared' }), 'distancia')?.clase,
    ).toBe('declarado');
    expect(fila(medicionHuella({ ...base, routeDataSource: null }), 'distancia')?.clase).toBe(
      'sin_dato',
    );
  });

  it('combustible: CAN medido, modelo modelado, por defecto estimado, sin método sin dato', () => {
    expect(
      fila(medicionHuella({ ...base, precisionMethod: 'exacto_canbus' }), 'combustible'),
    ).toEqual({ magnitud: 'combustible', fuente: 'CAN del camión', clase: 'medido' });
    expect(fila(medicionHuella(base), 'combustible')).toEqual({
      magnitud: 'combustible',
      fuente: 'Modelo GLEC v3.0 con el perfil del vehículo',
      clase: 'modelado',
    });
    expect(
      fila(medicionHuella({ ...base, precisionMethod: 'por_defecto' }), 'combustible')?.clase,
    ).toBe('estimado');
    expect(fila(medicionHuella({ ...base, precisionMethod: null }), 'combustible')?.clase).toBe(
      'sin_dato',
    );
  });

  it('peso: declarado en la carga; sin peso, sin dato', () => {
    expect(fila(medicionHuella(base), 'peso')).toEqual({
      magnitud: 'peso',
      fuente: 'Declarado en la carga (12.000 kg)',
      clase: 'declarado',
    });
    expect(fila(medicionHuella({ ...base, pesoDeclaradoKg: null }), 'peso')?.clase).toBe(
      'sin_dato',
    );
    expect(fila(medicionHuella({ ...base, pesoDeclaradoKg: 0 }), 'peso')?.clase).toBe('sin_dato');
  });

  it('las filas salen siempre en el mismo orden', () => {
    expect(medicionHuella(base).filas.map((f) => f.magnitud)).toEqual([
      'distancia',
      'combustible',
      'peso',
    ]);
  });
});

describe('medicionHuella — nivel y lo que falta', () => {
  it('primario verificable: nombre y nada que falte', () => {
    const r = medicionHuella({
      ...base,
      precisionMethod: 'exacto_canbus',
      coveragePct: 98,
      certificationLevel: 'primario_verificable',
    });
    expect(r.nivel).toEqual({
      nivel: 'primario_verificable',
      nombre: 'Primario verificable',
      falta: [],
      frase: 'Es el nivel más alto: la huella fue medida.',
    });
  });

  it('Teltonika con 92 % sin CAN: falta cobertura de 95 % y el CAN', () => {
    const r = medicionHuella(base);
    expect(r.nivel.nombre).toBe('Secundario modelado');
    expect(r.nivel.falta).toEqual([
      'cobertura del Teltonika de 95 % o más (este viaje: 92 %)',
      'medir el consumo con el CAN del camión',
    ]);
    expect(r.nivel.frase).toBe(
      'Para llegar a primario verificable falta cobertura del Teltonika de 95 % o más (este viaje: 92 %) y medir el consumo con el CAN del camión.',
    );
  });

  it('sin Teltonika: falta el Teltonika y el CAN', () => {
    const r = medicionHuella({ ...base, routeDataSource: 'maps_directions', coveragePct: 0 });
    expect(r.nivel.falta).toEqual([
      'medir la distancia con un Teltonika instalado en el camión',
      'medir el consumo con el CAN del camión',
    ]);
  });

  it('Teltonika sobre 95 % sin CAN: falta solo el CAN', () => {
    expect(medicionHuella({ ...base, coveragePct: 97 }).nivel.falta).toEqual([
      'medir el consumo con el CAN del camión',
    ]);
  });

  it('el teléfono no llega a primario: falta el Teltonika', () => {
    expect(
      medicionHuella({ ...base, routeDataSource: 'movil_gps', precisionMethod: 'exacto_canbus' })
        .nivel.falta,
    ).toEqual(['medir la distancia con un Teltonika instalado en el camión']);
  });

  it('nivel por defecto y nivel ausente se nombran', () => {
    expect(medicionHuella({ ...base, certificationLevel: 'secundario_default' }).nivel.nombre).toBe(
      'Secundario por defecto',
    );
    const sin = medicionHuella({ ...base, certificationLevel: null });
    expect(sin.nivel.nombre).toBe('Sin nivel');
    expect(sin.nivel.nivel).toBeNull();
  });

  it('la cobertura no sube: 94,9 % se muestra 94 %', () => {
    expect(medicionHuella({ ...base, coveragePct: 94.9 }).nivel.falta[0]).toBe(
      'cobertura del Teltonika de 95 % o más (este viaje: 94 %)',
    );
  });
});
