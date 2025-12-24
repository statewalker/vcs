/**
 * Memory-based staging store implementation.
 *
 * Pure in-memory StagingStore for testing and temporary operations.
 * No persistence - all entries are lost when the instance is garbage collected.
 */

import { FileMode, type ObjectId, type TreeEntry } from "../id";
import type { TreeStore } from "../stores";
import {
  MergeStage,
  type MergeStageValue,
  type StagingBuilder,
  type StagingEdit,
  type StagingEditor,
  type StagingEntry,
  type StagingEntryOptions,
  type StagingStore,
} from "./staging-store.js";

/**
 * Memory-based staging store implementation.
 *
 * All entries are kept sorted by (path, stage) for efficient lookup.
 * Useful for:
 * - Testing staging operations without file I/O
 * - Temporary staging during merge/rebase operations
 * - In-memory repository implementations
 */
export class MemoryStagingStore implements StagingStore {
  private entries: StagingEntry[] = [];
  private updateTime = 0;

  // ============ Reading Operations ============

  async getEntry(path: string): Promise<StagingEntry | undefined> {
    const index = this.findEntry(path, MergeStage.MERGED);
    return index >= 0 ? this.entries[index] : undefined;
  }

  async getEntryByStage(path: string, stage: MergeStageValue): Promise<StagingEntry | undefined> {
    const index = this.findEntry(path, stage);
    return index >= 0 ? this.entries[index] : undefined;
  }

  async getEntries(path: string): Promise<StagingEntry[]> {
    const result: StagingEntry[] = [];
    for (const stage of [MergeStage.MERGED, MergeStage.BASE, MergeStage.OURS, MergeStage.THEIRS]) {
      const entry = await this.getEntryByStage(path, stage);
      if (entry) result.push(entry);
    }
    return result;
  }

  async hasEntry(path: string): Promise<boolean> {
    for (const stage of [MergeStage.MERGED, MergeStage.BASE, MergeStage.OURS, MergeStage.THEIRS]) {
      if (this.findEntry(path, stage) >= 0) return true;
    }
    return false;
  }

  async getEntryCount(): Promise<number> {
    return this.entries.length;
  }

  async *listEntries(): AsyncIterable<StagingEntry> {
    for (const entry of this.entries) {
      yield entry;
    }
  }

  async *listEntriesUnder(prefix: string): AsyncIterable<StagingEntry> {
    const normalizedPrefix = prefix.endsWith("/") ? prefix : `${prefix}/`;
    for (const entry of this.entries) {
      if (entry.path.startsWith(normalizedPrefix) || entry.path === prefix) {
        yield entry;
      }
    }
  }

  async hasConflicts(): Promise<boolean> {
    return this.entries.some((e) => e.stage !== MergeStage.MERGED);
  }

  async *getConflictPaths(): AsyncIterable<string> {
    const seen = new Set<string>();
    for (const entry of this.entries) {
      if (entry.stage !== MergeStage.MERGED && !seen.has(entry.path)) {
        seen.add(entry.path);
        yield entry.path;
      }
    }
  }

  // ============ Writing Operations ============

  builder(): StagingBuilder {
    return new MemoryStagingBuilder(this);
  }

  editor(): StagingEditor {
    return new MemoryStagingEditor(this);
  }

  async clear(): Promise<void> {
    this.entries = [];
    this.updateTime = Date.now();
  }

  // ============ Tree Operations ============

  async writeTree(treeStore: TreeStore): Promise<ObjectId> {
    if (await this.hasConflicts()) {
      throw new Error("Cannot write tree with unresolved conflicts");
    }

    const stage0 = this.entries.filter((e) => e.stage === MergeStage.MERGED);
    return this.buildTreeRecursive(treeStore, stage0, "");
  }

