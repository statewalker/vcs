/**
 * Storage Analyzer
 *
 * Examines storage content and produces analysis reports for GC and packing.
 */

import type { ObjectId } from "@statewalker/vcs-core";
import type { PackingContext } from "./packing-orchestrator.js";
import type { AnalyzerOptions, PackingCandidate, StorageAnalysisReport } from "./types.js";

/**
 * Default minimum size for packing consideration (bytes)
 */
const DEFAULT_MIN_SIZE = 50;

/**
 * Storage analyzer that examines storage content and produces analysis reports
 *
 * Supports two discovery modes:
 * - Full storage scan via listObjects()
 * - Commit-rooted traversal for selective analysis with path context
 */
export class StorageAnalyzer {
  /**
   * Analyze all objects in storage using listObjects()
   *
   * This mode enumerates all objects regardless of reachability,
   * enabling orphan detection and comprehensive storage audits.
   *
   * @param context Packing context with all storages
   * @param options Analysis options
   * @returns Analysis report including orphaned objects
   */
  async analyzeAll(
    context: PackingContext,
    options: AnalyzerOptions = {},
  ): Promise<StorageAnalysisReport> {
    const minSize = options.minSize ?? DEFAULT_MIN_SIZE;
    const candidates: PackingCandidate[] = [];

    let totalObjects = 0;
    let fullObjects = 0;
    let deltaObjects = 0;
    let totalStorageSize = 0;
    let totalChainDepth = 0;
    let maxChainDepth = 0;

    // Enumerate all objects
    for await (const objectId of context.objects.keys()) {
      if (options.signal?.aborted) {
        throw new DOMException("Analysis aborted", "AbortError");
      }

      const size = await context.objects.size(objectId);
      if (size < 0) continue;

      totalObjects++;
      totalStorageSize += size;

      const chainInfo = await context.objects.getDeltaChainInfo(objectId);
      if (chainInfo) {
        deltaObjects++;
        totalChainDepth += chainInfo.depth;
        maxChainDepth = Math.max(maxChainDepth, chainInfo.depth);
      } else {
        fullObjects++;
      }

      // Collect candidates for packing
      if (size >= minSize) {
        const depth = chainInfo?.depth ?? 0;
        candidates.push({
          objectId,
          objectType: "blob", // Unknown without tree context
          size,
          currentDepth: depth,
          suggestedBases: [],
        });
      }

      if (options.onProgress) {
        options.onProgress(totalObjects, totalObjects);
      }
    }

    // Estimate savings based on typical compression ratios
    const estimatedSavings = this.estimateSavings(candidates);

    return {
      totalObjects,
      fullObjects,
      deltaObjects,
      averageChainDepth: deltaObjects > 0 ? totalChainDepth / deltaObjects : 0,
      maxChainDepth,
      totalStorageSize,
      estimatedSavings,
      packingCandidates: candidates,
      orphanedObjects: undefined,
    };
  }

  /**
   * Analyze objects reachable from given commits
   *
   * This mode walks from specified commit roots through CommitStore
   * and TreeStore. It provides path context for better candidate
   * selection but won't find orphaned objects.
   *
   * @param context Packing context with all storages
   * @param roots Starting commit IDs
   * @param options Analysis options
   * @returns Analysis report with path information
   */
  async analyzeFromRoots(
    context: PackingContext,
    roots: ObjectId[],
    options: AnalyzerOptions = {},
  ): Promise<StorageAnalysisReport> {
    const minSize = options.minSize ?? DEFAULT_MIN_SIZE;
    const visited = new Set<ObjectId>();
    const candidates: PackingCandidate[] = [];
    const pathMap = new Map<ObjectId, string>();

    let totalObjects = 0;
    let fullObjects = 0;
    let deltaObjects = 0;
    let totalStorageSize = 0;
    let totalChainDepth = 0;
    let maxChainDepth = 0;

    // Walk commit ancestry
    for (const rootId of roots) {
      for await (const commitId of context.commits.walkAncestry(rootId)) {
        if (options.signal?.aborted) {
          throw new DOMException("Analysis aborted", "AbortError");
        }

        if (visited.has(commitId)) continue;
        visited.add(commitId);

        // Get tree for this commit
        const treeId = await context.commits.getTree(commitId);
        await this.walkTree(context, treeId, "", visited, pathMap, options);
      }
    }

    // Analyze collected objects
    for (const [objectId, path] of pathMap) {
      if (options.signal?.aborted) {
        throw new DOMException("Analysis aborted", "AbortError");
      }

      totalObjects++;

      const size = await context.objects.size(objectId);
      if (size < 0) continue;

      totalStorageSize += size;

      const chainInfo = await context.objects.getDeltaChainInfo(objectId);
      if (chainInfo) {
        deltaObjects++;
        totalChainDepth += chainInfo.depth;
        maxChainDepth = Math.max(maxChainDepth, chainInfo.depth);
      } else {
        fullObjects++;
      }

      // Collect candidates with path context
      if (size >= minSize) {
        const depth = chainInfo?.depth ?? 0;
        candidates.push({
          objectId,
          objectType: "blob",
          path,
          size,
          currentDepth: depth,
          suggestedBases: [],
        });
      }

      if (options.onProgress) {
        options.onProgress(totalObjects, pathMap.size);
      }
    }

    const estimatedSavings = this.estimateSavings(candidates);

    return {
      totalObjects,
      fullObjects,
      deltaObjects,
      averageChainDepth: deltaObjects > 0 ? totalChainDepth / deltaObjects : 0,
      maxChainDepth,
      totalStorageSize,
      estimatedSavings,
      packingCandidates: candidates,
    };
  }

