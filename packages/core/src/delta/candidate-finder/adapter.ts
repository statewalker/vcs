/**
 * CandidateFinder Adapter
 *
 * Adapts the new CandidateFinder interface to work with the legacy
 * DeltaCandidateStrategy interface used by GCController.
 */

import type { ObjectId } from "../../id/object-id.js";
import type { ObjectTypeCode } from "../../objects/object-types.js";
import type { RawStore } from "../../binary/index.js";
import type { CandidateFinder, DeltaCandidate, DeltaTarget } from "../candidate-finder.js";
import type { DeltaCandidateStrategy } from "../types.js";

/**
 * Options for the adapter
 */
export interface CandidateFinderAdapterOptions {
  /**
   * Maximum candidates to yield (default: 10)
   *
   * Limits the number of candidates returned to prevent excessive computation.
   */
  maxCandidates?: number;

  /**
   * Default object type when not available (default: blob type code 3)
   *
   * Used when the object type cannot be determined from storage.
   */
  defaultType?: ObjectTypeCode;
}

/**
 * Adapts a CandidateFinder to work as a DeltaCandidateStrategy
 *
 * This adapter bridges the new CandidateFinder interface (which uses
 * DeltaTarget with rich metadata) with the legacy DeltaCandidateStrategy
 * interface (which only receives ObjectId and RawStore).
 *
 * @example
 * ```typescript
 * const finder = new CompositeFinder([
 *   new PathBasedFinder(pathIndex, sizeIndex),
 *   new CommitTreeFinder(treeStore),
 * ]);
 *
 * const strategy = new CandidateFinderAdapter(finder);
 *
 * // Use with GCController
 * const gc = new GCController(storage, {
 *   deltaCandidateStrategy: strategy,
 * });
 * ```
 */
export class CandidateFinderAdapter implements DeltaCandidateStrategy {
  private readonly finder: CandidateFinder;
  private readonly maxCandidates: number;
  private readonly defaultType: ObjectTypeCode;

  constructor(finder: CandidateFinder, options: CandidateFinderAdapterOptions = {}) {
    this.finder = finder;
    this.maxCandidates = options.maxCandidates ?? 10;
    this.defaultType = options.defaultType ?? 3; // blob
  }

  async *findCandidates(targetId: ObjectId, storage: RawStore): AsyncIterable<ObjectId> {
    // Build a minimal DeltaTarget from available information
    const size = (await storage.size(targetId)) ?? 0;

    const target: DeltaTarget = {
      id: targetId,
      type: this.defaultType,
      size,
      // path is not available from RawStore - the adapter loses this context
      // For path-aware candidate finding, use CandidateFinder directly
    };

    let count = 0;
    for await (const candidate of this.finder.findCandidates(target)) {
      if (count >= this.maxCandidates) {
        break;
      }
      yield candidate.id;
      count++;
    }
  }
}

/**
 * Adapts a DeltaCandidateStrategy to work as a CandidateFinder
 *
 * This reverse adapter allows using legacy strategies with the new
 * CandidateFinder interface.
 *
 * @example
 * ```typescript
 * const legacyStrategy = new SimilarSizeCandidateStrategy();
 * const finder = new LegacyStrategyAdapter(legacyStrategy, storage);
 *
 * // Use with DeltaEngine
 * const engine = new DefaultDeltaEngine({
 *   candidateFinder: finder,
 *   // ...
 * });
 * ```
 */
export class LegacyStrategyAdapter implements CandidateFinder {
  constructor(
    private readonly strategy: DeltaCandidateStrategy,
    private readonly storage: RawStore,
  ) {}

  async *findCandidates(target: DeltaTarget): AsyncIterable<DeltaCandidate> {
    for await (const id of this.strategy.findCandidates(target.id, this.storage)) {
      // Build DeltaCandidate with minimal info
      const size = (await this.storage.size(id)) ?? 0;

      // Estimate similarity based on size difference
      const sizeDiff = Math.abs(size - target.size);
      const maxSize = Math.max(size, target.size);
      const similarity = maxSize > 0 ? 1 - sizeDiff / maxSize : 0.5;

      yield {
        id,
        type: target.type, // Assume same type as target
        size,
        similarity,
        reason: "similar-size", // Legacy strategies typically use size-based selection
      };
    }
  }
}
