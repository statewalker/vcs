/**
 * Simple in-memory Staging implementation
 *
 * Useful for:
 * - Testing
 * - Non-Git backends (SQL, KV)
 * - Temporary staging operations
 *
 * This implementation stores entries in memory without any persistence.
 */

import { FileMode } from "../../common/files/index.js";
import type { ObjectId } from "../../common/id/index.js";
import type { TreeEntry } from "../../history/trees/tree-entry.js";
import type { TreeStore } from "../../history/trees/tree-store.js";
import type { Trees } from "../../history/trees/trees.js";
import type {
  ConflictResolution,
  EntryIteratorOptions,
  IndexBuilder,
  IndexEdit,
  IndexEditor,
  IndexEntry,
  IndexEntryOptions,
  ReadTreeOptions,
  Staging,
} from "./staging.js";
import { MergeStage, type MergeStageValue } from "./types.js";

/**
 * Simple in-memory Staging implementation
 */
export class SimpleStaging implements Staging {
  private _entries: IndexEntry[] = [];
  private updateTime = Date.now();

  // ============ Entry Operations ============

  async getEntryCount(): Promise<number> {
    return this._entries.length;
  }

  async hasEntry(path: string): Promise<boolean> {
    return this._entries.some((e) => e.path === path);
  }

  async getEntry(
    path: string,
    stage: MergeStageValue = MergeStage.MERGED,
  ): Promise<IndexEntry | undefined> {
    return this._entries.find((e) => e.path === path && e.stage === stage);
  }

  async getEntries(path: string): Promise<IndexEntry[]> {
    return this._entries.filter((e) => e.path === path);
  }

  async setEntry(entryOrOptions: IndexEntry | IndexEntryOptions): Promise<void> {
    const entry = this.normalizeEntry(entryOrOptions);
    const index = this._entries.findIndex((e) => e.path === entry.path && e.stage === entry.stage);

    if (index >= 0) {
      this._entries[index] = entry;
    } else {
      this._entries.push(entry);
      this.sortEntries();
    }
    this.updateTime = Date.now();
  }

  async removeEntry(path: string, stage?: MergeStageValue): Promise<boolean> {
    const beforeLength = this._entries.length;

    if (stage !== undefined) {
      this._entries = this._entries.filter((e) => !(e.path === path && e.stage === stage));
    } else {
      this._entries = this._entries.filter((e) => e.path !== path);
    }

    const removed = this._entries.length < beforeLength;
    if (removed) {
      this.updateTime = Date.now();
    }
    return removed;
  }

  async *entries(options?: EntryIteratorOptions): AsyncIterable<IndexEntry> {
    for (const entry of this._entries) {
      // Filter by prefix
      if (options?.prefix) {
        const prefix = options.prefix.endsWith("/") ? options.prefix : `${options.prefix}/`;
        if (!entry.path.startsWith(prefix) && entry.path !== options.prefix) {
          continue;
        }
      }

      // Filter by stages
      if (options?.stages && options.stages.length > 0) {
        if (!options.stages.includes(entry.stage)) {
          continue;
        }
      }

      yield entry;
    }
  }

  // ============ Conflict Handling ============

  async hasConflicts(): Promise<boolean> {
    return this._entries.some((e) => e.stage !== MergeStage.MERGED);
  }

  async getConflictedPaths(): Promise<string[]> {
    const seen = new Set<string>();
    const paths: string[] = [];

    for (const entry of this._entries) {
      if (entry.stage !== MergeStage.MERGED && !seen.has(entry.path)) {
        seen.add(entry.path);
        paths.push(entry.path);
      }
    }

    return paths;
  }

  async resolveConflict(path: string, resolution: ConflictResolution): Promise<void> {
    const pathEntries = await this.getEntries(path);
    if (pathEntries.length === 0) return;

    let resolvedEntry: IndexEntry;

    if (typeof resolution === "object") {
      // Custom entry provided
      resolvedEntry = { ...resolution, stage: MergeStage.MERGED };
    } else {
      // Select from existing stages
      const stageMap: Record<string, MergeStageValue> = {
        ours: MergeStage.OURS,
        theirs: MergeStage.THEIRS,
        base: MergeStage.BASE,
      };
      const stage = stageMap[resolution];
      const sourceEntry = pathEntries.find((e) => e.stage === stage);

      if (!sourceEntry) {
        throw new Error(`No ${resolution} version for ${path}`);
      }
      resolvedEntry = { ...sourceEntry, stage: MergeStage.MERGED };
    }

    // Remove all stages for this path
    await this.removeEntry(path);

    // Add resolved entry as stage 0
    await this.setEntry(resolvedEntry);
  }

