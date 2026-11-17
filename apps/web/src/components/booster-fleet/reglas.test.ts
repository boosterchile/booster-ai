import type { PanelBoosterFleet } from '@booster-ai/shared-schemas';
import { describe, expect, it } from 'vitest';
import {
  type VehiculoFlota,
  accionDe,
  agruparPorTono,
  descripcionDe,
  formatoCoordenadas,
  formatoFecha,
  formatoFechaHora,
  fraseEstado,
  hallazgosDocumentales,
  medianaLectura,
} from './reglas.js';

const A = '11111111-1111-4111-8111-111111111111';

function vehiculo(patente: string, extra: Partial<VehiculoFlota> = {}): VehiculoFlota {
  return {
    vehiculo_id: A,
    patente,
    senal: 'en_orden',
    litros: 300,
    km: 1000,
    litros_por_100_km: 30,
    alertas: [],
    ...extra,
  };
}

function combustible(vehiculos: VehiculoFlota[]): PanelBoosterFleet['combustible'] {
  return {
    desde: '2026-11-10T15:00:00.000Z',
    hasta: '2026-11-17T15:00:00.000Z',
    truncado: false,
    litros: null,
    km: null,
    litros_por_100_km: null,
    con_alerta: vehiculos.filter((v) => v.senal !== 'en_orden').length,
    vehiculos,
  };
}

const DESVIACION = {
  trayecto_id: 't1',
  inicio: '2026-11-12T21:00:00.000Z',
  fin: '2026-11-13T10:00:00.000Z',
  tipo: 'golpe' as const,
  desde: '2026-11-13T06:12:00.000Z',
  hasta: '2026-11-13T06:16:00.000Z',
  litros: 62,
  lat: -34.98,
  lon: -71.23,
  total: 1,
};

describe('fraseEstado', () => {
  it('con una desviación nombra la patente', () => {
    expect(
      fraseEstado(
        combustible([
          vehiculo('AAAA11', { senal: 'posible_robo' }),
          vehiculo('BBBB22', { senal: 'sin_sensor' }),
        ]),
      ),
    ).toEqual({
      inicio: '2 camiones piden revisión.',
      foco: 'Parte por AAAA11: una desviación de combustible por analizar.',
    });
  });

  it('con varias desviaciones las cuenta', () => {
    expect(
      fraseEstado(
        combustible([
          vehiculo('AAAA11', { senal: 'posible_robo' }),
          vehiculo('BBBB22', { senal: 'posible_robo' }),
        ]),
      ).foco,
    ).toBe('Parte por las 2 desviaciones de combustible.');
  });

  it('sin desviación parte por el primero en orden de gravedad, en singular si es uno', () => {
    expect(
      fraseEstado(
        combustible([vehiculo('CCCC33', { senal: 'sin_telemetria' }), vehiculo('DDDD44')]),
      ),
    ).toEqual({
      inicio: '1 camión pide revisión.',
      foco: 'Parte por CCCC33: no tiene telemetría.',
    });
  });

  it('con todo en orden lo dice en positivo', () => {
    expect(fraseEstado(combustible([vehiculo('AAAA11'), vehiculo('BBBB22')]))).toEqual({
      inicio: 'Los 2 camiones están en orden esta semana.',
      foco: null,
    });
    expect(fraseEstado(combustible([])).inicio).toBe('Todavía no hay vehículos en la flota.');
  });

  it('no usa la palabra robo en ninguna señal', () => {
    const senales: VehiculoFlota['senal'][] = [
      'posible_robo',
      'sin_telemetria',
      'sin_movimiento',
      'sin_sensor',
      'falta_capacidad',
      'dato_no_confiable',
      'consumo_alto',
    ];
    for (const senal of senales) {
      const v = vehiculo('AAAA11', { senal });
      const texto = `${fraseEstado(combustible([v])).foco} ${descripcionDe(v)} ${accionDe(v)?.etiqueta}`;
      expect(texto).not.toMatch(/robo/i);
    }
  });
});

describe('agruparPorTono', () => {
  it('ordena por gravedad y omite los grupos vacíos', () => {
    const grupos = agruparPorTono([
      vehiculo('EEEE55'),
      vehiculo('CCCC33', { senal: 'consumo_alto' }),
      vehiculo('AAAA11', { senal: 'posible_robo' }),
    ]);
    expect(grupos.map((g) => g.tono)).toEqual(['primero', 'atencion', 'en_orden']);
  });
});

describe('medianaLectura', () => {
  it('necesita al menos dos camiones comparables', () => {
    expect(medianaLectura([vehiculo('AAAA11')])).toBeNull();
    expect(
      medianaLectura([vehiculo('AAAA11'), vehiculo('BBBB22', { km: 10, litros_por_100_km: 50 })]),
    ).toBeNull();
    expect(
      medianaLectura([vehiculo('AAAA11'), vehiculo('BBBB22', { litros_por_100_km: null })]),
    ).toBeNull();
  });

  it('toma el valor del medio o el promedio de los dos del medio', () => {
    const flota = [
      vehiculo('AAAA11', { litros_por_100_km: 30 }),
      vehiculo('BBBB22', { litros_por_100_km: 40 }),
      vehiculo('CCCC33', { litros_por_100_km: 32 }),
    ];
    expect(medianaLectura(flota)).toBe(32);
    expect(medianaLectura(flota.slice(0, 2))).toBe(35);
  });
});

