import type {
  CandidateContext,
  DeltaCandidateStrategy,
  ObjectId,
  ObjectStore,
} from "../../interfaces/index.js";

/**
 * Find candidates from recent commits (sliding window)
 *
 * Optimized for the common case where recent versions of files
 * make good delta bases. This follows Git's pack window approach.
 *
 * The window is populated as objects are added via addFromCommit(),
 * and candidates are returned in most-recent-first order.
 */
export class CommitWindowCandidateStrategy implements DeltaCandidateStrategy {
  readonly name = "commit-window";

  private recentObjects: ObjectId[] = [];
  private readonly windowSize: number;

  constructor(options: { windowSize?: number } = {}) {
    this.windowSize = options.windowSize ?? 10;
  }

  /**
   * Add objects from a commit to the window
   *
   * Call this after creating a commit to populate the candidate pool.
   *
   * @param objectIds Objects from the commit (blobs, trees, etc.)
   */
  addFromCommit(objectIds: ObjectId[]): void {
    this.recentObjects.push(...objectIds);
    // Keep window size bounded (maintain 5x window for selection)
    if (this.recentObjects.length > this.windowSize * 10) {
      this.recentObjects = this.recentObjects.slice(-this.windowSize * 5);
    }
  }

  /**
   * Add a single object to the window
   */
  addObject(objectId: ObjectId): void {
    this.recentObjects.push(objectId);
    if (this.recentObjects.length > this.windowSize * 10) {
      this.recentObjects = this.recentObjects.slice(-this.windowSize * 5);
    }
  }

  async *findCandidates(
    targetId: ObjectId,
    _storage: ObjectStore,
    context?: CandidateContext,
  ): AsyncIterable<ObjectId> {
    const limit = context?.limit ?? this.windowSize;

    // Return recent objects (excluding target), most recent first
    let yielded = 0;
    for (let i = this.recentObjects.length - 1; i >= 0 && yielded < limit; i--) {
      const id = this.recentObjects[i];
      if (id !== targetId) {
        yield id;
        yielded++;
      }
    }
  }

  /**
   * Clear the window
   */
  clear(): void {
    this.recentObjects = [];
  }

  /**
   * Get current window size
   */
  getWindowLength(): number {
    return this.recentObjects.length;
  }
}
