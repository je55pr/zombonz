export interface FixedStepClockOptions {
  tickRate?: number;
  maxFrameSeconds?: number;
}

export class FixedStepClock {
  readonly tickRate: number;
  readonly stepSeconds: number;
  private readonly maxFrameSeconds: number;
  private accumulatorSeconds = 0;

  constructor(options: FixedStepClockOptions = {}) {
    this.tickRate = options.tickRate ?? 60;
    if (!Number.isFinite(this.tickRate) || this.tickRate <= 0) {
      throw new RangeError('tickRate must be positive.');
    }
    this.stepSeconds = 1 / this.tickRate;
    this.maxFrameSeconds = options.maxFrameSeconds ?? 0.25;
  }

  advance(frameSeconds: number, step: (dt: number) => void): number {
    if (!Number.isFinite(frameSeconds) || frameSeconds < 0) {
      throw new RangeError('frameSeconds must be finite and non-negative.');
    }
    this.accumulatorSeconds += Math.min(frameSeconds, this.maxFrameSeconds);
    let ticks = 0;
    while (this.accumulatorSeconds + Number.EPSILON >= this.stepSeconds) {
      step(this.stepSeconds);
      this.accumulatorSeconds -= this.stepSeconds;
      ticks += 1;
    }
    return ticks;
  }

  interpolationAlpha(): number {
    return this.accumulatorSeconds / this.stepSeconds;
  }

  reset(): void {
    this.accumulatorSeconds = 0;
  }
}
