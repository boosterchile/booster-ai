import { FULL_TANK_PCT, SETTLE_AFTER_FULL_MS, SETTLE_AFTER_PARTIAL_MS } from './analyze-fuel.js';
import { HOUR_MS, MINUTE_MS, engineBetween, medianLevel, pointsBetween } from './stops.js';
import type { FuelPoint, RefuelRecord, Stop } from './types.js';

/** Error of the engine counter until the first months of loads measure it. */
export const DEFAULT_COUNTER_TOLERANCE = 0.03;
/** Level uncertainty at each end of a period, in points. */
const PERIOD_LEVEL_TOLERANCE_PTS = 2;
const LEVEL_WINDOW_MS = 15 * MINUTE_MS;
const SETTLED_WINDOW_MS = 30 * MINUTE_MS;
export const RECORD_MATCH_MS = 6 * HOUR_MS;
export const INCOMPLETE_MIN_L = 30;
export const INCOMPLETE_MIN_SHARE = 0.2;

export interface PeriodReconciliation {
  loadedL: number;
  engineL: number;
  stockChangeL: number;
  /** `loaded − engine − stock change`. Positive = litres that left the tank without being burned. */
  missingL: number;
  toleranceL: number;
  exceeds: boolean;
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

/**
 * Registered loads against the engine counter over a period (D4). This is the
 * balance that sees 10–20 L jerrycans: it does not depend on the level sensor
 * except at the two ends. Null without engine counter or without level at the ends.
 */
export function reconcilePeriod(opts: {
  points: readonly FuelPoint[];
  records: readonly RefuelRecord[];
  litersPerPoint: number;
  startMs: number;
  endMs: number;
  counterTolerance?: number;
}): PeriodReconciliation | null {
  const engine = engineBetween(pointsBetween(opts.points, opts.startMs, opts.endMs));
  const level0 = medianLevel(
    pointsBetween(opts.points, opts.startMs - LEVEL_WINDOW_MS, opts.startMs),
  );
  const level1 = medianLevel(pointsBetween(opts.points, opts.endMs - LEVEL_WINDOW_MS, opts.endMs));
  if (engine == null || level0 == null || level1 == null) {
    return null;
  }
  const loaded = opts.records
    .filter((r) => r.tMs > opts.startMs && r.tMs <= opts.endMs)
    .reduce((a, r) => a + r.liters, 0);
  const stockChange = (level1 - level0) * opts.litersPerPoint;
  const missing = loaded - engine - stockChange;
  const tolerance =
    (opts.counterTolerance ?? DEFAULT_COUNTER_TOLERANCE) * engine +
    2 * PERIOD_LEVEL_TOLERANCE_PTS * opts.litersPerPoint;
  return {
    loadedL: round1(loaded),
    engineL: round1(engine),
    stockChangeL: round1(stockChange),
    missingL: round1(missing),
    toleranceL: round1(tolerance),
    exceeds: missing > tolerance,
  };
}

export interface RefuelReconciliation {
  record: RefuelRecord;
  matched: boolean;
  /** Litres that reached the tank: settled rise plus what the engine burned meanwhile. */
  deliveredL: number | null;
  incomplete: boolean;
}

/** Each registered load against the refuel seen in the level series, ±6 h. */
export function reconcileRefuels(opts: {
  points: readonly FuelPoint[];
  stops: readonly Stop[];
  records: readonly RefuelRecord[];
  litersPerPoint: number;
}): RefuelReconciliation[] {
  const refuels = opts.stops.filter((s) => s.kind === 'refuel');
  return opts.records.map((record) => {
    let best: Stop | null = null;
    for (const r of refuels) {
      const gap = Math.abs((r.startMs + r.endMs) / 2 - record.tMs);
      if (
        gap <= RECORD_MATCH_MS &&
        (best == null || gap < Math.abs((best.startMs + best.endMs) / 2 - record.tMs))
      ) {
        best = r;
      }
    }
    if (best == null) {
      return { record, matched: false, deliveredL: null, incomplete: false };
    }
    const settledAt =
      best.endMs +
      (best.levelEndPct < FULL_TANK_PCT ? SETTLE_AFTER_PARTIAL_MS : SETTLE_AFTER_FULL_MS);
    const settled = medianLevel(
      pointsBetween(opts.points, settledAt, settledAt + SETTLED_WINDOW_MS),
    );
    const engine = engineBetween(pointsBetween(opts.points, best.endMs, settledAt)) ?? 0;
    const delivered =
      settled != null
        ? (settled - best.levelStartPct) * opts.litersPerPoint + engine
        : (best.levelEndPct - best.levelStartPct) * opts.litersPerPoint;
    const short = record.liters - delivered;
    return {
      record,
      matched: true,
      deliveredL: round1(delivered),
      incomplete: short >= Math.max(INCOMPLETE_MIN_L, INCOMPLETE_MIN_SHARE * record.liters),
    };
  });
}
