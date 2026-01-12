/**
 * SQL-based StagingStore implementation
 *
 * Stores staging area entries in a SQL database.
 */

import type {
  MergeStageValue,
  ObjectId,
  StagingBuilder,
  StagingEdit,
  StagingEditor,
  StagingEntry,
  StagingEntryOptions,
  StagingStore,
  TreeEntry,
  TreeStore,
} from "@statewalker/vcs-core";
import { FileMode, MergeStage } from "@statewalker/vcs-core";
import type { DatabaseClient } from "./database-client.js";

/**
 * Database row type for staging entry queries
 */
interface StagingRow {
  path: string;
  stage: number;
  mode: number;
  object_id: string;
  size: number;
  mtime: number;
  ctime: number | null;
  dev: number | null;
  ino: number | null;
  assume_valid: number;
  intent_to_add: number;
  skip_worktree: number;
}

/**
 * Convert database row to StagingEntry
 */
function rowToEntry(row: StagingRow): StagingEntry {
  return {
    path: row.path,
    mode: row.mode,
    objectId: row.object_id,
    stage: row.stage as MergeStageValue,
    size: row.size,
    mtime: row.mtime,
    ctime: row.ctime ?? undefined,
    dev: row.dev ?? undefined,
    ino: row.ino ?? undefined,
    assumeValid: row.assume_valid === 1,
    intentToAdd: row.intent_to_add === 1,
    skipWorktree: row.skip_worktree === 1,
  };
}

/**
 * SQL-based StagingStore implementation.
 */
export class SQLStagingStore implements StagingStore {
  private updateTime: number = Date.now();

  constructor(private db: DatabaseClient) {}

  // ============ Reading Operations ============

  async getEntry(path: string): Promise<StagingEntry | undefined> {
    return this.getEntryByStage(path, MergeStage.MERGED);
  }

  async getEntryByStage(path: string, stage: MergeStageValue): Promise<StagingEntry | undefined> {
    const rows = await this.db.query<StagingRow>(
      "SELECT * FROM staging_entry WHERE path = ? AND stage = ?",
      [path, stage],
    );

    return rows.length > 0 ? rowToEntry(rows[0]) : undefined;
  }

  async getEntries(path: string): Promise<StagingEntry[]> {
    const rows = await this.db.query<StagingRow>(
      "SELECT * FROM staging_entry WHERE path = ? ORDER BY stage",
      [path],
    );

    return rows.map(rowToEntry);
  }

  async hasEntry(path: string): Promise<boolean> {
    const result = await this.db.query<{ cnt: number }>(
      "SELECT COUNT(*) as cnt FROM staging_entry WHERE path = ?",
      [path],
    );
    return result[0].cnt > 0;
  }

  async getEntryCount(): Promise<number> {
    const result = await this.db.query<{ cnt: number }>(
      "SELECT COUNT(*) as cnt FROM staging_entry",
      [],
    );
    return result[0].cnt;
  }

  async *listEntries(): AsyncIterable<StagingEntry> {
    const rows = await this.db.query<StagingRow>(
      "SELECT * FROM staging_entry ORDER BY path, stage",
      [],
    );

    for (const row of rows) {
      yield rowToEntry(row);
    }
  }

  async *listEntriesUnder(prefix: string): AsyncIterable<StagingEntry> {
    const normalizedPrefix = prefix.endsWith("/") ? prefix : `${prefix}/`;

    const rows = await this.db.query<StagingRow>(
      "SELECT * FROM staging_entry WHERE path = ? OR path LIKE ? ORDER BY path, stage",
      [prefix, `${normalizedPrefix}%`],
    );

    for (const row of rows) {
      yield rowToEntry(row);
    }
  }

  async hasConflicts(): Promise<boolean> {
    const result = await this.db.query<{ cnt: number }>(
      "SELECT COUNT(*) as cnt FROM staging_entry WHERE stage > 0",
      [],
    );
    return result[0].cnt > 0;
  }

  async *getConflictPaths(): AsyncIterable<string> {
    const rows = await this.db.query<{ path: string }>(
      "SELECT DISTINCT path FROM staging_entry WHERE stage > 0 ORDER BY path",
      [],
    );

    for (const row of rows) {
      yield row.path;
    }
  }

  // ============ Writing Operations ============

  builder(): StagingBuilder {
    return new SQLStagingBuilder(this.db, this);
  }

  editor(): StagingEditor {
    return new SQLStagingEditor(this.db, this);
  }

  async clear(): Promise<void> {
    await this.db.execute("DELETE FROM staging_entry", []);
    this.updateTime = Date.now();
  }

  // ============ Tree Operations ============

