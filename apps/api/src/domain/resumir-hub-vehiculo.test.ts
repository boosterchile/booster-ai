import { describe, expect, it } from 'vitest';
import { resumirHubVehiculo } from './resumir-hub-vehiculo.js';
import type { TrayectoTeltonika } from './segmentar-trayectos-teltonika.js';

function trayecto(overrides: Partial<TrayectoTeltonika> = {}): TrayectoTeltonika {
  return {
    id: 'v:2026-09-02T12:00:00.000Z',
    vehiculoId: 'v',
    empresaId: 'e',
    patente: 'ABCD12',
    inicio: '2026-09-02T12:00:00.000Z',
    fin: '2026-09-02T13:00:00.000Z',
    distanciaKm: 40,
    litrosIniciales: null,
    litrosFinales: null,
    kmPorLitro: null,
    fuenteCombustible: null,
    litrosConsumidos: null,
    nivelPctInicial: null,
    nivelPctFinal: null,
    notaCombustible: null,
    posibleRoboCombustible: false,
    posibleRoboHormiga: false,
    eventLat: null,
    eventLon: null,
    sensorCombustible: 'ausente',
    ctaSensor: true,
    ctaCapacidadEstanque: false,
    ...overrides,
  };
}

describe('resumirHubVehiculo', () => {
  it('sin trayectos no inventa km/L ni alertas', () => {
    const resumen = resumirHubVehiculo([]);
    expect(resumen.ultimo).toBeNull();
    expect(resumen.recientes).toEqual([]);
    expect(resumen.kmRecientes).toBe(0);
    expect(resumen.litrosRecientes).toBeNull();
    expect(resumen.kmPorLitro).toBeNull();
    expect(resumen.ctaSensor).toBe(false);
    expect(resumen.alertasTotal).toBe(0);
    expect(resumen.alertaUltima).toBeNull();
  });

  it('arma el km/L como Σkm/ΣL cuando hay litros', () => {
    const resumen = resumirHubVehiculo([
      trayecto({ distanciaKm: 100, litrosConsumidos: 25, kmPorLitro: null, ctaSensor: false }),
    ]);
    expect(resumen.kmPorLitro).toBe(4);
    expect(resumen.kmRecientes).toBe(100);
    expect(resumen.litrosRecientes).toBe(25);
    expect(resumen.ctaSensor).toBe(false);
  });

  it('ordena por fin y no copia un km/L si el trayecto no trae litros', () => {
    const resumen = resumirHubVehiculo([
      trayecto({
        id: 'viejo',
        fin: '2026-09-01T13:00:00.000Z',
        kmPorLitro: 3,
        ctaSensor: false,
      }),
      trayecto({
        id: 'nuevo',
        fin: '2026-09-03T13:00:00.000Z',
        kmPorLitro: null,
        ctaSensor: false,
      }),
      trayecto({
        id: 'medio',
        fin: '2026-09-02T13:00:00.000Z',
        kmPorLitro: 4.5,
        ctaSensor: false,
      }),
    ]);
    expect(resumen.ultimo?.id).toBe('nuevo');
    expect(resumen.kmPorLitro).toBeNull();
    expect(resumen.recientes.map((t) => t.id)).toEqual(['nuevo', 'medio', 'viejo']);
  });

  it('el KPI es Σkm/ΣL de la ventana, no el promedio de los km/L', () => {
    const resumen = resumirHubVehiculo([
      trayecto({
        id: 'largo',
        fin: '2026-09-01T13:00:00.000Z',
        distanciaKm: 100,
        litrosConsumidos: 20,
        kmPorLitro: 5,
        ctaSensor: false,
      }),
      trayecto({
        id: 'corto',
        fin: '2026-09-03T13:00:00.000Z',
        distanciaKm: 10,
        litrosConsumidos: 10,
        kmPorLitro: 1,
        ctaSensor: false,
      }),
    ]);
    const promedioDeRatios = (5 + 1) / 2;
    expect(promedioDeRatios).toBe(3);
    expect(resumen.kmPorLitro).toBe(3.67);
    expect(resumen.kmPorLitro).not.toBe(resumen.ultimo?.kmPorLitro);
    expect(resumen.ultimo?.id).toBe('corto');
  });

  it('un km/L de ventana sobre el tope queda oculto y los litros siguen en la suma', () => {
    const resumen = resumirHubVehiculo([
      trayecto({
        distanciaKm: 294.93,
        litrosConsumidos: 24,
        kmPorLitro: 12.29,
        notaCombustible: 'dato no confiable',
        ctaSensor: false,
      }),
    ]);
    expect(resumen.litrosRecientes).toBe(24);
    expect(resumen.kmPorLitro).toBeNull();
  });

  it('cuenta alertas de toda la ventana y deja la más reciente', () => {
    const trayectos = Array.from({ length: 12 }, (_, i) =>
      trayecto({
        id: `t-${i}`,
        fin: new Date(Date.UTC(2026, 8, 20 - i, 12)).toISOString(),
        inicio: new Date(Date.UTC(2026, 8, 20 - i, 11)).toISOString(),
        posibleRoboCombustible: i === 1 || i === 11,
        posibleRoboHormiga: i === 1,
        ctaSensor: false,
        distanciaKm: 10,
        litrosConsumidos: i === 11 ? 8 : null,
      }),
    );
    const resumen = resumirHubVehiculo(trayectos);
    expect(resumen.recientes).toHaveLength(10);
    expect(resumen.recientes.some((t) => t.id === 't-11')).toBe(false);
    expect(resumen.alertasTotal).toBe(2);
    expect(resumen.alertaUltima?.id).toBe('t-1');
    expect(resumen.alertaUltima?.posibleRoboHormiga).toBe(true);
    expect(resumen.litrosRecientes).toBeNull();
    expect(resumen.kmRecientes).toBe(100);
  });

  it('pide el sensor solo cuando todos los trayectos lo piden', () => {
    expect(resumirHubVehiculo([trayecto({ ctaSensor: true })]).ctaSensor).toBe(true);
    expect(
      resumirHubVehiculo([trayecto({ ctaSensor: true }), trayecto({ id: 'b', ctaSensor: false })])
        .ctaSensor,
    ).toBe(false);
  });
});
