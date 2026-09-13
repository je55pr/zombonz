const NON_ZERO_FALLBACK = 0x6d2b79f5;

export class SeededRng {
  private state: number;

  constructor(seed: number) {
    const normalized = seed >>> 0;
    this.state = normalized === 0 ? NON_ZERO_FALLBACK : normalized;
  }

  nextUint32(): number {
    let x = this.state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x >>> 0;
    return this.state;
  }

  next(): number {
    return this.nextUint32() / 0x1_0000_0000;
  }

  int(minInclusive: number, maxExclusive: number): number {
    if (!Number.isInteger(minInclusive) || !Number.isInteger(maxExclusive) || maxExclusive <= minInclusive) {
      throw new RangeError('Expected integer range with max > min.');
    }
    return minInclusive + Math.floor(this.next() * (maxExclusive - minInclusive));
  }
}
