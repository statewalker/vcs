import type { Tags } from "@statewalker/vcs-core";
import { DefaultSerializationApi, isSymbolicRef } from "@statewalker/vcs-core";
import { httpPush, type RefStore as TransportRefStore } from "@statewalker/vcs-transport";
import { createVcsRepositoryFacade } from "@statewalker/vcs-transport-adapters";

/**
 * No-op Tags for repositories without tag support.
 * Only used as a fallback when tags store is not provided.
 */
const noOpTags: Tags = {
  store: () => Promise.reject(new Error("Tag storage not available")),
  load: () => Promise.resolve(undefined),
  getTarget: () => Promise.resolve(undefined),
  has: () => Promise.resolve(false),
  remove: () => Promise.resolve(false),
  async *keys() {
    // Empty iterator - no tags available
  },
};

import { InvalidRemoteError, NonFastForwardError, PushRejectedException } from "../errors/index.js";
import { type PushResult, PushStatus, type RemoteRefUpdate } from "../results/push-result.js";
import { TransportCommand } from "../transport-command.js";

/**
 * Push objects and refs to a remote repository.
 *
 * Equivalent to `git push`.
 *
 * Based on JGit's PushCommand.
 *
 * @example
 * ```typescript
 * // Push current branch to origin
 * const result = await git.push().call();
 *
 * // Push to specific remote
 * const result = await git.push()
 *   .setRemote("upstream")
 *   .call();
 *
 * // Push specific refs
 * const result = await git.push()
 *   .add("refs/heads/feature:refs/heads/feature")
 *   .call();
 *
 * // Force push
 * const result = await git.push()
 *   .setForce(true)
 *   .call();
 *
 * // Delete remote branch
 * const result = await git.push()
 *   .add(":refs/heads/old-branch")
 *   .call();
 *
 * // Atomic push (all-or-nothing)
 * const result = await git.push()
 *   .setAtomic(true)
 *   .call();
 * ```
 */
export class PushCommand extends TransportCommand<PushResult> {
  private remote = "origin";
  private refSpecs: string[] = [];
  private force = false;
  private atomic = false;
  private thin = true;
  private dryRun = false;
  private pushAll = false;
  private pushTags = false;
  private useBitmaps = true;
  private pushOptions: string[] = [];
  private receivePack?: string;

  /**
   * Set the remote to push to.
   *
   * Can be either a remote name (e.g., "origin") or a URL.
   * Default is "origin".
   *
   * @param remote Remote name or URL
   */
  setRemote(remote: string): this {
    this.checkCallable();
    this.remote = remote;
    return this;
  }

  /**
   * Get the remote being pushed to.
   */
  getRemote(): string {
    return this.remote;
  }

  /**
   * Add a refspec to push.
   *
   * @param refSpec Refspec string (e.g., "refs/heads/main:refs/heads/main")
   */
  add(refSpec: string): this {
    this.checkCallable();
    this.refSpecs.push(refSpec);
    return this;
  }

  /**
   * Set refspecs to push.
   *
   * @param refSpecs Refspec strings
   */
  setRefSpecs(...refSpecs: string[]): this {
    this.checkCallable();
    this.refSpecs = refSpecs;
    return this;
  }

  /**
   * Set force push mode.
   *
   * When enabled, allows non-fast-forward updates.
   *
   * @param force Whether to force push
   */
  setForce(force: boolean): this {
    this.checkCallable();
    this.force = force;
    return this;
  }

  /**
   * Whether force push is enabled.
   */
  isForce(): boolean {
    return this.force;
  }

  /**
   * Set atomic push mode.
   *
   * When enabled, either all refs update or none do.
   *
   * @param atomic Whether to use atomic push
   */
  setAtomic(atomic: boolean): this {
    this.checkCallable();
    this.atomic = atomic;
    return this;
  }

  /**
   * Whether atomic push is enabled.
   */
  isAtomic(): boolean {
    return this.atomic;
  }