  // ============ Tree Operations ============

  async writeTree(trees: Trees | TreeStore): Promise<ObjectId> {
    // Check for conflicts
    if (await this.hasConflicts()) {
      throw new Error("Cannot write tree with unresolved conflicts");
    }

    // Build tree from stage 0 entries only
    const stage0 = this._entries.filter((e) => e.stage === MergeStage.MERGED);
    return this.buildTreeRecursive(trees, stage0, "");
  }

  private async buildTreeRecursive(
    trees: Trees | TreeStore,
    entries: IndexEntry[],
    prefix: string,
  ): Promise<ObjectId> {
    const treeEntries: TreeEntry[] = [];
    const subdirs = new Map<string, IndexEntry[]>();

    for (const entry of entries) {
      // Get path relative to current prefix
      const relativePath = prefix ? entry.path.slice(prefix.length + 1) : entry.path;
      const slashIndex = relativePath.indexOf("/");

      if (slashIndex < 0) {
        // Direct child - add to tree
        treeEntries.push({
          name: relativePath,
          mode: entry.mode,
          id: entry.objectId,
        });
      } else {
        // In subdirectory - collect for recursive processing
        const dirName = relativePath.slice(0, slashIndex);
        if (!subdirs.has(dirName)) {
          subdirs.set(dirName, []);
        }
        subdirs.get(dirName)?.push(entry);
      }
    }

    // Recursively build subdirectories
    for (const [dirName, dirEntries] of subdirs) {
      const subPrefix = prefix ? `${prefix}/${dirName}` : dirName;
      const subtreeId = await this.buildTreeRecursive(trees, dirEntries, subPrefix);
      treeEntries.push({
        name: dirName,
        mode: FileMode.TREE,
        id: subtreeId,
      });
    }

    return storeTreeEntries(trees, treeEntries);
  }

  async readTree(
    trees: Trees | TreeStore,
    treeId: ObjectId,
    options?: ReadTreeOptions,
  ): Promise<void> {
    if (!options?.keepExisting) {
      this._entries = [];
    }

    const prefix = options?.prefix ?? "";
    const stage = options?.stage ?? MergeStage.MERGED;

    await this.addTreeRecursive(trees, treeId, prefix, stage);
    this.sortEntries();
    this.updateTime = Date.now();
  }

  private async addTreeRecursive(
    trees: Trees | TreeStore,
    treeId: ObjectId,
    prefix: string,
    stage: MergeStageValue,
  ): Promise<void> {
    const treeEntries = await loadTreeEntries(trees, treeId);
    if (!treeEntries) return;

    for await (const entry of treeEntries) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;

      if (entry.mode === FileMode.TREE) {
        await this.addTreeRecursive(trees, entry.id, path, stage);
      } else {
        this._entries.push({
          path,
          mode: entry.mode,
          objectId: entry.id,
          stage,
          size: 0,
          mtime: 0,
        });
      }
    }
  }

  // ============ Bulk Operations ============

  createBuilder(): IndexBuilder {
    return new SimpleStagingBuilder(this);
  }

  createEditor(): IndexEditor {
    return new SimpleStagingEditor(this);
  }

  // ============ Persistence ============

  async read(): Promise<void> {
    // No-op for in-memory staging
  }

  async write(): Promise<void> {
    // No-op for in-memory staging
    this.updateTime = Date.now();
  }

  async isOutdated(): Promise<boolean> {
    // In-memory staging is never outdated
    return false;
  }

  getUpdateTime(): number {
    return this.updateTime;
  }

  async clear(): Promise<void> {
    this._entries = [];
    this.updateTime = Date.now();
  }

  // ============ Internal Methods ============

  private normalizeEntry(entryOrOptions: IndexEntry | IndexEntryOptions): IndexEntry {
    if ("path" in entryOrOptions && "mode" in entryOrOptions && "objectId" in entryOrOptions) {
      const entry = entryOrOptions as IndexEntry;
      return {
        path: entry.path,
        mode: entry.mode,
        objectId: entry.objectId,
        stage: entry.stage ?? MergeStage.MERGED,
        size: entry.size ?? 0,
        mtime: entry.mtime ?? Date.now(),
        ctime: entry.ctime,
        dev: entry.dev,
        ino: entry.ino,
        assumeValid: entry.assumeValid,
        intentToAdd: entry.intentToAdd,
        skipWorktree: entry.skipWorktree,
      };
    }

    const options = entryOrOptions as IndexEntryOptions;
    return {
      path: options.path,
      mode: options.mode,
      objectId: options.objectId,
      stage: options.stage ?? MergeStage.MERGED,
      size: options.size ?? 0,
      mtime: options.mtime ?? Date.now(),
      ctime: options.ctime,
      dev: options.dev,
      ino: options.ino,
      assumeValid: options.assumeValid,
      intentToAdd: options.intentToAdd,
      skipWorktree: options.skipWorktree,
    };
  }

  private sortEntries(): void {
    this._entries.sort((a, b) => {
      const pathCmp = comparePaths(a.path, b.path);
      if (pathCmp !== 0) return pathCmp;
      return a.stage - b.stage;
    });
  }

  /** @internal - Used by builder/editor */
  _replaceEntries(newEntries: IndexEntry[]): void {
    this._entries = newEntries;
    this.updateTime = Date.now();
  }

  /** @internal - Used by builder/editor */
  _getEntries(): IndexEntry[] {
    return this._entries;
  }
}