describe('accionDe', () => {
  it('la desviación abre su trayecto; sin el dato, los trayectos del vehículo', () => {
    expect(accionDe(vehiculo('AAAA11', { senal: 'posible_robo', desviacion: DESVIACION }))).toEqual(
      {
        etiqueta: 'Analizar trayecto',
        destino: { to: '/app/trayectos', search: { vehiculo: A, detalle: 't1' } },
      },
    );
    expect(accionDe(vehiculo('AAAA11', { senal: 'posible_robo' }))?.destino).toEqual({
      to: '/app/trayectos',
      search: { vehiculo: A },
    });
  });

  it('cada señal tiene su acción y su destino', () => {
    const ficha = { to: '/app/vehiculos/$id', params: { id: A } };
    const trayectos = { to: '/app/trayectos', search: { vehiculo: A } };
    expect(accionDe(vehiculo('A', { senal: 'sin_telemetria' }))).toEqual({
      etiqueta: 'Ir al vehículo',
      destino: ficha,
    });
    expect(accionDe(vehiculo('A', { senal: 'sin_movimiento' }))?.etiqueta).toBe('Ir al vehículo');
    expect(accionDe(vehiculo('A', { senal: 'sin_sensor' }))).toEqual({
      etiqueta: 'Revisar sensor',
      destino: ficha,
    });
    expect(accionDe(vehiculo('A', { senal: 'falta_capacidad' }))).toEqual({
      etiqueta: 'Cargar capacidad',
      destino: ficha,
    });
    expect(accionDe(vehiculo('A', { senal: 'dato_no_confiable' }))).toEqual({
      etiqueta: 'Ver trayectos',
      destino: trayectos,
    });
    expect(accionDe(vehiculo('A', { senal: 'consumo_alto' }))).toEqual({
      etiqueta: 'Comparar trayectos',
      destino: trayectos,
    });
    expect(accionDe(vehiculo('A'))).toBeNull();
  });
});

describe('descripcionDe', () => {
  it('una desviación dice litros, fecha y hora, y lugar', () => {
    expect(
      descripcionDe(vehiculo('AAAA11', { senal: 'posible_robo', desviacion: DESVIACION })),
    ).toBe('−62,0 L · vie 13 nov, 03:16 · -34.9800, -71.2300');
  });

  it('lo que falta se dice, y la gradual y el total se anotan', () => {
    expect(
      descripcionDe(
        vehiculo('AAAA11', {
          senal: 'posible_robo',
          desviacion: {
            ...DESVIACION,
            tipo: 'hormiga',
            desde: null,
            hasta: null,
            litros: null,
            lat: null,
            lon: null,
            total: 3,
          },
        }),
      ),
    ).toBe('Gradual · litros sin dato · hora sin dato · lugar sin dato · 3 en la semana');
  });

  it('el consumo alto recuerda que puede ser la vía', () => {
    expect(descripcionDe(vehiculo('AAAA11', { senal: 'consumo_alto' }))).toContain(
      'puede ser la vía',
    );
  });
});

describe('formatos', () => {
  it('fecha y hora en Santiago, o null si el valor no sirve', () => {
    expect(formatoFechaHora('2026-11-13T06:12:00.000Z')).toBe('vie 13 nov, 03:12');
    expect(formatoFechaHora(null)).toBeNull();
    expect(formatoFechaHora('no es fecha')).toBeNull();
    expect(formatoFecha('2026-12-01')).toBe('1 dic');
    expect(formatoFecha('2026-11-10T15:00:00.000Z')).toBe('10 nov');
    expect(formatoFecha(null)).toBeNull();
    expect(formatoFecha('x')).toBeNull();
    expect(formatoCoordenadas(null, -71)).toBeNull();
  });
});

describe('hallazgosDocumentales', () => {
  it('ordena vencido y faltante primero, por vencer al final, y omite lo vigente', () => {
    const doc = (
      tipo: string,
      estado: 'vencido' | 'faltante' | 'sin_fecha' | 'por_vencer' | 'vigente',
    ) => ({
      tipo,
      estado,
      fecha_vencimiento: estado === 'faltante' || estado === 'sin_fecha' ? null : '2026-12-01',
      archivo: estado !== 'faltante',
    });
    const hallazgos = hallazgosDocumentales({
      vehiculos_al_dia: 0,
      vehiculos_con_hallazgo: 1,
      conductores_al_dia: 0,
      conductores_con_hallazgo: 1,
      vehiculos: [
        {
          vehiculo_id: A,
          patente: 'AAAA11',
          al_dia: false,
          estado: 'vencido',
          documentos: [
            doc('soap', 'por_vencer'),
            doc('permiso_circulacion', 'vigente'),
            doc('revision_tecnica', 'vencido'),
            doc('documento_nuevo', 'sin_fecha'),
          ],
        },
      ],
      conductores: [
        {
          conductor_id: A,
          nombre: 'Ana Soto',
          rut: '11.111.111-1',
          al_dia: false,
          estado: 'faltante',
          documentos: [doc('examen_psicotecnico', 'faltante')],
        },
      ],
    });
    expect(hallazgos.map((h) => [h.quien, h.documento, h.texto])).toEqual([
      ['AAAA11', 'Revisión técnica', 'Vencido · 1 dic'],
      ['Ana Soto', 'Examen psicotécnico', 'Falta el documento'],
      ['AAAA11', 'documento_nuevo', 'Sin fecha de vencimiento'],
      ['AAAA11', 'SOAP', 'Por vencer · 1 dic'],
    ]);
    expect(JSON.stringify(hallazgos)).not.toContain('11.111.111-1');
  });
});
