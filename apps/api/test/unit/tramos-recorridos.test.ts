import { describe, expect, it } from 'vitest';
import {
  type ServicioRecorrido,
  repartirDistanciaEnTramos,
  tramosRecorridos,
} from '../../src/services/tramos-recorridos.js';

const t = (minutos: number): Date => new Date(Date.UTC(2026, 10, 11, 12, 0, 0) + minutos * 60_000);

const servicio = (
  tripId: string,
  masaKg: number,
  recogido: number,
  entregado: number | null,
): ServicioRecorrido => ({
  tripId,
  masaKg,
  recogidoEn: t(recogido),
  entregadoEn: entregado === null ? null : t(entregado),
});

describe('tramosRecorridos: lo que el camión llevó a bordo entre parada y parada', () => {
  it('un servicio solo es un tramo con su carga', () => {
    const r = tramosRecorridos([servicio('a', 8000, 0, 60)], t(60));
    expect(r.desde).toEqual(t(0));
    expect(r.hasta).toEqual(t(60));
    expect(r.tramos).toEqual([{ desde: t(0), hasta: t(60), cargaKg: 8000 }]);
  });

  it('dos recogidas y dos entregas: la carga a bordo sube y baja', () => {
    const r = tramosRecorridos([servicio('a', 8000, 0, 90), servicio('b', 5000, 30, 60)], t(90));
    expect(r.tramos).toEqual([
      { desde: t(0), hasta: t(30), cargaKg: 8000 },
      { desde: t(30), hasta: t(60), cargaKg: 13000 },
      { desde: t(60), hasta: t(90), cargaKg: 8000 },
    ]);
  });

  it('un tramo vacío entre una entrega y la recogida siguiente lleva carga 0', () => {
    const r = tramosRecorridos([servicio('a', 8000, 0, 30), servicio('b', 5000, 50, 80)], t(80));
    expect(r.tramos).toEqual([
      { desde: t(0), hasta: t(30), cargaKg: 8000 },
      { desde: t(30), hasta: t(50), cargaKg: 0 },
      { desde: t(50), hasta: t(80), cargaKg: 5000 },
    ]);
  });

  it('usa el orden en que ocurrieron las paradas, no el orden planificado', () => {
    const enUnOrden = tramosRecorridos(
      [servicio('a', 8000, 0, 90), servicio('b', 5000, 30, 60)],
      t(90),
    );
    const enOtro = tramosRecorridos(
      [servicio('b', 5000, 30, 60), servicio('a', 8000, 0, 90)],
      t(90),
    );
    expect(enOtro).toEqual(enUnOrden);
  });

  it('dos paradas en el mismo instante no dejan un tramo de duración cero', () => {
    const r = tramosRecorridos([servicio('a', 8000, 0, 60), servicio('b', 5000, 0, 60)], t(60));
    expect(r.tramos).toEqual([{ desde: t(0), hasta: t(60), cargaKg: 13000 }]);
  });

  it('una carga recogida y nunca entregada sigue a bordo hasta el final (§3.7)', () => {
    const r = tramosRecorridos([servicio('a', 8000, 0, 60), servicio('x', 3000, 20, null)], t(70));
    expect(r.hasta).toEqual(t(60));
    expect(r.tramos).toEqual([
      { desde: t(0), hasta: t(20), cargaKg: 8000 },
      { desde: t(20), hasta: t(60), cargaKg: 11000 },
    ]);
  });

  it('si ninguna carga se entregó, la ruta termina en su cierre', () => {
    const r = tramosRecorridos([servicio('x', 3000, 20, null)], t(70));
    expect(r.tramos).toEqual([{ desde: t(20), hasta: t(70), cargaKg: 3000 }]);
  });

  it('recogida y entrega en el mismo instante: un tramo sin duración con su carga', () => {
    const r = tramosRecorridos([servicio('a', 8000, 10, 10)], t(10));
    expect(r.tramos).toEqual([{ desde: t(10), hasta: t(10), cargaKg: 8000 }]);
  });

  it('rechaza una ruta sin servicios y una entrega anterior a su recogida', () => {
    expect(() => tramosRecorridos([], t(0))).toThrow(/al menos un servicio/);
    expect(() => tramosRecorridos([servicio('a', 1, 30, 10)], t(30))).toThrow(/antes de recogerse/);
  });
});