/**
 * Builder for bulk staging area modifications.
 */
class SimpleStagingBuilder implements IndexBuilder {
  private entries: IndexEntry[] = [];
  private keeping: Array<{ start: number; count: number }> = [];

  constructor(private readonly store: SimpleStaging) {}

  add(options: IndexEntryOptions): void {
    const entry: IndexEntry = {
      path: options.path,
      mode: options.mode,
      objectId: options.objectId,
      stage: options.stage ?? MergeStage.MERGED,
      size: options.size ?? 0,
      mtime: options.mtime ?? Date.now(),
      ctime: options.ctime,
      dev: options.dev,
      ino: options.ino,
      assumeValid: options.assumeValid,
      intentToAdd: options.intentToAdd,
      skipWorktree: options.skipWorktree,
    };

    this.entries.push(entry);
  }

  keep(startIndex: number, count: number): void {
    this.keeping.push({ start: startIndex, count });
  }

  async addTree(
    trees: Trees,
    treeId: ObjectId,
    prefix: string,
    stage: MergeStageValue = MergeStage.MERGED,
  ): Promise<void> {
    await this.addTreeRecursive(trees, treeId, prefix, stage);
  }

  private async addTreeRecursive(
    trees: Trees | TreeStore,
    treeId: ObjectId,
    prefix: string,
    stage: MergeStageValue,
  ): Promise<void> {
    const treeEntries = await loadTreeEntries(trees, treeId);
    if (!treeEntries) return;

    for await (const entry of treeEntries) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;

      if (entry.mode === FileMode.TREE) {
        await this.addTreeRecursive(trees, entry.id, path, stage);
      } else {
        this.add({
          path,
          mode: entry.mode,
          objectId: entry.id,
          stage,
        });
      }
    }
  }

  async finish(): Promise<void> {
    // Merge kept entries from existing index
    const existingEntries = this.store._getEntries();
    for (const { start, count } of this.keeping) {
      for (let i = 0; i < count; i++) {
        if (start + i < existingEntries.length) {
          this.entries.push(existingEntries[start + i]);
        }
      }
    }

    // Sort entries by (path, stage)
    this.entries.sort((a: IndexEntry, b: IndexEntry) => {
      const pathCmp = comparePaths(a.path, b.path);
      if (pathCmp !== 0) return pathCmp;
      return a.stage - b.stage;
    });

    // Check for duplicates
    for (let i = 1; i < this.entries.length; i++) {
      const prev = this.entries[i - 1];
      const curr = this.entries[i];
      if (prev.path === curr.path && prev.stage === curr.stage) {
        throw new Error(`Duplicate entry: ${curr.path} stage ${curr.stage}`);
      }
    }

    // Validate stage constraints
    this.validateStages();

    // Replace store entries
    this.store._replaceEntries(this.entries);
  }

  private validateStages(): void {
    // If stage 0 exists for a path, no other stages should exist
    const pathStages = new Map<string, Set<MergeStageValue>>();

    for (const entry of this.entries) {
      if (!pathStages.has(entry.path)) {
        pathStages.set(entry.path, new Set());
      }
      pathStages.get(entry.path)?.add(entry.stage);
    }

    for (const [path, stages] of pathStages) {
      if (stages.has(MergeStage.MERGED) && stages.size > 1) {
        throw new Error(`Invalid stages for ${path}: stage 0 cannot coexist with other stages`);
      }
    }
  }
}

