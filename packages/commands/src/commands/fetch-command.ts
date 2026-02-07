import type { ObjectId, Tags } from "@statewalker/vcs-core";
import { DefaultSerializationApi, isSymbolicRef } from "@statewalker/vcs-core";
import { httpFetch, type RefStore as TransportRefStore } from "@statewalker/vcs-transport";
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

import { InvalidArgumentError, InvalidRemoteError } from "../errors/index.js";
import {
  type FetchResult,
  RefUpdateStatus,
  type TrackingRefUpdate,
} from "../results/fetch-result.js";
import { TransportCommand } from "../transport-command.js";

/**
 * Tag fetching option.
 *
 * Based on JGit's TagOpt.
 */
export enum TagOption {
  /** Automatically follow tags that point to fetched commits */
  AUTO_FOLLOW = "auto-follow",
  /** Fetch all tags */
  FETCH_TAGS = "fetch-tags",
  /** Don't fetch any tags */
  NO_TAGS = "no-tags",
}

/**
 * Fetch objects and refs from a remote repository.
 *
 * Equivalent to `git fetch`.
 *
 * Based on JGit's FetchCommand.
 *
 * @example
 * ```typescript
 * // Fetch from default remote
 * const result = await git.fetch().call();
 *
 * // Fetch from specific remote
 * const result = await git.fetch()
 *   .setRemote("upstream")
 *   .call();
 *
 * // Fetch specific refs
 * const result = await git.fetch()
 *   .setRefSpecs("refs/heads/main:refs/remotes/origin/main")
 *   .call();
 *
 * // Shallow fetch
 * const result = await git.fetch()
 *   .setDepth(10)
 *   .call();
 *
 * // Fetch with authentication
 * const result = await git.fetch()
 *   .setCredentialsProvider("user", "token")
 *   .call();
 * ```
 */
export class FetchCommand extends TransportCommand<FetchResult> {
  private remote = "origin";
  private refSpecs: string[] = [];
  private removeDeletedRefs = false;
  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: Set by setTagOpt(), to be used in call()
  private tagOption: TagOption = TagOption.AUTO_FOLLOW;
  private thin = true;
  private depth?: number;
  private dryRun = false;
  private forceUpdate = false;
  private checkFetchedObjects = false;
  private initialBranch?: string;
  private shallowSince?: Date;
  private shallowExcludes: string[] = [];
  private unshallow = false;

  /**
   * Set the remote to fetch from.
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
   * Get the remote being fetched from.
   */
  getRemote(): string {
    return this.remote;
  }

  /**
   * Set refspecs to fetch.
   *
   * If not set, uses the default refspec for the remote.
   *
   * @param refSpecs Refspec strings
   */
  setRefSpecs(...refSpecs: string[]): this {
    this.checkCallable();
    this.refSpecs = refSpecs;
    return this;
  }

  /**
   * Add a refspec to fetch.
   *
   * @param refSpec Refspec string
   */
  addRefSpec(refSpec: string): this {
    this.checkCallable();
    this.refSpecs.push(refSpec);
    return this;
  }

  /**
   * Set whether to remove refs that no longer exist on the remote.
   *
   * Equivalent to `git fetch --prune`.
   *
   * @param remove Whether to prune deleted refs
   */
  setRemoveDeletedRefs(remove: boolean): this {
    this.checkCallable();
    this.removeDeletedRefs = remove;
    return this;
  }

  /**
   * Whether to remove deleted refs.
   */
  isRemoveDeletedRefs(): boolean {
    return this.removeDeletedRefs;
  }

