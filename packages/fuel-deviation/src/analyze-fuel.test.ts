import { describe, expect, it } from 'vitest';
import { analyzeFuel } from './analyze-fuel.js';
import { reconcilePeriod, reconcileRefuels } from './reconcile.js';
import { SeriesBuilder, honestCycles } from './series.fixture.js';
import type { RefuelRecord } from './types.js';

function truck(opts: { engine?: boolean } = {}): SeriesBuilder {
  return new SeriesBuilder({
    capacityL: 560,
    startLiters: 200,
    withEngineCounter: opts.engine ?? true,
  });
}

describe('stops', () => {
  it('finds each stop and tells refuels apart from the level series', () => {
    const s = honestCycles(truck(), 1);
    const { stops } = analyzeFuel(s.points, { declaredCapacityL: 560 });
    expect(stops.filter((x) => x.kind === 'refuel')).toHaveLength(1);
    expect(stops.filter((x) => x.kind === 'normal')).toHaveLength(8);
  });

  it('a short refuel (3 min) is still a refuel, because the level rose', () => {
    const s = truck().drive(60).refuel(100, { stopMin: 3 }).drive(60);
    const { stops } = analyzeFuel(s.points, { declaredCapacityL: 560 });
    expect(stops.map((x) => x.kind)).toEqual(['refuel']);
  });
});

describe('points without GPS fix', () => {
  it('a run of 0,0 positions is not a stop', () => {
    const s = truck().drive(60).stop(30, { extractL: 60 }).drive(60);
    const points = s.points.map((p) => (p.speedKmh === 0 ? { ...p, lat: 0, lng: 0 } : p));
    expect(analyzeFuel(points, { declaredCapacityL: 560 }).stops).toEqual([]);
  });
});

describe('calibration from the truck itself', () => {
  it('derives litres per point from the engine counter between refuels', () => {
    const s = honestCycles(truck(), 5);
    const { calibration } = analyzeFuel(s.points, { declaredCapacityL: 560 });
    expect(calibration.source).toBe('truck');
    expect(calibration.cycles).toBeGreaterThanOrEqual(3);
    expect(calibration.litersPerPoint).toBeGreaterThan(5.3);
    expect(calibration.litersPerPoint).toBeLessThan(5.9);
    expect(calibration.capacityMismatch).toBe(false);
  });

  it('flags a declared capacity that the data contradicts (LFGR63 had 200 L)', () => {
    const s = honestCycles(truck(), 5);
    const { calibration } = analyzeFuel(s.points, { declaredCapacityL: 200 });
    expect(calibration.capacityMismatch).toBe(true);
    expect(calibration.impliedCapacityL).toBeGreaterThan(530);
  });

  it('flags a 17 % difference too (KZXB64 had 600 L, its data gives ~500)', () => {
    const s = honestCycles(truck(), 5);
    expect(analyzeFuel(s.points, { declaredCapacityL: 680 }).calibration.capacityMismatch).toBe(
      true,
    );
  });

  it('with fewer than 3 cycles it falls back to the declared capacity', () => {
    const s = honestCycles(truck(), 2);
    const { calibration } = analyzeFuel(s.points, { declaredCapacityL: 600 });
    expect(calibration.source).toBe('declared');
    expect(calibration.litersPerPoint).toBe(6);
    expect(calibration.capacityMismatch).toBe(false);
  });

  it('without engine counter nor capacity there is no calibration', () => {
    const s = honestCycles(truck({ engine: false }), 4);
    const { calibration } = analyzeFuel(s.points, { declaredCapacityL: null });
    expect(calibration.source).toBe('none');
    expect(calibration.litersPerPoint).toBeNull();
  });
});

describe('single drop at a stop', () => {
  it('an honest month shows nothing to the client', () => {
    const s = honestCycles(truck(), 6);
    const { deviations } = analyzeFuel(s.points, { declaredCapacityL: 560 });
    expect(deviations.filter((d) => d.status === 'confirmed')).toEqual([]);
  });

  it('confirms 60 L taken at a stop, with the litres within ±25 %', () => {
    const s = honestCycles(truck(), 4);
    s.refuel(560).drive(240, 70, 32).stop(40, { extractL: 60 }).drive(240, 70, 32);
    honestCycles(s, 1);
    const { deviations } = analyzeFuel(s.points, { declaredCapacityL: 560 });
    const confirmed = deviations.filter((d) => d.status === 'confirmed');
    expect(confirmed).toHaveLength(1);
    const missing = confirmed[0]?.missingL ?? 0;
    expect(missing).toBeGreaterThan(45);
    expect(missing).toBeLessThan(75);
    expect(confirmed[0]?.reason).toBe('missing_liters');
  });

  it('without the engine counter the same drop is only a candidate for Booster (D2)', () => {
    const s = honestCycles(truck({ engine: false }), 4);
    s.refuel(560).drive(240, 70, 32).stop(40, { extractL: 60 }).drive(240, 70, 32);
    const { deviations } = analyzeFuel(s.points, { declaredCapacityL: 560 });
    expect(deviations).toHaveLength(1);
    expect(deviations[0]?.status).toBe('unconfirmed');
    expect(deviations[0]?.reason).toBe('no_engine_counter');
  });

  it('the 28-oct case: a partial refuel that reads high and settles is not a deviation', () => {
    const s = honestCycles(truck(), 4);
    s.drive(200, 70, 32)
      .refuel(100, { stopMin: 3, settleHighPts: 25, settleMin: 60 })
      .stop(50)
      .drive(240, 70, 32);
    const { deviations } = analyzeFuel(s.points, { declaredCapacityL: 560 });
    expect(deviations).toEqual([]);
  });

  it('a drop that comes back after leaving is noise, not a candidate', () => {
    const noise = Array.from({ length: 30 }, (_, i) => (i >= 25 ? -7 : 0));
    const s = honestCycles(truck(), 4);
    s.refuel(560).drive(120, 70, 32).stop(30, { noise }).drive(120, 70, 32);
    const { deviations } = analyzeFuel(s.points, { declaredCapacityL: 560 });
    expect(deviations).toEqual([]);
  });

  it('is not evaluated with the tank under 15 %', () => {
    const s = new SeriesBuilder({ capacityL: 560, startLiters: 70 });
    s.drive(30).stop(30, { extractL: 40 }).drive(30);
    const { deviations } = analyzeFuel(s.points, { declaredCapacityL: 560 });
    expect(deviations).toEqual([]);
  });

  it('a refuel inside the balance window leaves the candidate unconfirmed', () => {
    const s = honestCycles(truck(), 4);
    s.refuel(560)
      .drive(240, 70, 32)
      .stop(40, { extractL: 60 })
      .drive(100, 70, 32)
      .refuel(300)
      .drive(200);
    const { deviations } = analyzeFuel(s.points, { declaredCapacityL: 560 });
    expect(deviations).toHaveLength(1);
    expect(deviations[0]?.status).toBe('unconfirmed');
    expect(deviations[0]?.reason).toBe('refuel_nearby');
  });
});

