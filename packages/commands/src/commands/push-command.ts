import type { TagStore } from "@statewalker/vcs-core";
import { DefaultSerializationApi, isSymbolicRef } from "@statewalker/vcs-core";
import { httpPush, type RefStore as TransportRefStore } from "@statewalker/vcs-transport";
import { createVcsRepositoryFacade } from "@statewalker/vcs-transport-adapters";

/**
 * No-op TagStore for repositories without tag support.
 * Only used as a fallback when tags store is not provided.
 */
const noOpTagStore: TagStore = {
  storeTag: () => Promise.reject(new Error("Tag storage not available")),
  loadTag: () => Promise.reject(new Error("Tag storage not available")),
  getTarget: () => Promise.reject(new Error("Tag storage not available")),
  has: () => Promise.resolve(false),
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
    const tagsStore = this.store.tags ?? noOpTagStore;

    // Create serialization API from typed stores
    const serialization = new DefaultSerializationApi({
      stores: {
        blobs: this.store.blobs,
        trees: this.store.trees,
        commits: this.store.commits,
        tags: tagsStore,
        refs: this.store.refs,
      },
    });

    // Create repository facade for pack operations
    const repository = createVcsRepositoryFacade({
      blobs: this.store.blobs,
      trees: this.store.trees,
      commits: this.store.commits,
      tags: tagsStore,
      refs: this.store.refs,
      serialization,
    });

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
      atomic: this.atomic,
      pushOptions: this.pushOptions,
      credentials,
      headers: this.headers,
      timeout: this.timeout,
      onProgress: this.progressMessageCallback,
    });

    // Check for transport-level errors (invalid remote, network error, etc.)
    if (!transportResult.success && transportResult.error) {
      // Check if it's a refs fetch failure (404, network error, etc.)
      if (
        transportResult.error.includes("Failed to get refs") ||
        transportResult.error.includes("404") ||
        transportResult.error.includes("Network error")
      ) {
        throw new InvalidRemoteError(this.remote);
      }
    }

    // Convert to PushResult
    const remoteUpdates: RemoteRefUpdate[] = [];
    if (transportResult.refStatus) {
      for (const [refName, refStatus] of transportResult.refStatus) {
        remoteUpdates.push({
          remoteName: refName,
          newObjectId: "", // Not tracked in current httpPush
          status: refStatus.success ? PushStatus.OK : PushStatus.REJECTED_OTHER,
          message: refStatus.error,
          forceUpdate: this.force,
          delete: false,
        });
      }
    }

    return {
      uri: remoteUrl,
      remoteUpdates,
      bytesSent: 0, // httpPush doesn't track this currently
      objectCount: 0, // httpPush doesn't track this currently
      messages: transportResult.error ? [transportResult.error] : [],
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
    const refs = this.store.refs;

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
      for await (const ref of this.store.refs.list("refs/heads/")) {
        const spec = `${ref.name}:${ref.name}`;
        specs.push(this.force ? `+${spec}` : spec);
      }
    }

    // Push all tags
    if (this.pushTags) {
      for await (const ref of this.store.refs.list("refs/tags/")) {
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
}
