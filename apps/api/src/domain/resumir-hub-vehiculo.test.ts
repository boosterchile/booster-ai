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
    economiaConfiable: true,
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

  it('arma el km/L con los km y los litros del trayecto, aunque la fila no traiga cociente', () => {
    const resumen = resumirHubVehiculo([
      trayecto({ distanciaKm: 100, litrosConsumidos: 25, kmPorLitro: null, ctaSensor: false }),
    ]);
    expect(resumen.kmPorLitro).toBe(4);
    expect(resumen.kmRecientes).toBe(100);
    expect(resumen.litrosRecientes).toBe(25);
    expect(resumen.ctaSensor).toBe(false);
  });

  it('el km/L de la ventana es Σkm/ΣL de los trayectos con litros confiables', () => {
    const resumen = resumirHubVehiculo([
      trayecto({
        id: 'reciente',
        fin: '2026-09-03T13:00:00.000Z',
        distanciaKm: 294.93,
        litrosConsumidos: 24,
        kmPorLitro: null,
        economiaConfiable: false,
        ctaSensor: false,
        fuenteCombustible: 'nivel_litros',
      }),
      trayecto({
        id: 'anterior',
        fin: '2026-09-02T13:00:00.000Z',
        distanciaKm: 200,
        litrosConsumidos: 80,
        kmPorLitro: 2.5,
        economiaConfiable: true,
        ctaSensor: false,
        fuenteCombustible: 'nivel_litros',
      }),
    ]);
    expect(resumen.kmPorLitro).toBe(2.5);
    expect(resumen.litrosRecientes).toBe(104);
  });

  it('suma los km y los litros confiables, no promedia los km/L', () => {
    const resumen = resumirHubVehiculo([
      trayecto({
        id: 'reciente',
        fin: '2026-09-03T13:00:00.000Z',
        distanciaKm: 100,
        litrosConsumidos: 20,
        kmPorLitro: 5,
        ctaSensor: false,
        fuenteCombustible: 'nivel_litros',
      }),
      trayecto({
        id: 'anterior',
        fin: '2026-09-02T13:00:00.000Z',
        distanciaKm: 200,
        litrosConsumidos: 80,
        kmPorLitro: 2.5,
        ctaSensor: false,
        fuenteCombustible: 'nivel_litros',
      }),
    ]);
    expect(resumen.kmPorLitro).toBe(3);
    expect(resumen.kmPorLitro).not.toBe(5);
    expect(resumen.kmPorLitro).not.toBe(3.75);
  });

  it('el km/L de la ventana es la suma, también cuando hay un trayecto sin litros', () => {
    const resumen = resumirHubVehiculo([
      trayecto({
        id: 'viejo',
        fin: '2026-09-01T13:00:00.000Z',
        distanciaKm: 30,
        litrosConsumidos: 10,
        kmPorLitro: 3,
        ctaSensor: false,
      }),
      trayecto({
        id: 'nuevo',
        fin: '2026-09-03T13:00:00.000Z',
        distanciaKm: 12,
        kmPorLitro: null,
        ctaSensor: false,
      }),
      trayecto({
        id: 'medio',
        fin: '2026-09-02T13:00:00.000Z',
        distanciaKm: 45,
        litrosConsumidos: 10,
        kmPorLitro: 4.5,
        ctaSensor: false,
      }),
    ]);
    expect(resumen.ultimo?.id).toBe('nuevo');
    expect(resumen.kmPorLitro).toBe(3.75);
    expect(resumen.recientes.map((t) => t.id)).toEqual(['nuevo', 'medio', 'viejo']);
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
