import type { ObjectId } from "@webrun-vcs/storage";
import type { CandidateSelectorOptions, PackingContext } from "./types.js";

/**
 * Candidate with size information for sorting
 */
interface SizedCandidate {
  id: ObjectId;
  size: number;
}

/**
 * Default minimum size ratio (target must be at least base/16)
 * Following JGit's heuristic for candidate filtering
 */
const DEFAULT_MIN_SIZE_RATIO = 1 / 16;

/**
 * Default maximum number of candidates to return
 */
const DEFAULT_MAX_CANDIDATES = 10;

/**
 * Selects delta base candidates using various strategies
 *
 * All strategies work exclusively with the provided storages
 * and must not rely on repository-level abstractions.
 */
export class CandidateSelector {
  /**
   * Find candidate base objects using size-based strategy
   *
   * Groups objects by similar sizes. Objects with similar sizes
   * are more likely to produce good deltas. Following JGit's heuristic,
   * skips candidates where targetSize < baseSize / 16.
   *
   * Candidates are sorted by size (descending) per "Linus' Law" -
   * larger objects are tested first as potential bases.
   *
   * @param context Packing context with all storages
   * @param targetId Object to deltify
   * @param options Selection options
   * @returns Array of candidate base object IDs, ordered by preference
   */
  async findCandidatesBySize(
    context: PackingContext,
    targetId: ObjectId,
    options: CandidateSelectorOptions = {}
  ): Promise<ObjectId[]> {
    const maxCandidates = options.maxCandidates ?? DEFAULT_MAX_CANDIDATES;
    const minSizeRatio = options.minSizeRatio ?? DEFAULT_MIN_SIZE_RATIO;
    const includeDeltaObjects = options.includeDeltaObjects ?? false;

    const targetInfo = await context.objects.getInfo(targetId);
    if (!targetInfo) {
      return []; // Target doesn't exist
    }
    const targetSize = targetInfo.size;

    const candidates: SizedCandidate[] = [];

    for await (const candidateInfo of context.objects.listObjects()) {
      // Skip self
      if (candidateInfo.id === targetId) continue;

      const candidateSize = candidateInfo.size;

      // Apply size ratio filtering (JGit heuristic)
      // Skip if target is too small relative to candidate
      if (targetSize < candidateSize * minSizeRatio) continue;

      // Apply maximum size ratio if specified
      if (
        options.maxSizeRatio !== undefined &&
        targetSize > candidateSize * options.maxSizeRatio
      ) {
        continue;
      }

      // Optionally skip objects already stored as deltas
      if (!includeDeltaObjects) {
        const isDelta = await context.objects.isDelta(candidateInfo.id);
        if (isDelta) continue;
      }

      candidates.push({ id: candidateInfo.id, size: candidateSize });
    }

    // Sort by size descending (larger bases first - "Linus' Law")
    candidates.sort((a, b) => b.size - a.size);

    // Return top candidates
    return candidates.slice(0, maxCandidates).map((c) => c.id);
  }

  /**
   * Find candidate base objects using path-based strategy
   *
   * Groups objects by their file paths. Files in the same directory
   * or with similar names often share content. Requires path information
   * from tree walking.
   *
   * @param context Packing context with all storages
   * @param targetId Object to deltify
   * @param targetPath Path of the target object
   * @param pathToBlobMap Map from paths to blob IDs
   * @param options Selection options
   * @returns Array of candidate base object IDs, ordered by preference
   */
  async findCandidatesByPath(
    context: PackingContext,
    targetId: ObjectId,
    targetPath: string,
    pathToBlobMap: Map<string, ObjectId[]>,
    options: CandidateSelectorOptions = {}
  ): Promise<ObjectId[]> {
    const maxCandidates = options.maxCandidates ?? DEFAULT_MAX_CANDIDATES;
    const candidates: SizedCandidate[] = [];

    // Get directory of target
    const targetDir = this.getDirectory(targetPath);
    const targetExt = this.getExtension(targetPath);

    // Priority 1: Same path (different versions)
    const samePath = pathToBlobMap.get(targetPath) ?? [];
    for (const blobId of samePath) {
      if (blobId !== targetId) {
        const info = await context.objects.getInfo(blobId);
        if (info) {
          candidates.push({ id: blobId, size: info.size });
        }
      }
    }

    // Priority 2: Same directory
    for (const [path, blobs] of pathToBlobMap) {
      if (path === targetPath) continue;
      if (this.getDirectory(path) !== targetDir) continue;

      for (const blobId of blobs) {
        if (blobId !== targetId && !candidates.some((c) => c.id === blobId)) {
          const info = await context.objects.getInfo(blobId);
          if (info) {
            candidates.push({ id: blobId, size: info.size });
          }
        }
      }
    }

    // Priority 3: Same extension anywhere
    for (const [path, blobs] of pathToBlobMap) {
      if (this.getExtension(path) !== targetExt) continue;

      for (const blobId of blobs) {
        if (blobId !== targetId && !candidates.some((c) => c.id === blobId)) {
          const info = await context.objects.getInfo(blobId);
          if (info) {
            candidates.push({ id: blobId, size: info.size });
          }
        }
      }
    }

    // Sort by size descending
    candidates.sort((a, b) => b.size - a.size);

    return candidates.slice(0, maxCandidates).map((c) => c.id);
  }

