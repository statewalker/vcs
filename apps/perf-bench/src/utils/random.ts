/**
 * Simple seeded random number generator (LCG)
 * Provides reproducible random sequences for benchmark consistency
 */
export class SeededRandom {
  private seed: number;

  constructor(seed: number) {
    this.seed = seed;
  }

  next(): number {
    this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff;
    return this.seed / 0x7fffffff;
  }

  nextInt(max: number): number {
    return Math.floor(this.next() * max);
  }

  nextByte(): number {
    return this.nextInt(256);
  }
}

/**
 * Generate random bytes with a seeded generator
 */
export function generateRandomBytes(size: number, random: SeededRandom): Uint8Array {
  const buffer = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    buffer[i] = random.nextByte();
  }
  return buffer;
}

/**
 * Calculate the actual mutation degree between source and target
 */
export function calculateMutationDegree(source: Uint8Array, target: Uint8Array): number {
  const minLen = Math.min(source.length, target.length);
  if (minLen === 0) {
    return source.length === target.length ? 0 : 1;
  }

  let differences = 0;
  for (let i = 0; i < minLen; i++) {
    if (source[i] !== target[i]) {
      differences++;
    }
  }

  const sizeDiff = Math.abs(source.length - target.length);
  differences += sizeDiff;

  const maxLen = Math.max(source.length, target.length);
  return differences / maxLen;
}

/**
 * Generate target data with controlled mutations from source
 */
export function generateMutatedTarget(
  source: Uint8Array,
  targetSize: number,
  mutationDegree: number,
  random: SeededRandom
): Uint8Array {
  if (targetSize === 0) {
    return new Uint8Array(0);
  }

  const target = new Uint8Array(targetSize);

  if (mutationDegree === 0) {
    // No mutations: copy source
    for (let i = 0; i < targetSize; i++) {
      target[i] = source[i % source.length];
    }
  } else if (mutationDegree >= 1) {
    // Complete mutation: generate new data
    for (let i = 0; i < targetSize; i++) {
      target[i] = random.nextByte();
    }
  } else {
    // Partial mutation: mix copied and mutated blocks
    let sourcePos = 0;
    let targetPos = 0;

    while (targetPos < targetSize) {
      const shouldMutate = random.next() < mutationDegree;

      if (shouldMutate) {
        const mutationLen = Math.min(Math.max(1, random.nextInt(32)), targetSize - targetPos);
        for (let i = 0; i < mutationLen; i++) {
          target[targetPos++] = random.nextByte();
        }
      } else {
        const copyLen = Math.min(Math.max(1, random.nextInt(64)), targetSize - targetPos);

        if (random.next() < 0.3 && source.length > 0) {
          sourcePos = random.nextInt(source.length);
        }

        for (let i = 0; i < copyLen; i++) {
          target[targetPos++] = source[sourcePos % source.length];
          sourcePos++;
        }
      }
    }
  }

  return target;
}