  /**
   * Find orphaned objects by comparing full scan with commit-reachable objects
   *
   * @param context Packing context
   * @param roots Commit roots to check reachability from
   * @returns Array of orphaned object IDs
   */
  async findOrphanedObjects(context: PackingContext, roots: ObjectId[]): Promise<ObjectId[]> {
    const reachable = new Set<ObjectId>();
    const visited = new Set<ObjectId>();

    // Collect reachable objects
    for (const rootId of roots) {
      reachable.add(rootId);

      for await (const commitId of context.commits.walkAncestry(rootId)) {
        if (visited.has(commitId)) continue;
        visited.add(commitId);
        reachable.add(commitId);

        const treeId = await context.commits.getTree(commitId);
        await this.collectReachableFromTree(context, treeId, reachable);
      }
    }

    // Find orphans
    const orphans: ObjectId[] = [];
    for await (const objectId of context.objects.keys()) {
      if (!reachable.has(objectId)) {
        orphans.push(objectId);
      }
    }

    return orphans;
  }

  /**
   * Recursively walk a tree and collect blob paths
   */
  private async walkTree(
    context: PackingContext,
    treeId: ObjectId,
    basePath: string,
    visited: Set<ObjectId>,
    pathMap: Map<ObjectId, string>,
    options: AnalyzerOptions,
  ): Promise<void> {
    if (visited.has(treeId)) return;
    visited.add(treeId);

    for await (const entry of context.trees.loadTree(treeId)) {
      if (options.signal?.aborted) {
        throw new DOMException("Analysis aborted", "AbortError");
      }

      const fullPath = basePath ? `${basePath}/${entry.name}` : entry.name;

      if (this.isTreeMode(entry.mode)) {
        // Recurse into subtree
        await this.walkTree(context, entry.id, fullPath, visited, pathMap, options);
      } else {
        // Record blob path
        pathMap.set(entry.id, fullPath);
      }
    }
  }

  /**
   * Collect all objects reachable from a tree
   */
  private async collectReachableFromTree(
    context: PackingContext,
    treeId: ObjectId,
    reachable: Set<ObjectId>,
  ): Promise<void> {
    if (reachable.has(treeId)) return;
    reachable.add(treeId);

    for await (const entry of context.trees.loadTree(treeId)) {
      reachable.add(entry.id);

      if (this.isTreeMode(entry.mode)) {
        await this.collectReachableFromTree(context, entry.id, reachable);
      }
    }
  }

  /**
   * Check if mode indicates a tree (directory)
   */
  private isTreeMode(mode: number): boolean {
    // Tree mode is 040000 (octal)
    return (mode & 0o170000) === 0o040000;
  }

  /**
   * Estimate potential storage savings from packing
   */
  private estimateSavings(candidates: PackingCandidate[]): number {
    let estimatedSavings = 0;

    for (const candidate of candidates) {
      if (candidate.currentDepth === 0) {
        // Full object could potentially be compressed
        estimatedSavings += candidate.size * 0.5;
      }
    }

    return Math.floor(estimatedSavings);
  }
}