  /**
   * Set thin-pack preference.
   *
   * @param thin Whether to use thin packs
   */
  setThin(thin: boolean): this {
    this.checkCallable();
    this.thin = thin;
    return this;
  }

  /**
   * Whether thin packs are enabled.
   */
  isThin(): boolean {
    return this.thin;
  }

  /**
   * Set dry run mode.
   *
   * In dry run mode, refs are not actually updated on remote.
   *
   * @param dryRun Whether to do a dry run
   */
  setDryRun(dryRun: boolean): this {
    this.checkCallable();
    this.dryRun = dryRun;
    return this;
  }

  /**
   * Whether dry run mode is enabled.
   */
  isDryRun(): boolean {
    return this.dryRun;
  }

  /**
   * Set whether to push all branches.
   *
   * @param pushAll Whether to push all branches
   */
  setPushAll(pushAll: boolean): this {
    this.checkCallable();
    this.pushAll = pushAll;
    return this;
  }

  /**
   * Set whether to push all tags.
   *
   * @param pushTags Whether to push all tags
   */
  setPushTags(pushTags: boolean): this {
    this.checkCallable();
    this.pushTags = pushTags;
    return this;
  }

  /**
   * Set whether to use bitmaps for push.
   *
   * Default is true.
   *
   * @param useBitmaps Whether to use bitmaps
   */
  setUseBitmaps(useBitmaps: boolean): this {
    this.checkCallable();
    this.useBitmaps = useBitmaps;
    return this;
  }

  /**
   * Whether bitmaps are used for push.
   */
  isUseBitmaps(): boolean {
    return this.useBitmaps;
  }

  /**
   * Set push options associated with the push operation.
   *
   * Push options are strings passed to the receive-pack on the server
   * side, where they can be used by hooks.
   *
   * @param options Push option strings
   */
  setPushOptions(options: string[]): this {
    this.checkCallable();
    this.pushOptions = [...options];
    return this;
  }

  /**
   * Get push options.
   */
  getPushOptions(): string[] {
    return [...this.pushOptions];
  }

  /**
   * Set the remote executable providing receive-pack service.
   *
   * @param receivePack Name of the remote executable
   */
  setReceivePack(receivePack: string): this {
    this.checkCallable();
    this.receivePack = receivePack;
    return this;
  }

  /**
   * Get the receive-pack executable name.
   */
  getReceivePack(): string | undefined {
    return this.receivePack;
  }

