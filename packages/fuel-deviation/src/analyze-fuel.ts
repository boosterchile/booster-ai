import { median, populationStdDev, robustSigma } from './stats.js';
import {
  HOUR_MS,
  MINUTE_MS,
  detectStops,
  engineBetween,
  pointsBetween,
  trimmedMeanLevel,
} from './stops.js';
import type {
  Calibration,
  DeviationReason,
  DeviationStatus,
  FuelAnalysis,
  FuelPoint,
  Stop,
  StopBalance,
  StopDeviation,
} from './types.js';

/** A refuel that did not reach this level is partial: the sensor reads high for hours. */
export const FULL_TANK_PCT = 95;
export const SETTLE_AFTER_PARTIAL_MS = 4 * HOUR_MS;
export const SETTLE_AFTER_FULL_MS = 90 * MINUTE_MS;
/** Under this level the sensor swings; nothing is evaluated. */
export const LOW_LEVEL_PCT = 15;
export const CANDIDATE_MIN_PTS = 5;
export const CANDIDATE_NOISE_FACTOR = 4;
export const CONFIRM_MIN_L = 30;
export const CONFIRM_MIN_SHARE_OF_ENGINE = 0.25;
/** The balance window: settled level 2 to 2.5 h before and after the stop. */
const BALANCE_NEAR_MS = 120 * MINUTE_MS;
const BALANCE_FAR_MS = 150 * MINUTE_MS;
export const CALIBRATION_MIN_CYCLES = 3;
const CYCLE_MIN_DROP_PTS = 10;
const CYCLE_EDGE_MS = 10 * MINUTE_MS;
const CYCLE_START_AFTER_FULL_MS = 60 * MINUTE_MS;
/** KZXB64 had 600 L declared and its data gives ~500 (17 %): that has to show. */
export const CAPACITY_MISMATCH_SHARE = 0.15;
/** One point of AVL 89 is a whole point: σ never goes below the rounding. */
const MIN_SIGMA_PTS = 0.5;
const SIGMA_OUTLIER_PTS = 8;
export const PERIOD_FLOOR_SIGMAS = 3;

export interface AnalyzeFuelOptions {
  declaredCapacityL: number | null;
}

function isPartial(refuel: Stop): boolean {
  return refuel.levelEndPct < FULL_TANK_PCT;
}

function settleMs(refuel: Stop): number {
  return isPartial(refuel) ? SETTLE_AFTER_PARTIAL_MS : SETTLE_AFTER_FULL_MS;
}

function calibrate(
  points: readonly FuelPoint[],
  refuels: readonly Stop[],
  declaredCapacityL: number | null,
): Pick<
  Calibration,
  'litersPerPoint' | 'source' | 'cycles' | 'impliedCapacityL' | 'capacityMismatch'
> {
  const ratios: number[] = [];
  for (let k = 0; k + 1 < refuels.length; k++) {
    const a = refuels[k] as Stop;
    const b = refuels[k + 1] as Stop;
    const startMs = a.endMs + (isPartial(a) ? SETTLE_AFTER_PARTIAL_MS : CYCLE_START_AFTER_FULL_MS);
    const endMs = b.startMs;
    if (startMs >= endMs) {
      continue;
    }
    const level0 = trimmedMeanLevel(pointsBetween(points, startMs, startMs + CYCLE_EDGE_MS));
    const level1 = trimmedMeanLevel(pointsBetween(points, endMs - CYCLE_EDGE_MS, endMs));
    const engine = engineBetween(pointsBetween(points, startMs, endMs));
    if (
      level0 == null ||
      level1 == null ||
      engine == null ||
      level0 - level1 < CYCLE_MIN_DROP_PTS
    ) {
      continue;
    }
    ratios.push(engine / (level0 - level1));
  }
  const declared =
    declaredCapacityL != null && Number.isFinite(declaredCapacityL) && declaredCapacityL > 0
      ? declaredCapacityL
      : null;
  if (ratios.length >= CALIBRATION_MIN_CYCLES) {
    const lpp = median(ratios) as number;
    const implied = lpp * 100;
    return {
      litersPerPoint: lpp,
      source: 'truck',
      cycles: ratios.length,
      impliedCapacityL: Math.round(implied),
      capacityMismatch:
        declared != null && Math.abs(implied - declared) / declared > CAPACITY_MISMATCH_SHARE,
    };
  }
  return {
    litersPerPoint: declared != null ? declared / 100 : null,
    source: declared != null ? 'declared' : 'none',
    cycles: ratios.length,
    impliedCapacityL: null,
    capacityMismatch: false,
  };
}

function evaluable(stop: Stop, refuels: readonly Stop[]): boolean {
  if (stop.kind !== 'normal' || Math.min(stop.levelStartPct, stop.levelEndPct) < LOW_LEVEL_PCT) {
    return false;
  }
  return !refuels.some((r) => stop.startMs > r.endMs && stop.startMs - r.endMs < settleMs(r));
}