describe('small repeated extractions', () => {
  it('ten 20 L jerrycans at stops exceed the period floor of a quiet sensor', () => {
    const s = honestCycles(truck(), 4);
    for (let c = 0; c < 2; c++) {
      s.refuel(560, { stopMin: 20 });
      for (let leg = 0; leg < 8; leg++) {
        s.drive(90, 70, 32).stop(30, { extractL: leg < 5 ? 20 : 0 });
      }
    }
    const { stopBalance } = analyzeFuel(s.points, { declaredCapacityL: 560 });
    expect(stopBalance.exceeds).toBe(true);
    expect(stopBalance.status).toBe('confirmed');
    expect(stopBalance.netL ?? 0).toBeGreaterThan(150);
  });

  it('an honest period stays under the floor', () => {
    const s = honestCycles(truck(), 6);
    const { stopBalance } = analyzeFuel(s.points, { declaredCapacityL: 560 });
    expect(stopBalance.exceeds).toBe(false);
    expect(stopBalance.floorL).not.toBeNull();
  });
});

describe('reconciliation with registered loads (D4)', () => {
  function period(extractL: number) {
    const s = new SeriesBuilder({ capacityL: 560, startLiters: 100 }).drive(30);
    const records: RefuelRecord[] = [];
    const startMs = s.nowMs;
    for (let c = 0; c < 4; c++) {
      records.push({ tMs: s.nowMs + 60_000, liters: 400 });
      s.refuel(400, { stopMin: 20 });
      for (let leg = 0; leg < 8; leg++) {
        s.drive(90, 70, 32).stop(30, { extractL: leg % 4 === 0 ? extractL : 0 });
      }
    }
    return reconcilePeriod({
      points: s.points,
      records,
      litersPerPoint: 5.6,
      startMs,
      endMs: s.nowMs,
    });
  }

  it('loads minus engine minus stock change finds jerrycans the level cannot see', () => {
    const result = period(15);
    expect(result).not.toBeNull();
    expect(result?.missingL ?? 0).toBeGreaterThan(90);
    expect(result?.missingL ?? 0).toBeLessThan(150);
    expect(result?.exceeds).toBe(true);
  });

  it('an honest period reconciles within tolerance', () => {
    const result = period(0);
    expect(result?.exceeds).toBe(false);
    expect(Math.abs(result?.missingL ?? 99)).toBeLessThan(20);
  });

  it('without engine counter there is no period balance', () => {
    const s = honestCycles(truck({ engine: false }), 2);
    const result = reconcilePeriod({
      points: s.points,
      records: [],
      litersPerPoint: 5.6,
      startMs: s.points[0]?.tMs ?? 0,
      endMs: s.nowMs,
    });
    expect(result).toBeNull();
  });

  it('a registered load that did not reach the tank is an incomplete load', () => {
    const s = truck().drive(120);
    const loadAt = s.nowMs + 5 * 60_000;
    s.refuel(150, { stopMin: 15 }).drive(5 * 60, 70, 20);
    const analysis = analyzeFuel(s.points, { declaredCapacityL: 560 });
    const result = reconcileRefuels({
      points: s.points,
      stops: analysis.stops,
      records: [{ tMs: loadAt, liters: 300 }],
      litersPerPoint: 5.6,
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.incomplete).toBe(true);
    expect(result[0]?.deliveredL ?? 0).toBeGreaterThan(120);
    expect(result[0]?.deliveredL ?? 0).toBeLessThan(180);
  });

  it('a load with no refuel seen near it is reported as unmatched', () => {
    const s = truck().drive(600);
    const result = reconcileRefuels({
      points: s.points,
      stops: [],
      records: [{ tMs: s.points[100]?.tMs ?? 0, liters: 100 }],
      litersPerPoint: 5.6,
    });
    expect(result[0]?.matched).toBe(false);
    expect(result[0]?.incomplete).toBe(false);
  });
});