  private async buildTreeRecursive(
    treeStore: TreeStore,
    entries: StagingEntry[],
    prefix: string,
  ): Promise<ObjectId> {
    const treeEntries: TreeEntry[] = [];
    const subdirs = new Map<string, StagingEntry[]>();

    for (const entry of entries) {
      const relativePath = prefix ? entry.path.slice(prefix.length + 1) : entry.path;
      const slashIndex = relativePath.indexOf("/");

      if (slashIndex < 0) {
        treeEntries.push({
          name: relativePath,
          mode: entry.mode,
          id: entry.objectId,
        });
      } else {
        const dirName = relativePath.slice(0, slashIndex);
        if (!subdirs.has(dirName)) {
          subdirs.set(dirName, []);
        }
        subdirs.get(dirName)?.push(entry);
      }
    }

    for (const [dirName, dirEntries] of subdirs) {
      const subPrefix = prefix ? `${prefix}/${dirName}` : dirName;
      const subtreeId = await this.buildTreeRecursive(treeStore, dirEntries, subPrefix);
      treeEntries.push({
        name: dirName,
        mode: FileMode.TREE,
        id: subtreeId,
      });
    }

    return treeStore.storeTree(treeEntries);
  }

  async readTree(treeStore: TreeStore, treeId: ObjectId): Promise<void> {
    this.entries = [];
    await this.addTreeRecursive(treeStore, treeId, "", MergeStage.MERGED);
    this.sortEntries();
    this.updateTime = Date.now();
  }

