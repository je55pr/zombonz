const NON_ZERO_FALLBACK = 0x6d2b79f5;

/** Scrambles every bit, so seeds that differ only slightly (neighbouring ids, consecutive ticks) still draw differently. */
export function mix32(value: number): number {
  let h = value >>> 0;
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return h >>> 0;
}

/** A stable number for a string (FNV-1a), for seeding by name. */
export function hashString(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  return hash >>> 0;
}

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
