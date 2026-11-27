/**
 * One telemetry reading of a truck, already read from Teltonika `io_data`.
 * `levelPct` is AVL 89 (0–100). `engineFuelL` is AVL 83 × 0.1, the
 * cumulative fuel the engine has burned. Both can be missing in a point.
 */
export interface FuelPoint {
  tMs: number;
  lat: number | null;
  lng: number | null;
  speedKmh: number | null;
  levelPct: number | null;
  engineFuelL: number | null;
}

/** A fuel load registered by the company or by Booster (D4). */
export interface RefuelRecord {
  tMs: number;
  liters: number;
}

/** A stop: the truck stays within 150 m of where it stopped, at ≤ 3 km/h, ≥ 5 min. */
export interface Stop {
  startMs: number;
  endMs: number;
  lat: number;
  lng: number;
  /** Settled level when it stopped and when it left, at the same place. */
  levelStartPct: number;
  levelEndPct: number;
  /** `levelStartPct − levelEndPct`. Negative when the level rose. */
  dropPts: number;
  /** Litres the engine burned during the stop. Null without AVL 83. */
  engineL: number | null;
  /** Median level 10 to 30 min after leaving, while moving. */
  levelAfterPct: number | null;
  kind: 'refuel' | 'normal';
}

export type CalibrationSource = 'truck' | 'declared' | 'none';

export interface Calibration {
  /** Litres per level point. From the truck's own cycles when there are enough. */
  litersPerPoint: number | null;
  source: CalibrationSource;
  /** Valid cycles between refuels used for `litersPerPoint`. */
  cycles: number;
  /** `litersPerPoint × 100` when it comes from the truck. */
  impliedCapacityL: number | null;
  /** The declared capacity differs more than 15 % from the implied one. */
  capacityMismatch: boolean;
  /** Robust per-stop noise in points (1.4826 × MAD). Drives the event threshold. */
  stopNoisePts: number;
  /** Per-stop standard deviation in points, without |net| ≥ 8. Drives the period floor. */
  stopSigmaPts: number;
}

/**
 * `confirmed`: the balance says litres are missing; the client sees it (D1).
 * `unconfirmed`: a candidate the balance cannot settle; only Booster sees it.
 * `discarded`: the balance says nothing is missing; nobody sees it as a deviation.
 */
export type DeviationStatus = 'confirmed' | 'unconfirmed' | 'discarded';

export type DeviationReason =
  | 'missing_liters'
  | 'balance_ok'
  | 'no_engine_counter'
  | 'no_calibration'
  | 'no_data'
  | 'refuel_nearby';

export interface StopDeviation {
  startMs: number;
  endMs: number;
  lat: number;
  lng: number;
  dropPts: number;
  levelBeforePct: number | null;
  levelAfterPct: number | null;
  engineL: number | null;
  /** Missing litres from the balance; null when it could not be computed. */
  missingL: number | null;
  /** Range of the missing litres: `missingL ± toleranceL`. */
  toleranceL: number | null;
  status: DeviationStatus;
  reason: DeviationReason;
}

export interface StopBalance {
  stops: number;
  /** Signed sum of `drop − engine/L·pt` over the evaluable stops, in points. */
  netPts: number;
  netL: number | null;
  /** Smallest accumulated loss this truck can tell from noise in the period. */
  floorL: number | null;
  exceeds: boolean;
  status: DeviationStatus;
}

export interface FuelAnalysis {
  stops: Stop[];
  calibration: Calibration;
  deviations: StopDeviation[];
  stopBalance: StopBalance;
}
