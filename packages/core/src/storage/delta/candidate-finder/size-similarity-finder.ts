/**
 * SizeSimilarityCandidateFinder - Find delta candidates based on size similarity
 *
 * Based on the observation that similar-sized objects often produce good deltas
 * (e.g., different versions of same file). This is a common heuristic used by
 * Git during pack generation.
 *
 * Replaces the legacy SimilarSizeCandidateStrategy with the new CandidateFinder interface.
 */

import type { ObjectTypeCode } from "../../../objects/object-types.js";
import type { RepositoryAccess } from "../../../repository-access/repository-access.js";
import type {
  CandidateFinder,
  CandidateFinderOptions,
  DeltaCandidate,
  DeltaTarget,
} from "../candidate-finder.js";

/**
 * Options for SizeSimilarityCandidateFinder
 */
export interface SizeSimilarityFinderOptions extends CandidateFinderOptions {
  /** Size tolerance ratio (default: 0.5 = 50% difference allowed) */
  tolerance?: number;
}

/**
 * Internal candidate representation for sorting
 */
interface ScoredCandidate {
  id: string;
  type: ObjectTypeCode;
  size: number;
  similarity: number;
}

/**
 * Find candidates with similar size to target
 *
 * Uses size similarity as a heuristic for content similarity.
 * Objects within the tolerance range are returned, sorted by
 * similarity (closest size first).
 */
export class SizeSimilarityCandidateFinder implements CandidateFinder {
  private readonly tolerance: number;
  private readonly maxCandidates: number;
  private readonly minSimilarity: number;
  private readonly allowedTypes?: ObjectTypeCode[];

  constructor(
    private readonly storage: RepositoryAccess,
    options: SizeSimilarityFinderOptions = {},
  ) {
    this.tolerance = options.tolerance ?? 0.5;
    this.maxCandidates = options.maxCandidates ?? 10;
    this.minSimilarity = options.minSimilarity ?? 0;
    this.allowedTypes = options.allowedTypes;
  }

  async *findCandidates(target: DeltaTarget): AsyncIterable<DeltaCandidate> {
    // Calculate size bounds based on tolerance
    const minSize = Math.floor(target.size * (1 - this.tolerance));
    const maxSize = Math.ceil(target.size * (1 + this.tolerance));

    // Collect candidates with similar sizes
    const candidates: ScoredCandidate[] = [];
    const bufferSize = this.maxCandidates * 2; // Collect extra for sorting

    for await (const info of this.storage.enumerateWithInfo()) {
      // Skip the target itself
      if (info.id === target.id) continue;

      // Check type filter
      if (this.allowedTypes && !this.allowedTypes.includes(info.type)) {
        continue;
      }

      // Check size within tolerance range
      if (info.size < minSize || info.size > maxSize) continue;

      // Calculate similarity based on size difference
      // Closer sizes = higher similarity
      const sizeDiff = Math.abs(info.size - target.size);
      const similarity = 1 - sizeDiff / Math.max(target.size, 1);

      if (similarity < this.minSimilarity) continue;

      candidates.push({
        id: info.id,
        type: info.type,
        size: info.size,
        similarity,
      });

      // Early exit if we have enough candidates for sorting
      if (candidates.length >= bufferSize) {
        break;
      }
    }

    // Sort by similarity (highest first, i.e., closest size)
    candidates.sort((a, b) => b.similarity - a.similarity);

    // Yield top candidates
    let yielded = 0;
    for (const candidate of candidates) {
      if (yielded >= this.maxCandidates) break;

      const result: DeltaCandidate = {
        id: candidate.id,
        type: candidate.type,
        size: candidate.size,
        similarity: candidate.similarity,
        reason: "similar-size",
      };

      yield result;
      yielded++;
    }
  }
}