  /**
   * Find candidate base objects using tree-walking strategy
   *
   * Traces file history by comparing trees across commits.
   * Identifies which blobs represent different versions of the same logical file.
   *
   * @param context Packing context with all storages
   * @param targetId Object to deltify
   * @param commitRoots Commit roots to walk from
   * @param options Selection options
   * @returns Array of candidate base object IDs, ordered by preference
   */
  async findCandidatesByTreeWalking(
    context: PackingContext,
    targetId: ObjectId,
    commitRoots: ObjectId[],
    options: CandidateSelectorOptions = {}
  ): Promise<ObjectId[]> {
    const maxCandidates = options.maxCandidates ?? DEFAULT_MAX_CANDIDATES;

    // Build path history by walking commits
    const pathHistory = await this.buildPathHistory(context, commitRoots);

    // Find paths where target appears
    const targetPaths: string[] = [];
    for (const [path, versions] of pathHistory) {
      if (versions.some((v) => v.blobId === targetId)) {
        targetPaths.push(path);
      }
    }

    // Collect other versions from same paths
    const candidates: SizedCandidate[] = [];
    for (const path of targetPaths) {
      const versions = pathHistory.get(path) ?? [];
      for (const version of versions) {
        if (version.blobId !== targetId) {
          const info = await context.objects.getInfo(version.blobId);
          if (info && !candidates.some((c) => c.id === version.blobId)) {
            candidates.push({ id: version.blobId, size: info.size });
          }
        }
      }
    }

    // Sort by size descending
    candidates.sort((a, b) => b.size - a.size);

    return candidates.slice(0, maxCandidates).map((c) => c.id);
  }

  /**
   * Combined strategy using all available information
   *
   * @param context Packing context
   * @param targetId Object to deltify
   * @param pathInfo Optional path information
   * @param commitRoots Optional commit roots for history
   * @param options Selection options
   * @returns Array of candidate base object IDs
   */
  async findCandidates(
    context: PackingContext,
    targetId: ObjectId,
    pathInfo?: {
      path: string;
      pathToBlobMap: Map<string, ObjectId[]>;
    },
    commitRoots?: ObjectId[],
    options: CandidateSelectorOptions = {}
  ): Promise<ObjectId[]> {
    const allCandidates = new Set<ObjectId>();
    const maxCandidates = options.maxCandidates ?? DEFAULT_MAX_CANDIDATES;

    // Try tree-walking strategy first (most accurate)
    if (commitRoots && commitRoots.length > 0) {
      const treeCandidates = await this.findCandidatesByTreeWalking(
        context,
        targetId,
        commitRoots,
        options
      );
      for (const c of treeCandidates) allCandidates.add(c);
    }

    // Add path-based candidates
    if (pathInfo) {
      const pathCandidates = await this.findCandidatesByPath(
        context,
        targetId,
        pathInfo.path,
        pathInfo.pathToBlobMap,
        options
      );
      for (const c of pathCandidates) allCandidates.add(c);
    }

    // Fill remaining slots with size-based candidates
    if (allCandidates.size < maxCandidates) {
      const sizeCandidates = await this.findCandidatesBySize(
        context,
        targetId,
        { ...options, maxCandidates: maxCandidates - allCandidates.size }
      );
      for (const c of sizeCandidates) allCandidates.add(c);
    }

    return Array.from(allCandidates).slice(0, maxCandidates);
  }

  /**
   * Build path history from commit ancestry
   */
  private async buildPathHistory(
    context: PackingContext,
    commitRoots: ObjectId[]
  ): Promise<Map<string, Array<{ commitId: ObjectId; blobId: ObjectId }>>> {
    const pathHistory = new Map<
      string,
      Array<{ commitId: ObjectId; blobId: ObjectId }>
    >();
    const visitedCommits = new Set<ObjectId>();

    for (const rootId of commitRoots) {
      for await (const commitId of context.commits.walkAncestry(rootId)) {
        if (visitedCommits.has(commitId)) continue;
        visitedCommits.add(commitId);

        const treeId = await context.commits.getTree(commitId);
        await this.collectPathsFromTree(
          context,
          treeId,
          "",
          commitId,
          pathHistory
        );
      }
    }

    return pathHistory;
  }

  /**
   * Recursively collect paths from a tree
   */
  private async collectPathsFromTree(
    context: PackingContext,
    treeId: ObjectId,
    basePath: string,
    commitId: ObjectId,
    pathHistory: Map<string, Array<{ commitId: ObjectId; blobId: ObjectId }>>
  ): Promise<void> {
    for await (const entry of context.trees.loadTree(treeId)) {
      const fullPath = basePath ? `${basePath}/${entry.name}` : entry.name;

      if (this.isTreeMode(entry.mode)) {
        await this.collectPathsFromTree(
          context,
          entry.id,
          fullPath,
          commitId,
          pathHistory
        );
      } else {
        const versions = pathHistory.get(fullPath) ?? [];
        // Only add if this blob is not already recorded for this path
        if (!versions.some((v) => v.blobId === entry.id)) {
          versions.push({ commitId, blobId: entry.id });
          pathHistory.set(fullPath, versions);
        }
      }
    }
  }

  private isTreeMode(mode: number): boolean {
    return (mode & 0o170000) === 0o040000;
  }

  private getDirectory(path: string): string {
    const lastSlash = path.lastIndexOf("/");
    return lastSlash >= 0 ? path.substring(0, lastSlash) : "";
  }

  private getBasename(path: string): string {
    const lastSlash = path.lastIndexOf("/");
    return lastSlash >= 0 ? path.substring(lastSlash + 1) : path;
  }

  private getExtension(path: string): string {
    const basename = this.getBasename(path);
    const lastDot = basename.lastIndexOf(".");
    return lastDot >= 0 ? basename.substring(lastDot) : "";
  }
}