function netPts(stop: Stop, lpp: number | null): number {
  return stop.dropPts - (stop.engineL != null && lpp ? stop.engineL / lpp : 0);
}

function recovers(stop: Stop): boolean {
  return stop.levelAfterPct != null && stop.levelAfterPct - stop.levelEndPct >= stop.dropPts / 2;
}

function confirm(
  points: readonly FuelPoint[],
  stop: Stop,
  refuels: readonly Stop[],
  lpp: number | null,
  hasEngineCounter: boolean,
): StopDeviation {
  const base = {
    startMs: stop.startMs,
    endMs: stop.endMs,
    lat: stop.lat,
    lng: stop.lng,
    dropPts: stop.dropPts,
  };
  const pending = (reason: DeviationReason, extra: Partial<StopDeviation> = {}): StopDeviation => ({
    ...base,
    levelBeforePct: null,
    levelAfterPct: null,
    engineL: null,
    missingL: null,
    toleranceL: null,
    status: 'unconfirmed',
    reason,
    ...extra,
  });
  if (!hasEngineCounter) {
    return pending('no_engine_counter');
  }
  if (lpp == null) {
    return pending('no_calibration');
  }
  const fromMs = stop.startMs - BALANCE_FAR_MS;
  const toMs = stop.endMs + BALANCE_FAR_MS;
  // A refuel inside the window, or one still settling when the window opens.
  if (refuels.some((r) => r.endMs + settleMs(r) > fromMs && r.startMs <= toMs)) {
    return pending('refuel_nearby');
  }
  const before = trimmedMeanLevel(pointsBetween(points, fromMs, stop.startMs - BALANCE_NEAR_MS));
  const after = trimmedMeanLevel(pointsBetween(points, stop.endMs + BALANCE_NEAR_MS, toMs));
  const engine = engineBetween(pointsBetween(points, fromMs, toMs));
  if (before == null || after == null || engine == null) {
    return pending('no_data', { levelBeforePct: before, levelAfterPct: after, engineL: engine });
  }
  const missing = (before - after) * lpp - engine;
  const confirmed = missing >= Math.max(CONFIRM_MIN_L, CONFIRM_MIN_SHARE_OF_ENGINE * engine);
  const status: DeviationStatus = confirmed ? 'confirmed' : 'discarded';
  return {
    ...base,
    levelBeforePct: before,
    levelAfterPct: after,
    engineL: round1(engine),
    missingL: round1(missing),
    toleranceL: round1(2 * lpp),
    status,
    reason: confirmed ? 'missing_liters' : 'balance_ok',
  };
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

/**
 * Fuel deviations of one truck. `points` must be that truck's, sorted by `tMs`.
 * The client sees only `confirmed` (D1); Booster sees the rest.
 */
export function analyzeFuel(points: readonly FuelPoint[], opts: AnalyzeFuelOptions): FuelAnalysis {
  const stops = detectStops(points);
  const refuels = stops.filter((s) => s.kind === 'refuel');
  const hasEngineCounter = points.some((p) => p.engineFuelL != null);
  const cal = calibrate(points, refuels, opts.declaredCapacityL);
  const lpp = cal.litersPerPoint;

  const usable = stops.filter((s) => evaluable(s, refuels));
  const nets = usable.map((s) => netPts(s, lpp));
  const stopNoisePts = robustSigma(nets);
  const stopSigmaPts = Math.max(
    MIN_SIGMA_PTS,
    populationStdDev(nets.filter((v) => Math.abs(v) < SIGMA_OUTLIER_PTS)),
  );
  const calibration: Calibration = { ...cal, stopNoisePts, stopSigmaPts };

  const threshold = Math.max(CANDIDATE_MIN_PTS, CANDIDATE_NOISE_FACTOR * stopNoisePts);
  const deviations = usable
    .filter((s) => s.dropPts >= threshold && !recovers(s))
    .map((s) => confirm(points, s, refuels, lpp, hasEngineCounter));

  const sum = nets.reduce((a, b) => a + b, 0);
  const floorPts = PERIOD_FLOOR_SIGMAS * stopSigmaPts * Math.sqrt(usable.length);
  const exceeds = usable.length > 0 && sum > floorPts;
  const stopBalance: StopBalance = {
    stops: usable.length,
    netPts: round1(sum),
    netL: lpp != null ? round1(sum * lpp) : null,
    floorL: lpp != null ? round1(floorPts * lpp) : null,
    exceeds,
    status: exceeds ? (hasEngineCounter && lpp != null ? 'confirmed' : 'unconfirmed') : 'discarded',
  };

  return { stops, calibration, deviations, stopBalance };
}
