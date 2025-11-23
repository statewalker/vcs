import type { RawText } from "./raw-text.js";
import type { SequenceComparator } from "./sequence.js";

/**
 * Comparator for RawText sequences.
 *
 * Compares lines of text using byte-by-byte comparison.
 */
export class RawTextComparator implements SequenceComparator<RawText> {
  /** Default singleton instance */
  static readonly DEFAULT = new RawTextComparator();

  /**
   * Compare two items to determine if they are equal.
   *
   * @param a First sequence
   * @param ai Index of line in first sequence
   * @param b Second sequence
   * @param bi Index of line in second sequence
   * @returns true if the lines are equal
   */
  equals(a: RawText, ai: number, b: RawText, bi: number): boolean {
    const aRaw = a.getRawString(ai);
    const bRaw = b.getRawString(bi);

    if (aRaw.length !== bRaw.length) {
      return false;
    }

    for (let i = 0; i < aRaw.length; i++) {
      if (aRaw[i] !== bRaw[i]) {
        return false;
      }
    }

    return true;
  }

  /**
   * Get the hash code for a line in a sequence.
   *
   * Uses a simple hash algorithm similar to Java's String.hashCode().
   *
   * @param seq Sequence
   * @param index Index of line
   * @returns Hash code for the line
   */
  hash(seq: RawText, index: number): number {
    const raw = seq.getRawString(index);
    let hash = 5381;

    for (let i = 0; i < raw.length; i++) {
      hash = (hash << 5) + hash + raw[i]; // hash * 33 + c
      // Keep hash as 32-bit signed integer
      hash = hash | 0;
    }

    return hash;
  }
}
