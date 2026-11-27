import { distanceM, median } from './stats.js';
import type { FuelPoint, Stop } from './types.js';

export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const STOP_RADIUS_M = 150;
export const STOP_MIN_MS = 5 * MINUTE_MS;
/** A shorter stop only counts if the level rose: the 28-oct refuel took 3 min. */
export const REFUEL_STOP_MIN_MS = 2 * MINUTE_MS;
const SHORT_STOP_NEIGHBOURS = 6;
export const STOP_MAX_SPEED_KMH = 3;
/** The settled level at each end of a stop is the median of these minutes. */
export const STOP_EDGE_MS = 3 * MINUTE_MS;
/** A rise of this many points at a stop is a refuel, however short the stop. */
export const REFUEL_MIN_RISE_PTS = 8;
const RECOVERY_FROM_MS = 10 * MINUTE_MS;
const RECOVERY_TO_MS = 30 * MINUTE_MS;

/** Teltonika sends 0,0 when it has no GPS fix: that is not a place. */
function hasFix(p: FuelPoint): boolean {
  return (
    p.lat != null &&
    p.lng != null &&
    Math.abs(p.lat) <= 90 &&
    Math.abs(p.lng) <= 180 &&
    !(p.lat === 0 && p.lng === 0)
  );
}

function stopped(p: FuelPoint): boolean {
  return p.speedKmh != null && p.speedKmh <= STOP_MAX_SPEED_KMH && hasFix(p);
}

function levels(points: readonly FuelPoint[]): number[] {
  const out: number[] = [];
  for (const p of points) {
    if (p.levelPct != null && p.levelPct >= 0 && p.levelPct <= 100) {
      out.push(p.levelPct);
    }
  }
  return out;
}

function firstEngine(points: readonly FuelPoint[]): number | null {
  for (const p of points) {
    if (p.engineFuelL != null) {
      return p.engineFuelL;
    }
  }
  return null;
}

function lastEngine(points: readonly FuelPoint[]): number | null {
  for (let i = points.length - 1; i >= 0; i--) {
    const v = points[i]?.engineFuelL;
    if (v != null) {
      return v;
    }
  }
  return null;
}

export function engineBetween(points: readonly FuelPoint[]): number | null {
  const a = firstEngine(points);
  const b = lastEngine(points);
  return a != null && b != null && b >= a ? b - a : null;
}

/** Points must be one truck's, sorted by `tMs`. */
export function detectStops(points: readonly FuelPoint[]): Stop[] {
  const stops: Stop[] = [];
  let i = 0;
  while (i < points.length) {
    const first = points[i] as FuelPoint;
    if (!stopped(first)) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < points.length) {
      const next = points[j + 1] as FuelPoint;
      if (
        !stopped(next) ||
        distanceM(
          first.lat as number,
          first.lng as number,
          next.lat as number,
          next.lng as number,
        ) > STOP_RADIUS_M
      ) {
        break;
      }
      j++;
    }
    const last = points[j] as FuelPoint;
    const durationMs = last.tMs - first.tMs;
    if (durationMs >= REFUEL_STOP_MIN_MS) {
      const stop = buildStop(points, i, j, durationMs < STOP_MIN_MS);
      if (stop && (durationMs >= STOP_MIN_MS || stop.kind === 'refuel')) {
        stops.push(stop);
      }
    }
    i = j + 1;
  }
  return stops;
}

function buildStop(
  points: readonly FuelPoint[],
  i: number,
  j: number,
  short: boolean,
): Stop | null {
  const first = points[i] as FuelPoint;
  const last = points[j] as FuelPoint;
  const inside = points.slice(i, j + 1);
  const before = levels(points.slice(Math.max(0, i - SHORT_STOP_NEIGHBOURS), i));
  let startLevels = short
    ? before
    : levels(inside.filter((p) => p.tMs <= first.tMs + STOP_EDGE_MS));
  if (startLevels.length < 2) {
    startLevels = before;
  }
  const endLevels = short
    ? levels(points.slice(j + 1, j + 1 + SHORT_STOP_NEIGHBOURS))
    : levels(inside.filter((p) => p.tMs >= last.tMs - STOP_EDGE_MS));
  let levelStartPct = median(startLevels);
  const levelEndPct = median(endLevels);
  if (levelStartPct == null || levelEndPct == null) {
    return null;
  }
  // A refuel can happen in the first minute of a long stop: compare the level
  // before arriving with the highest steady reading during the stop.
  const preLevel = median(before);
  const peak = peakSteadyLevel(levels(inside));
  const refuelInside = preLevel != null && peak != null && peak - preLevel >= REFUEL_MIN_RISE_PTS;
  if (refuelInside) {
    levelStartPct = preLevel;
  }
  const after: FuelPoint[] = [];
  for (let k = j + 1; k < points.length; k++) {
    const p = points[k] as FuelPoint;
    if (p.tMs > last.tMs + RECOVERY_TO_MS) {
      break;
    }
    if (p.tMs >= last.tMs + RECOVERY_FROM_MS && (p.speedKmh ?? 0) > STOP_MAX_SPEED_KMH) {
      after.push(p);
    }
  }
  const dropPts = levelStartPct - levelEndPct;
  const kind = refuelInside || dropPts <= -REFUEL_MIN_RISE_PTS ? 'refuel' : 'normal';
  return {
    startMs: first.tMs,
    endMs: last.tMs,
    lat: first.lat as number,
    lng: first.lng as number,
    levelStartPct,
    levelEndPct,
    dropPts,
    engineL: engineBetween(inside),
    levelAfterPct: median(levels(after)),
    kind,
  };
}

export function pointsBetween(
  points: readonly FuelPoint[],
  fromMs: number,
  toMs: number,
): FuelPoint[] {
  return points.filter((p) => p.tMs >= fromMs && p.tMs <= toMs);
}

export function medianLevel(points: readonly FuelPoint[]): number | null {
  return median(levels(points));
}

/** Highest value of a 3-reading rolling median: one spike is not a refuel. */
function peakSteadyLevel(values: readonly number[]): number | null {
  if (values.length < 3) {
    return null;
  }
  let peak: number | null = null;
  for (let k = 0; k + 2 < values.length; k++) {
    const m = median(values.slice(k, k + 3)) as number;
    peak = peak == null ? m : Math.max(peak, m);
  }
  return peak;
}

/** Mean without the top and bottom 10 %: sub-point precision while the level falls. */
export function trimmedMeanLevel(points: readonly FuelPoint[]): number | null {
  const sorted = levels(points).sort((a, b) => a - b);
  if (sorted.length === 0) {
    return null;
  }
  const cut = Math.floor(sorted.length * 0.1);
  const kept = sorted.slice(cut, sorted.length - cut);
  return kept.reduce((a, b) => a + b, 0) / kept.length;
}