describe('repartirDistanciaEnTramos: la distancia medida de la ruta, tramo por tramo', () => {
  // 0,01° de latitud ≈ 1,112 km. El camión avanza al norte a paso constante.
  const ping = (minuto: number, pasos: number) => ({
    tMs: t(minuto).getTime(),
    lat: -33 + pasos * 0.01,
    lng: -70.6,
  });

  it('reparte según lo que el camión avanzó en cada tramo y conserva el total', () => {
    const tramos = [
      { desde: t(0), hasta: t(30), cargaKg: 8000 },
      { desde: t(30), hasta: t(60), cargaKg: 13000 },
    ];
    // 3 pasos en el primer tramo y 1 en el segundo.
    const pings = [ping(0, 0), ping(10, 1), ping(20, 2), ping(29, 3), ping(59, 4)];
    const r = repartirDistanciaEnTramos(tramos, pings, 100);
    expect(r.map((x) => x.cargaKg)).toEqual([8000, 13000]);
    expect(r[0]?.distanciaKm).toBeCloseTo(75, 6);
    expect(r[1]?.distanciaKm).toBeCloseTo(25, 6);
    expect(r.reduce((s, x) => s + x.distanciaKm, 0)).toBeCloseTo(100, 9);
  });

  it('sin avance observado reparte por duración', () => {
    const tramos = [
      { desde: t(0), hasta: t(30), cargaKg: 8000 },
      { desde: t(30), hasta: t(90), cargaKg: 0 },
    ];
    const r = repartirDistanciaEnTramos(tramos, [], 90);
    expect(r[0]?.distanciaKm).toBeCloseTo(30, 9);
    expect(r[1]?.distanciaKm).toBeCloseTo(60, 9);
  });

  it('ignora el avance fuera de la ventana de la ruta', () => {
    const tramos = [
      { desde: t(0), hasta: t(30), cargaKg: 8000 },
      { desde: t(30), hasta: t(60), cargaKg: 0 },
    ];
    // Un paso antes de la ruta, uno en cada tramo y uno después.
    const pings = [ping(-20, 0), ping(-10, 5), ping(10, 6), ping(40, 7), ping(80, 20)];
    const r = repartirDistanciaEnTramos(
      tramos,
      [pings[0], pings[1]].filter((x) => !!x),
      10,
    );
    expect(r.map((x) => x.distanciaKm)).toEqual([5, 5]);
    const conAvance = repartirDistanciaEnTramos(
      tramos,
      [ping(5, 0), ping(15, 1), ping(120, 9)],
      10,
    );
    expect(conAvance[0]?.distanciaKm).toBeCloseTo(10, 9);
    expect(conAvance[1]?.distanciaKm).toBe(0);
  });

  it('el avance que termina justo en el cierre cuenta en el último tramo', () => {
    const tramos = [{ desde: t(0), hasta: t(0), cargaKg: 8000 }];
    const r = repartirDistanciaEnTramos(tramos, [ping(0, 0), ping(0, 1)], 3);
    expect(r).toEqual([{ distanciaKm: 3, cargaKg: 8000 }]);
  });

  it('tramos sin duración y sin avance se reparten por igual', () => {
    const tramos = [
      { desde: t(0), hasta: t(0), cargaKg: 8000 },
      { desde: t(0), hasta: t(0), cargaKg: 0 },
    ];
    expect(repartirDistanciaEnTramos(tramos, [], 8).map((x) => x.distanciaKm)).toEqual([4, 4]);
  });

  it('con un solo tramo le da toda la distancia', () => {
    const r = repartirDistanciaEnTramos([{ desde: t(0), hasta: t(60), cargaKg: 8000 }], [], 42.5);
    expect(r).toEqual([{ distanciaKm: 42.5, cargaKg: 8000 }]);
  });
});