/**
 * Editor for targeted staging area modifications.
 */
class SimpleStagingEditor implements IndexEditor {
  private edits: IndexEdit[] = [];
  private removals: Array<{ path: string; stage?: MergeStageValue }> = [];
  private upserts: IndexEntryOptions[] = [];

  constructor(private readonly store: SimpleStaging) {}

  add(edit: IndexEdit): void {
    this.edits.push(edit);
  }

  remove(path: string, stage?: MergeStageValue): void {
    this.removals.push({ path, stage });
  }

  upsert(entry: IndexEntryOptions): void {
    this.upserts.push(entry);
  }

  async finish(): Promise<void> {
    const existingEntries = this.store._getEntries();
    const newEntries: IndexEntry[] = [];
    const processedPaths = new Set<string>();

    // First, copy entries that aren't being edited/removed
    for (const entry of existingEntries) {
      // Check if this entry should be removed
      const shouldRemove = this.removals.some((r) => {
        if (r.path !== entry.path) return false;
        if (r.stage === undefined) return true;
        return r.stage === entry.stage;
      });

      if (shouldRemove) continue;

      // Check if this entry has an edit
      const edit = this.edits.find((e) => e.path === entry.path);
      if (edit) {
        const result = edit.apply(entry);
        if (result) newEntries.push(result);
        processedPaths.add(entry.path);
      } else {
        newEntries.push(entry);
      }
    }

    // Apply edits to paths that didn't exist (insertions)
    for (const edit of this.edits) {
      if (!processedPaths.has(edit.path)) {
        const result = edit.apply(undefined);
        if (result) newEntries.push(result);
      }
    }

    // Apply upserts
    for (const upsertOptions of this.upserts) {
      const entry: IndexEntry = {
        path: upsertOptions.path,
        mode: upsertOptions.mode,
        objectId: upsertOptions.objectId,
        stage: upsertOptions.stage ?? MergeStage.MERGED,
        size: upsertOptions.size ?? 0,
        mtime: upsertOptions.mtime ?? Date.now(),
        ctime: upsertOptions.ctime,
        dev: upsertOptions.dev,
        ino: upsertOptions.ino,
        assumeValid: upsertOptions.assumeValid,
        intentToAdd: upsertOptions.intentToAdd,
        skipWorktree: upsertOptions.skipWorktree,
      };

      // Remove existing entry with same path/stage
      const existingIdx = newEntries.findIndex(
        (e) => e.path === entry.path && e.stage === entry.stage,
      );
      if (existingIdx >= 0) {
        newEntries.splice(existingIdx, 1);
      }

      newEntries.push(entry);
    }

    // Sort entries by (path, stage)
    newEntries.sort((a, b) => {
      const pathCmp = comparePaths(a.path, b.path);
      if (pathCmp !== 0) return pathCmp;
      return a.stage - b.stage;
    });

    this.store._replaceEntries(newEntries);
  }
}

/**
 * Compare paths using Git's canonical ordering.
 */
function comparePaths(a: string, b: string): number {
  const aLen = a.length;
  const bLen = b.length;
  const minLen = Math.min(aLen, bLen);

  for (let i = 0; i < minLen; i++) {
    const diff = a.charCodeAt(i) - b.charCodeAt(i);
    if (diff !== 0) return diff;
  }

  return aLen - bLen;
}

// ========== Helper Functions for Trees/TreeStore Compatibility ==========

/**
 * Store tree entries using either Trees or TreeStore interface.
 */
function storeTreeEntries(
  trees: Trees | TreeStore,
  entries: Iterable<TreeEntry>,
): Promise<ObjectId> {
  if ("store" in trees) {
    return trees.store(entries);
  }
  return trees.storeTree(entries);
}

/**
 * Load tree entries using either Trees or TreeStore interface.
 */
async function loadTreeEntries(
  trees: Trees | TreeStore,
  treeId: ObjectId,
): Promise<AsyncIterable<TreeEntry> | undefined> {
  if ("load" in trees) {
    return trees.load(treeId);
  }
  // TreeStore.loadTree always returns AsyncIterable (throws on missing)
  return trees.loadTree(treeId);
}

/**
 * Factory function to create an in-memory Staging
 */
export function createSimpleStaging(): Staging {
  return new SimpleStaging();
}