  /**
   * Execute the push operation.
   *
   * @returns Push result with updated refs
   * @throws InvalidRemoteError if remote cannot be resolved
   * @throws PushRejectedException if push is rejected
   */
  async call(): Promise<PushResult> {
    this.checkCallable();
    this.setCallable(false);

    // Resolve remote URL
    const remoteUrl = await this.resolveRemoteUrl(this.remote);
    if (!remoteUrl) {
      throw new InvalidRemoteError(this.remote);
    }

    // Build refspecs
    const refspecs = await this.buildRefSpecs();

    if (refspecs.length === 0) {
      // Nothing to push
      return {
        uri: remoteUrl,
        remoteUpdates: [],
        bytesSent: 0,
        objectCount: 0,
        messages: [],
      };
    }

    // Get tags store (use no-op fallback if not available)
    const tagsStore = this.tagsStore ?? noOpTags;

    // Create serialization API from typed stores
    // Note: SerializationApiConfig accepts stores at top level
    // Use type assertion since we're passing new interfaces to a legacy-compatible API
    const serialization = new DefaultSerializationApi({
      blobs: this.blobs,
      trees: this.trees,
      commits: this.commits,
      tags: tagsStore,
      refs: this.refsStore,
    } as unknown as ConstructorParameters<typeof DefaultSerializationApi>[0]);

    // Create repository facade for pack operations
    // Use type assertion for legacy store-based API
    const repository = createVcsRepositoryFacade({
      blobs: this.blobs,
      trees: this.trees,
      commits: this.commits,
      tags: tagsStore,
      refs: this.refsStore,
      serialization,
    } as unknown as Parameters<typeof createVcsRepositoryFacade>[0]);

    // Create transport ref store adapter
    const refStore = this.createRefStoreAdapter();

    // Build credentials in the expected format
    const credentials =
      this.credentials?.username && this.credentials?.password
        ? { username: this.credentials.username, password: this.credentials.password }
        : undefined;

    // Execute push using new httpPush API
    const transportResult = await httpPush(remoteUrl, repository, refStore, {
      refspecs,
      auth: this.credentials,
      headers: this.headers,
      timeout: this.timeout,
      force: this.force,
      atomic: this.atomic,
      onProgressMessage: this.progressMessageCallback,
      getLocalRef: async (refName: string) => {
        const ref = await this.store.refs.resolve(refName);
        return ref?.objectId;
      },
      getObjectsToPush: (newIds: string[], oldIds: string[]) =>
        this.getObjectsToPush(newIds, oldIds),
    };

    // Execute push
    const transportResult = await transportPush(options);

    // Convert to PushResult
    const remoteUpdates: RemoteRefUpdate[] = [];
    for (const [refName, updateResult] of transportResult.updates) {
      remoteUpdates.push({
        remoteName: refName,
        newObjectId: "", // Would need to track this
        status: updateResult.ok ? PushStatus.OK : PushStatus.REJECTED_OTHER,
        message: updateResult.message,
        forceUpdate: this.force,
        delete: false,
      });
    }

    return {
      uri: remoteUrl,
      remoteUpdates,
      bytesSent: transportResult.bytesSent,
      objectCount: transportResult.objectCount,
      messages: [],
    };
  }

  /**
   * Push and throw on failure.
   */
  async callOrThrow(): Promise<PushResult> {
    const result = await this.call();

    for (const update of result.remoteUpdates) {
      if (update.status === PushStatus.REJECTED_NONFASTFORWARD) {
        throw new NonFastForwardError(update.remoteName, result.uri);
      }
      if (update.status === PushStatus.REJECTED_OTHER || update.status === PushStatus.FAILED) {
        throw new PushRejectedException(
          update.remoteName,
          update.message || "rejected",
          result.uri,
        );
      }
    }

    return result;
  }

  /**
   * Resolve remote name to URL.
   */
  private async resolveRemoteUrl(remote: string): Promise<string | undefined> {
    // If it looks like a URL, use it directly
    if (remote.includes("://") || remote.includes("@")) {
      return remote;
    }

    // Try to get remote URL from config
    // For now, treat as URL if not a known remote
    return remote;
  }

  /**
   * Create a transport RefStore adapter from the history store refs.
   */
  private createRefStoreAdapter(): TransportRefStore {
    const refs = this.refsStore;

    return {
      async get(name: string): Promise<string | undefined> {
        const ref = await refs.resolve(name);
        return ref?.objectId;
      },

      async update(name: string, oid: string): Promise<void> {
        await refs.set(name, oid);
      },

      async listAll(): Promise<Iterable<[string, string]>> {
        const result: Array<[string, string]> = [];
        for await (const ref of refs.list()) {
          if (!isSymbolicRef(ref) && ref.objectId) {
            result.push([ref.name, ref.objectId]);
          }
        }
        return result;
      },

      async getSymrefTarget(name: string): Promise<string | undefined> {
        const ref = await refs.get(name);
        if (ref && isSymbolicRef(ref)) {
          return ref.target;
        }
        return undefined;
      },

      async isRefTip(oid: string): Promise<boolean> {
        for await (const ref of refs.list()) {
          if (!isSymbolicRef(ref) && ref.objectId === oid) {
            return true;
          }
        }
        return false;
      },
    };
  }

  /**
   * Build refspecs for the push.
   */
  private async buildRefSpecs(): Promise<string[]> {
    const specs: string[] = [];

    // Add explicit refspecs
    for (const spec of this.refSpecs) {
      if (this.force && !spec.startsWith("+")) {
        specs.push(`+${spec}`);
      } else {
        specs.push(spec);
      }
    }

    // Push all branches
    if (this.pushAll) {
      for await (const ref of this.refsStore.list("refs/heads/")) {
        const spec = `${ref.name}:${ref.name}`;
        specs.push(this.force ? `+${spec}` : spec);
      }
    }

    // Push all tags
    if (this.pushTags) {
      for await (const ref of this.refsStore.list("refs/tags/")) {
        const spec = `${ref.name}:${ref.name}`;
        specs.push(this.force ? `+${spec}` : spec);
      }
    }

    // Default: push current branch
    if (specs.length === 0) {
      const currentBranch = await this.getCurrentBranch();
      if (currentBranch) {
        const spec = `${currentBranch}:${currentBranch}`;
        specs.push(this.force ? `+${spec}` : spec);
      }
    }

    return specs;
  }

  /**
   * Get objects to push.
   *
   * Returns objects reachable from newIds but not from oldIds.
   */
  private async *getObjectsToPush(newIds: string[], oldIds: string[]): AsyncIterable<PushObject> {
    // Build set of commits to exclude (already on remote)
    const excludeCommits = new Set<string>();
    for (const oldId of oldIds) {
      if (oldId !== "0".repeat(40)) {
        await this.collectReachableCommits(oldId, excludeCommits);
      }
    }

    // Walk from new commits and yield objects not in exclude set
    const visitedObjects = new Set<string>();
    const commitQueue: string[] = [...newIds.filter((id) => id !== "0".repeat(40))];

    while (commitQueue.length > 0) {
      const commitId = commitQueue.shift();
      if (commitId === undefined) break;

      if (excludeCommits.has(commitId) || visitedObjects.has(commitId)) {
        continue;
      }
      visitedObjects.add(commitId);

      try {
        const commit = await this.store.commits.loadCommit(commitId);

        // Yield commit object
        yield await this.loadObjectForPush(commitId, 1);

        // Yield tree and its contents
        await this.yieldTreeObjects(commit.tree, visitedObjects);

        // Queue parent commits
        for (const parent of commit.parents) {
          if (!excludeCommits.has(parent) && !visitedObjects.has(parent)) {
            commitQueue.push(parent);
          }
        }
      } catch {
        // Commit not found, skip
      }
    }
  }

  /**
   * Collect all commits reachable from a given commit.
   */
  private async collectReachableCommits(
    commitId: string,
    result: Set<string>,
    maxDepth = 1000,
  ): Promise<void> {
    const queue: string[] = [commitId];
    let depth = 0;

    while (queue.length > 0 && depth < maxDepth) {
      const id = queue.shift();
      if (id === undefined) break;
      if (result.has(id)) {
        continue;
      }
      result.add(id);
      depth++;

      try {
        const commit = await this.store.commits.loadCommit(id);
        queue.push(...commit.parents);
      } catch {
        // Commit not found, skip
      }
    }
  }

  /**
   * Yield tree and blob objects recursively.
   */
  private async *yieldTreeObjects(
    treeId: string,
    visited: Set<string>,
  ): AsyncGenerator<PushObject> {
    if (visited.has(treeId)) {
      return;
    }
    visited.add(treeId);

    // Yield tree object
    yield await this.loadObjectForPush(treeId, 2);

    // Recursively process tree entries
    for await (const entry of this.store.trees.loadTree(treeId)) {
      if (visited.has(entry.id)) {
        continue;
      }

      const isTree = (entry.mode & 0o170000) === 0o040000;
      if (isTree) {
        yield* this.yieldTreeObjects(entry.id, visited);
      } else {
        // Blob
        visited.add(entry.id);
        yield await this.loadObjectForPush(entry.id, 3);
      }
    }
  }

  /**
   * Load an object for pushing.
   */
  private async loadObjectForPush(objectId: string, type: number): Promise<PushObject> {
    const chunks: Uint8Array[] = [];
    for await (const chunk of this.store.blobs.load(objectId)) {
      chunks.push(chunk);
    }

    // Concatenate chunks
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const content = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      content.set(chunk, offset);
      offset += chunk.length;
    }

    return {
      id: objectId,
      type,
      content,
    };
  }
}