  setTagOpt(option: TagOption): this {
    this.checkCallable();
    this.tagOption = option;
    return this;
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
   * Set shallow clone depth.
   *
   * @param depth Number of commits to fetch
   */
  setDepth(depth: number): this {
    this.checkCallable();
    if (depth < 1) {
      throw new InvalidArgumentError("depth", depth, "Depth must be at least 1");
    }
    this.depth = depth;
    return this;
  }

  /**
   * Set dry run mode.
   *
   * In dry run mode, refs are not actually updated.
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
   * Set force update mode.
   *
   * When enabled, allows non-fast-forward updates.
   *
   * @param force Whether to force updates
   */
  setForceUpdate(force: boolean): this {
    this.checkCallable();
    this.forceUpdate = force;
    return this;
  }

  /**
   * Whether force update mode is enabled.
   */
  isForceUpdate(): boolean {
    return this.forceUpdate;
  }

  /**
   * Set whether to check received objects for validity.
   *
   * If true, objects received will be verified.
   *
   * @param check Whether to check objects
   */
  setCheckFetchedObjects(check: boolean): this {
    this.checkCallable();
    this.checkFetchedObjects = check;
    return this;
  }

  /**
   * Whether to check received objects for validity.
   */
  isCheckFetchedObjects(): boolean {
    return this.checkFetchedObjects;
  }

  /**
   * Set the initial branch to check out.
   *
   * Can be specified as ref name (refs/heads/main), branch name (main),
   * or tag name (v1.0.0).
   *
   * @param branch Initial branch name
   */
  setInitialBranch(branch: string): this {
    this.checkCallable();
    this.initialBranch = branch;
    return this;
  }

  /**
   * Get the initial branch.
   */
  getInitialBranch(): string | undefined {
    return this.initialBranch;
  }

  /**
   * Deepens or shortens the history of a shallow repository to include
   * all reachable commits after a specified time.
   *
   * Equivalent to `git fetch --shallow-since=<date>`.
   *
   * @param shallowSince The timestamp
   */
  setShallowSince(shallowSince: Date): this {
    this.checkCallable();
    this.shallowSince = shallowSince;
    return this;
  }

  /**
   * Get the shallow-since date.
   */
  getShallowSince(): Date | undefined {
    return this.shallowSince;
  }

  /**
   * Deepens or shortens the history of a shallow repository to exclude
   * commits reachable from a specified remote branch or tag.
   *
   * Equivalent to `git fetch --shallow-exclude=<ref>`.
   *
   * @param shallowExclude The ref or commit to exclude
   */
  addShallowExclude(shallowExclude: string): this {
    this.checkCallable();
    this.shallowExcludes.push(shallowExclude);
    return this;
  }

  /**
   * Get the shallow excludes.
   */
  getShallowExcludes(): string[] {
    return [...this.shallowExcludes];
  }

  /**
   * If the source repository is complete, converts a shallow repository
   * to a complete one, removing all the limitations imposed by shallow
   * repositories.
   *
   * Equivalent to `git fetch --unshallow`.
   *
   * @param unshallow Whether to unshallow
   */
  setUnshallow(unshallow: boolean): this {
    this.checkCallable();
    this.unshallow = unshallow;
    return this;
  }

  /**
   * Whether unshallow mode is enabled.
   */
  isUnshallow(): boolean {
    return this.unshallow;
  }

  /**
   * Execute the fetch operation.
   *
   * @returns Fetch result with updated refs
   * @throws InvalidRemoteError if remote cannot be resolved
   */
  async call(): Promise<FetchResult> {
    this.checkCallable();
    this.setCallable(false);

    // Resolve remote URL
    const remoteUrl = await this.resolveRemoteUrl(this.remote);
    if (!remoteUrl) {
      throw new InvalidRemoteError(this.remote);
    }

    // Get tags store (use no-op fallback if not available)
    const tagsStore = this.tagsStore ?? noOpTags;

    // Create serialization API from typed stores
    const serialization = new DefaultSerializationApi({
      history: {
        blobs: this.blobs,
        trees: this.trees,
        commits: this.commits,
        tags: tagsStore,
      },
    });

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

    // Execute fetch using new httpFetch API
    const transportResult = await httpFetch(remoteUrl, repository, refStore, {
      depth: this.depth,
      onProgress: this.progressCallback,
      onProgressMessage: this.progressMessageCallback,
      localHas: async (objectId: Uint8Array) => {
        const hex = bytesToHex(objectId);
        return this.store.commits.has(hex);
      },
      localCommits: () => this.getLocalCommits(),
    };

    // Execute fetch
    const transportResult = await transportFetch(options);

    // Update local refs (unless dry run)
    const trackingUpdates: TrackingRefUpdate[] = [];
    if (!this.dryRun) {
      for (const [localRef, objectId] of transportResult.refs) {
        const update = await this.updateRef(localRef, bytesToHex(objectId));
        trackingUpdates.push(update);
      }

      // Handle prune
      if (this.removeDeletedRefs) {
        const pruned = await this.pruneDeletedRefs(transportResult.refs);
        trackingUpdates.push(...pruned);
      }
    } else {
      // In dry run, just record what would be updated
      for (const [localRef, objectId] of transportResult.refs) {
        trackingUpdates.push({
          localRef,
          remoteRef: localRef, // Simplified for dry run
          newObjectId: bytesToHex(objectId),
          status: RefUpdateStatus.NEW,
        });
      }
    }

    // Store pack data
    if (transportResult.packData.length > 0 && !this.dryRun) {
      await this.storePack(transportResult.packData);
    }

    // Build result
    const advertisedRefs = new Map<string, ObjectId>();
    for (const [refName, objectId] of transportResult.refs) {
      advertisedRefs.set(refName, bytesToHex(objectId));
    }

    return {
      uri: remoteUrl,
      advertisedRefs,
      trackingRefUpdates: trackingUpdates,
      defaultBranch: transportResult.defaultBranch,
      bytesReceived: transportResult.bytesReceived,
      isEmpty: transportResult.isEmpty,
      messages: [],
    };
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
    // For now, we check if refs store has remote config
    // In a full implementation, this would read from git config
    const remoteRef = await this.refsStore.get(`refs/remotes/${remote}/HEAD`);
    if (remoteRef) {
      // Remote exists, but we need the URL
      // This is a simplified implementation
    }

    // Check if we have a stored remote URL
    // This would typically come from repository config
    // For now, treat as URL if not a known remote
    return remote;
  }

  /**
   * Build refspecs for the fetch.
   */
  private createRefStoreAdapter(): TransportRefStore {
    const refs = this.refsStore;

    // Default refspecs based on remote
    const defaultSpecs = [`+refs/heads/*:refs/remotes/${this.remote}/*`];

    // Add tags based on tag option
    if (this.tagOption === TagOption.FETCH_TAGS) {
      defaultSpecs.push("+refs/tags/*:refs/tags/*");
    }

    return defaultSpecs;
  }

  /**
   * Get local commits for negotiation.
   */
  private async *getLocalCommits(): AsyncIterable<Uint8Array> {
    // Get commits from local refs for negotiation
    for await (const ref of this.store.refs.list("refs/heads/")) {
      if (!isSymbolicRef(ref) && ref.objectId) {
        yield hexToBytes(ref.objectId);
      }
    }
    for await (const ref of this.store.refs.list("refs/remotes/")) {
      if (!isSymbolicRef(ref) && ref.objectId) {
        yield hexToBytes(ref.objectId);
      }
    }
  }

  /**
   * Update a local ref.
   */
  private async updateRef(localRef: string, newObjectId: ObjectId): Promise<TrackingRefUpdate> {
    const existingRef = await this.refsStore.resolve(localRef);
    const oldObjectId = existingRef?.objectId;

    let status: RefUpdateStatus;
    if (!oldObjectId) {
      status = RefUpdateStatus.NEW;
    } else if (oldObjectId === newObjectId) {
      status = RefUpdateStatus.NO_CHANGE;
    } else if (this.forceUpdate) {
      status = RefUpdateStatus.FORCED;
    } else {
      // Check if fast-forward
      const isAncestor = await this.isAncestor(oldObjectId, newObjectId);
      status = isAncestor ? RefUpdateStatus.FAST_FORWARD : RefUpdateStatus.REJECTED;
    }

    // Actually update the ref
    if (status !== RefUpdateStatus.NO_CHANGE && status !== RefUpdateStatus.REJECTED) {
      await this.refsStore.set(localRef, newObjectId);
    }

    return {
      localRef,
      remoteRef: localRef, // Simplified
      oldObjectId,
      newObjectId,
      status,
    };
  }

  /**
   * Check if one commit is an ancestor of another.
   */
  private async isAncestor(ancestor: ObjectId, descendant: ObjectId): Promise<boolean> {
    // Walk from descendant back to see if we hit ancestor
    const visited = new Set<ObjectId>();
    const queue: ObjectId[] = [descendant];

    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined) break;
      if (current === ancestor) {
        return true;
      }
      if (visited.has(current)) {
        continue;
      }
      visited.add(current);

      try {
        const commit = await this.commits.load(current);
        if (commit) {
          queue.push(...commit.parents);
        }
      } catch {
        // Commit not found, skip
      }

      // Limit walk depth for performance
      if (visited.size > 10000) {
        break;
      }
    }

    return false;
  }

