import type {
  CandidateContext,
  DeltaCandidateStrategy,
  ObjectId,
  ObjectStorage,
} from "@webrun-vcs/storage";

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

  constructor(
    options: {
      /** Size tolerance ratio (default: 0.5 = 50% difference allowed) */
      tolerance?: number;
      /** Maximum candidates to return (default: 10) */
      maxCandidates?: number;
    } = {},
  ) {
    this.tolerance = options.tolerance ?? 0.5;
    this.maxCandidates = options.maxCandidates ?? 10;
  }

  async *findCandidates(
    targetId: ObjectId,
    storage: ObjectStorage,
    context?: CandidateContext,
  ): AsyncIterable<ObjectId> {
    const maxCandidates = context?.limit ?? this.maxCandidates;

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
      if (candidates.length >= maxCandidates * 2) {
        break;
      }
    }

    // Sort by size difference (closest first)
    candidates.sort((a, b) => a.diff - b.diff);

    // Yield top candidates
    let yielded = 0;
    for (const candidate of candidates) {
      if (yielded >= maxCandidates) break;
      yield candidate.id;
      yielded++;
    }
  }
}