  async writeTree(treeStore: TreeStore): Promise<ObjectId> {
    if (await this.hasConflicts()) {
      throw new Error("Cannot write tree with unresolved conflicts");
    }

    const entries: StagingEntry[] = [];
    for await (const entry of this.listEntries()) {
      if (entry.stage === MergeStage.MERGED) {
        entries.push(entry);
      }
    }

    return this.buildTreeRecursive(treeStore, entries, "");
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
    await this.clear();
    await this.addTreeRecursive(treeStore, treeId, "", MergeStage.MERGED);
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
        await this.db.execute(
          `INSERT INTO staging_entry (path, stage, mode, object_id, size, mtime)
           VALUES (?, ?, ?, ?, 0, 0)`,
          [path, stage, entry.mode, entry.id],
        );
      }
    }
  }

  // ============ Persistence ============

  async read(): Promise<void> {
    // For SQL, data is already persistent, just update timestamp
    this.updateTime = Date.now();
  }

  async write(): Promise<void> {
    // For SQL, data is already persistent
    this.updateTime = Date.now();
  }

  async isOutdated(): Promise<boolean> {
    return false; // SQL is always up-to-date
  }

  getUpdateTime(): number {
    return this.updateTime;
  }

  /** @internal - Used by builder */
  _setUpdateTime(time: number): void {
    this.updateTime = time;
  }
}

/**
 * Builder for bulk staging area modifications.
 */
class SQLStagingBuilder implements StagingBuilder {
  private entries: StagingEntry[] = [];
  private keeping: Array<{ start: number; count: number }> = [];

  constructor(
    private readonly db: DatabaseClient,
    private readonly store: SQLStagingStore,
  ) {}

  add(options: StagingEntryOptions): void {
    if (!options.mode) {
      throw new Error(`FileMode not set for path ${options.path}`);
    }

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
    // Get existing entries for keeping
    if (this.keeping.length > 0) {
      const existingRows = await this.db.query<StagingRow>(
        "SELECT * FROM staging_entry ORDER BY path, stage",
        [],
      );
      const existingEntries = existingRows.map(rowToEntry);

      for (const { start, count } of this.keeping) {
        for (let i = 0; i < count; i++) {
          if (start + i < existingEntries.length) {
            this.entries.push(existingEntries[start + i]);
          }
        }
      }
    }

    // Sort entries by (path, stage)
    this.entries.sort((a, b) => {
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

    // Replace all entries in a transaction
    await this.db.transaction(async (tx) => {
      await tx.execute("DELETE FROM staging_entry", []);

      for (const entry of this.entries) {
        await tx.execute(
          `INSERT INTO staging_entry (
            path, stage, mode, object_id, size, mtime,
            ctime, dev, ino, assume_valid, intent_to_add, skip_worktree
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            entry.path,
            entry.stage,
            entry.mode,
            entry.objectId,
            entry.size,
            entry.mtime,
            entry.ctime ?? null,
            entry.dev ?? null,
            entry.ino ?? null,
            entry.assumeValid ? 1 : 0,
            entry.intentToAdd ? 1 : 0,
            entry.skipWorktree ? 1 : 0,
          ],
        );
      }
    });

    this.store._setUpdateTime(Date.now());
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
class SQLStagingEditor implements StagingEditor {
  private edits: StagingEdit[] = [];

  constructor(
    private readonly db: DatabaseClient,
    private readonly store: SQLStagingStore,
  ) {}

  add(edit: StagingEdit): void {
    this.edits.push(edit);
  }

  remove(path: string): void {
    this.edits.push({ path, apply: () => undefined });
  }

  async finish(): Promise<void> {
    // Sort edits by path
    this.edits.sort((a, b) => comparePaths(a.path, b.path));

    // Get existing entries
    const existingRows = await this.db.query<StagingRow>(
      "SELECT * FROM staging_entry ORDER BY path, stage",
      [],
    );
    const existingEntries = existingRows.map(rowToEntry);

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
          // Check for tree deletion
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

    // Replace all entries in a transaction
    await this.db.transaction(async (tx) => {
      await tx.execute("DELETE FROM staging_entry", []);

      for (const entry of newEntries) {
        await tx.execute(
          `INSERT INTO staging_entry (
            path, stage, mode, object_id, size, mtime,
            ctime, dev, ino, assume_valid, intent_to_add, skip_worktree
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            entry.path,
            entry.stage,
            entry.mode,
            entry.objectId,
            entry.size,
            entry.mtime,
            entry.ctime ?? null,
            entry.dev ?? null,
            entry.ino ?? null,
            entry.assumeValid ? 1 : 0,
            entry.intentToAdd ? 1 : 0,
            entry.skipWorktree ? 1 : 0,
          ],
        );
      }
    });

    this.store._setUpdateTime(Date.now());
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