  /**
   * Prune refs that no longer exist on remote.
   */
  private async pruneDeletedRefs(
    remoteRefs: Map<string, Uint8Array>,
  ): Promise<TrackingRefUpdate[]> {
    const updates: TrackingRefUpdate[] = [];
    const prefix = `refs/remotes/${this.remote}/`;

    // Get remote ref names for comparison
    const remoteRefNames = new Set<string>();
    for (const refName of remoteRefs.keys()) {
      remoteRefNames.add(refName);
    }

    // Find local tracking refs that don't exist on remote
    for await (const ref of this.refsStore.list(prefix)) {
      // Skip symbolic refs
      if (isSymbolicRef(ref)) {
        continue;
      }

      // Derive remote ref name
      const localName = ref.name.slice(prefix.length);
      const remoteRefName = `refs/heads/${localName}`;

      if (!remoteRefNames.has(ref.name) && !remoteRefNames.has(remoteRefName)) {
        // Delete the local tracking ref
        await this.refsStore.delete(ref.name);
        updates.push({
          localRef: ref.name,
          remoteRef: remoteRefName,
          oldObjectId: ref.objectId,
          newObjectId: "", // Empty indicates deletion
          status: RefUpdateStatus.DELETED,
        });
      }
    }

    return updates;
  }

  /**
   * Store received pack data.
   */
  private async storePack(packData: Uint8Array): Promise<void> {
    // The store should handle unpacking the pack file
    // This depends on the store implementation
    // For stores with pack support, we'd call store.packs.store()
    // For object-based stores, we'd unpack and store individual objects

    // Check if store has pack storage capability
    const storeWithPacks = this.store as {
      packs?: { store(data: Uint8Array): Promise<void> };
    };
    if (storeWithPacks.packs?.store) {
      await storeWithPacks.packs.store(packData);
    }
    // Otherwise, objects will be stored individually by the transport layer
  }
}
