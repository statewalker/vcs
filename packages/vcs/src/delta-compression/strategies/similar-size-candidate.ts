/**
 * Similar Size Candidate Strategy
 *
 * Finds delta base candidates by looking for objects with similar sizes.
 * Based on the observation that similar-sized objects often produce good deltas.
 */

import type { ObjectId } from "../../object-storage/interfaces/index.js";
import type { DeltaCandidateStrategy, ObjectStorage } from "../types.js";

/**
 * Strategy options
 */
export interface SimilarSizeCandidateOptions {
  /** Size tolerance ratio (default: 0.5 = 50% difference allowed) */
  tolerance?: number;
  /** Maximum candidates to return (default: 10) */
  maxCandidates?: number;
}

/**
 * Find candidates with similar size to target
 *
 * Based on the observation that similar-sized objects often
 * produce good deltas (e.g., different versions of same file).
 * This is a common heuristic used by Git during pack generation.
 */
export class SimilarSizeCandidateStrategy implements DeltaCandidateStrategy {
  readonly name = "similar-size";

  private readonly tolerance: number;
  private readonly maxCandidates: number;

  constructor(options: SimilarSizeCandidateOptions = {}) {
    this.tolerance = options.tolerance ?? 0.5;
    this.maxCandidates = options.maxCandidates ?? 10;
  }

  async *findCandidates(targetId: ObjectId, storage: ObjectStorage): AsyncIterable<ObjectId> {
    // Get target size
    const targetSize = await storage.getSize(targetId);
    if (targetSize <= 0) return;

    // Calculate size bounds
    const minSize = Math.floor(targetSize * (1 - this.tolerance));
    const maxSize = Math.ceil(targetSize * (1 + this.tolerance));

    // Collect candidates with similar sizes
    const candidates: Array<{ id: ObjectId; size: number; diff: number }> = [];

    for await (const id of storage.listObjects()) {
      if (id === targetId) continue;

      const size = await storage.getSize(id);
      if (size >= minSize && size <= maxSize) {
        const diff = Math.abs(size - targetSize);
        candidates.push({ id, size, diff });
      }

      // Early exit if we have enough candidates (with buffer for sorting)
      if (candidates.length >= this.maxCandidates * 2) {
        break;
      }
    }

    // Sort by size difference (closest first)
    candidates.sort((a, b) => a.diff - b.diff);

    // Yield top candidates
    let yielded = 0;
    for (const candidate of candidates) {
      if (yielded >= this.maxCandidates) break;
      yield candidate.id;
      yielded++;
    }
  }
}
