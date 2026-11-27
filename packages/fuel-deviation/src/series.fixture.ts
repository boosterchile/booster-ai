import type { FuelPoint } from './types.js';

const MIN = 60_000;
const DEG_PER_KM = 1 / 111;

export interface SeriesOptions {
  capacityL: number;
  startLiters: number;
  startMs?: number;
  withEngineCounter?: boolean;
  withLevel?: boolean;
}

/**
 * Synthetic truck: a point per minute, level from the litres in the tank
 * (rounded to whole points, like AVL 89), engine counter from the litres burned.
 */
export class SeriesBuilder {
  readonly points: FuelPoint[] = [];
  private tMs: number;
  private liters: number;
  private burned = 0;
  private lng = -70.6;
  private readonly lat = -33.45;
  /** Extra points the sensor reads on top of the real level. */
  private offsetPts = 0;
  private offsetDecayPerMin = 0;

  constructor(private readonly opts: SeriesOptions) {
    this.tMs = opts.startMs ?? Date.UTC(2026, 10, 1, 12);
    this.liters = opts.startLiters;
  }

  get nowMs(): number {
    return this.tMs;
  }

  drive(minutes: number, kmh = 60, litersPerHour = 30): this {
    for (let i = 0; i < minutes; i++) {
      this.lng += (kmh / 60) * DEG_PER_KM;
      this.burn(litersPerHour / 60);
      this.push(kmh);
    }
    return this;
  }

  stop(
    minutes: number,
    opts: { extractL?: number; idleLitersPerHour?: number; noise?: number[] } = {},
  ): this {
    const extractAt = Math.floor(minutes / 2);
    for (let i = 0; i < minutes; i++) {
      if (i === extractAt && opts.extractL) {
        this.liters = Math.max(0, this.liters - opts.extractL);
      }
      this.burn((opts.idleLitersPerHour ?? 0) / 60);
      this.push(0, opts.noise?.[i] ?? 0);
    }
    return this;
  }

  /** Refuel during a stop. `settleHighPts` makes the sensor read high and come down over `settleMin`. */
  refuel(
    liters: number,
    opts: { stopMin?: number; settleHighPts?: number; settleMin?: number } = {},
  ): this {
    const stopMin = opts.stopMin ?? 15;
    this.stop(Math.floor(stopMin / 2));
    this.liters = Math.min(this.opts.capacityL, this.liters + liters);
    if (opts.settleHighPts) {
      this.offsetPts = opts.settleHighPts;
      this.offsetDecayPerMin = opts.settleHighPts / (opts.settleMin ?? 180);
    }
    this.stop(stopMin - Math.floor(stopMin / 2));
    return this;
  }

  /** Data gap: time passes, no points. */
  gap(minutes: number): this {
    this.tMs += minutes * MIN;
    return this;
  }

  private burn(liters: number): void {
    this.liters = Math.max(0, this.liters - liters);
    this.burned += liters;
  }

  private push(speedKmh: number, noisePts = 0): void {
    this.tMs += MIN;
    const real = (this.liters / this.opts.capacityL) * 100;
    const level = Math.min(100, Math.max(0, Math.round(real + this.offsetPts + noisePts)));
    if (this.offsetPts > 0) {
      this.offsetPts = Math.max(0, this.offsetPts - this.offsetDecayPerMin);
    }
    this.points.push({
      tMs: this.tMs,
      lat: this.lat,
      lng: this.lng,
      speedKmh,
      levelPct: this.opts.withLevel === false ? null : level,
      engineFuelL:
        this.opts.withEngineCounter === false
          ? null
          : Math.round((100_000 + this.burned) * 10) / 10,
    });
  }
}

/** Honest cycles: a full refuel, then eight legs of 90 min, each followed by a 30 min stop. */
export function honestCycles(builder: SeriesBuilder, cycles: number): SeriesBuilder {
  for (let c = 0; c < cycles; c++) {
    builder.refuel(560, { stopMin: 20 });
    for (let leg = 0; leg < 8; leg++) {
      builder.drive(90, 70, 32).stop(30);
    }
  }
  return builder;
}