  private async addTreeRecursive(
    treeStore: TreeStore,
    treeId: ObjectId,
    prefix: string,
    stage: MergeStageValue,
  ): Promise<void> {
    for await (const entry of treeStore.loadTree(treeId)) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;

      if (entry.mode === FileMode.TREE) {
        await this.addTreeRecursive(treeStore, entry.id, path, stage);
      } else {
        this.entries.push({
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

  // ============ Persistence (no-op for memory store) ============

  async read(): Promise<void> {
    // No-op: memory store has no persistence
  }

  async write(): Promise<void> {
    // No-op: memory store has no persistence
    this.updateTime = Date.now();
  }

  async isOutdated(): Promise<boolean> {
    // Memory store is never outdated
    return false;
  }

  getUpdateTime(): number {
    return this.updateTime;
  }

  // ============ Internal Methods ============

  private findEntry(path: string, stage: MergeStageValue): number {
    let low = 0;
    let high = this.entries.length - 1;

    while (low <= high) {
      const mid = (low + high) >>> 1;
      const entry = this.entries[mid];
      const cmp = this.compareEntry(entry, path, stage);

      if (cmp < 0) {
        low = mid + 1;
      } else if (cmp > 0) {
        high = mid - 1;
      } else {
        return mid;
      }
    }

    return -(low + 1);
  }

  private compareEntry(entry: StagingEntry, path: string, stage: MergeStageValue): number {
    const pathCmp = comparePaths(entry.path, path);
    if (pathCmp !== 0) return pathCmp;
    return entry.stage - stage;
  }

  private sortEntries(): void {
    this.entries.sort((a, b) => {
      const pathCmp = comparePaths(a.path, b.path);
      if (pathCmp !== 0) return pathCmp;
      return a.stage - b.stage;
    });
  }

  /** @internal - Used by builder/editor */
  _replaceEntries(newEntries: StagingEntry[]): void {
    this.entries = newEntries;
    this.updateTime = Date.now();
  }

  /** @internal - Used by builder/editor */
  _getEntries(): StagingEntry[] {
    return this.entries;
  }
}

/**
 * Builder for bulk staging area modifications.
 */
class MemoryStagingBuilder implements StagingBuilder {
  private entries: StagingEntry[] = [];
  private keeping: Array<{ start: number; count: number }> = [];

  constructor(private readonly store: MemoryStagingStore) {}

  add(options: StagingEntryOptions): void {
    const entry: StagingEntry = {
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
    treeStore: TreeStore,
    treeId: ObjectId,
    prefix: string,
    stage: MergeStageValue = MergeStage.MERGED,
  ): Promise<void> {
    await this.addTreeRecursive(treeStore, treeId, prefix, stage);
  }

  private async addTreeRecursive(
    treeStore: TreeStore,
    treeId: ObjectId,
    prefix: string,
    stage: MergeStageValue,
  ): Promise<void> {
    for await (const entry of treeStore.loadTree(treeId)) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;

      if (entry.mode === FileMode.TREE) {
        await this.addTreeRecursive(treeStore, entry.id, path, stage);
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
    const existingEntries = this.store._getEntries();
    for (const { start, count } of this.keeping) {
      for (let i = 0; i < count; i++) {
        if (start + i < existingEntries.length) {
          this.entries.push(existingEntries[start + i]);
        }
      }
    }

    this.entries.sort((a, b) => {
      const pathCmp = comparePaths(a.path, b.path);
      if (pathCmp !== 0) return pathCmp;
      return a.stage - b.stage;
    });

    for (let i = 1; i < this.entries.length; i++) {
      const prev = this.entries[i - 1];
      const curr = this.entries[i];
      if (prev.path === curr.path && prev.stage === curr.stage) {
        throw new Error(`Duplicate entry: ${curr.path} stage ${curr.stage}`);
      }
    }

    this.validateStages();
    this.store._replaceEntries(this.entries);
  }

  private validateStages(): void {
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
class MemoryStagingEditor implements StagingEditor {
  private edits: StagingEdit[] = [];

  constructor(private readonly store: MemoryStagingStore) {}

  add(edit: StagingEdit): void {
    this.edits.push(edit);
  }

  async finish(): Promise<void> {
    this.edits.sort((a, b) => comparePaths(a.path, b.path));

    const existingEntries = this.store._getEntries();
    const newEntries: StagingEntry[] = [];

    let entryIndex = 0;
    let editIndex = 0;

    while (entryIndex < existingEntries.length || editIndex < this.edits.length) {
      const entry = existingEntries[entryIndex];
      const edit = this.edits[editIndex];

      if (!edit) {
        newEntries.push(entry);
        entryIndex++;
      } else if (!entry) {
        const result = edit.apply(undefined);
        if (result) newEntries.push(result);
        editIndex++;
      } else {
        const cmp = comparePaths(entry.path, edit.path);

        if (cmp < 0) {
          if (isDeleteTree(edit) && entry.path.startsWith(`${edit.path}/`)) {
            entryIndex++;
          } else {
            newEntries.push(entry);
            entryIndex++;
          }
        } else if (cmp > 0) {
          const result = edit.apply(undefined);
          if (result) newEntries.push(result);
          editIndex++;
        } else {
          if (isResolveConflict(edit)) {
            this.applyConflictResolution(existingEntries, entryIndex, edit, newEntries);
            while (
              entryIndex < existingEntries.length &&
              existingEntries[entryIndex].path === edit.path
            ) {
              entryIndex++;
            }
          } else {
            const result = edit.apply(entry);
            if (result) newEntries.push(result);
            entryIndex++;
          }
          editIndex++;
        }
      }
    }

    this.store._replaceEntries(newEntries);
  }

  private applyConflictResolution(
    entries: StagingEntry[],
    startIndex: number,
    edit: StagingEdit & { chooseStage?: MergeStageValue },
    output: StagingEntry[],
  ): void {
    let chosen: StagingEntry | undefined;
    let i = startIndex;

    while (i < entries.length && entries[i].path === edit.path) {
      if (edit.chooseStage !== undefined && entries[i].stage === edit.chooseStage) {
        chosen = entries[i];
      }
      i++;
    }

    if (chosen) {
      output.push({
        ...chosen,
        stage: MergeStage.MERGED,
      });
    }
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

/**
 * Type guard for DeleteStagingTree edit.
 */
function isDeleteTree(edit: StagingEdit): edit is StagingEdit & { path: string } {
  return edit.constructor.name === "DeleteStagingTree";
}

/**
 * Type guard for ResolveStagingConflict edit.
 */
function isResolveConflict(
  edit: StagingEdit,
): edit is StagingEdit & { chooseStage: MergeStageValue } {
  return "chooseStage" in edit;
}
