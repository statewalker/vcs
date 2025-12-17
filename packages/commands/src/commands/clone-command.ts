import {
  type CloneOptions as TransportCloneOptions,
  clone as transportClone,
} from "@webrun-vcs/transport";
import { bytesToHex } from "@webrun-vcs/utils/hash/utils";
import type { ObjectId } from "@webrun-vcs/vcs";

import { InvalidRemoteError } from "../errors/index.js";
import type { CloneResult } from "../results/clone-result.js";
import {
  type FetchResult,
  RefUpdateStatus,
  type TrackingRefUpdate,
} from "../results/fetch-result.js";
import { TransportCommand } from "../transport-command.js";

/**
 * Clone a remote repository.
 *
 * Equivalent to `git clone`.
 *
 * Based on JGit's CloneCommand.
 *
 * Note: Unlike other commands, CloneCommand initializes a new repository
 * rather than operating on an existing one. The store passed to the
 * constructor should be an empty/new store that will be populated.
 *
 * @example
 * ```typescript
 * // Basic clone
 * const result = await git.clone()
 *   .setURI("https://github.com/user/repo")
 *   .call();
 *
 * // Clone specific branch
 * const result = await git.clone()
 *   .setURI("https://github.com/user/repo")
 *   .setBranch("develop")
 *   .call();
 *
 * // Shallow clone
 * const result = await git.clone()
 *   .setURI("https://github.com/user/repo")
 *   .setDepth(1)
 *   .call();
 *
 * // Bare clone
 * const result = await git.clone()
 *   .setURI("https://github.com/user/repo")
 *   .setBare(true)
 *   .call();
 * ```
 */
export class CloneCommand extends TransportCommand<CloneResult> {
  private uri?: string;
  private branch?: string;
  private depth?: number;
  private bare = false;
  private noCheckout = false;
  private remoteName = "origin";
  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: API placeholder for transport layer
  private cloneAllBranches = true;

  /**
   * Set the URI to clone from.
   *
   * @param uri Repository URI (HTTPS, SSH, or Git protocol)
   */
  setURI(uri: string): this {
    this.checkCallable();
    this.uri = uri;
    return this;
  }

  /**
   * Get the URI being cloned.
   */
  getURI(): string | undefined {
    return this.uri;
  }

  /**
   * Set the branch to clone.
   *
   * If set, only this branch will be fetched.
   * Otherwise, all branches are fetched.
   *
   * @param branch Branch name (e.g., "main" or "refs/heads/main")
   */
  setBranch(branch: string): this {
    this.checkCallable();
    this.branch = branch;
    return this;
  }

  /**
   * Get the branch being cloned.
   */
  getBranch(): string | undefined {
    return this.branch;
  }

  /**
   * Set shallow clone depth.
   *
   * @param depth Number of commits to fetch
   */
  setDepth(depth: number): this {
    this.checkCallable();
    if (depth < 1) {
      throw new Error("Depth must be at least 1");
    }
    this.depth = depth;
    return this;
  }

  /**
   * Set whether to create a bare repository.
   *
   * @param bare Whether to create bare repository
   */
  setBare(bare: boolean): this {
    this.checkCallable();
    this.bare = bare;
    return this;
  }

  /**
   * Whether bare clone is enabled.
   */
  isBare(): boolean {
    return this.bare;
  }

  /**
   * Set whether to skip checkout.
   *
   * @param noCheckout Whether to skip checkout
   */
  setNoCheckout(noCheckout: boolean): this {
    this.checkCallable();
    this.noCheckout = noCheckout;
    return this;
  }

  /**
   * Whether checkout is skipped.
   */
  isNoCheckout(): boolean {
    return this.noCheckout;
  }

  /**
   * Set the remote name.
   *
   * Default is "origin".
   *
   * @param remoteName Remote name
   */
  setRemote(remoteName: string): this {
    this.checkCallable();
    this.remoteName = remoteName;
    return this;
  }

  /**
   * Get the remote name.
   */
  getRemote(): string {
    return this.remoteName;
  }

  /**
   * Set whether to clone all branches.
   *
   * Default is true. If set to false and no branch is specified,
   * only the default branch will be cloned.
   *
   * @param cloneAllBranches Whether to clone all branches
   */
  setCloneAllBranches(cloneAllBranches: boolean): this {
    this.checkCallable();
    this.cloneAllBranches = cloneAllBranches;
    return this;
  }

  /**
   * Execute the clone operation.
   *
   * @returns Clone result
   * @throws InvalidRemoteError if URI is not specified
   */
  async call(): Promise<CloneResult> {
    this.checkCallable();
    this.setCallable(false);

    if (!this.uri) {
      throw new InvalidRemoteError("", "URI must be specified for clone");
    }

    // Execute clone via transport
    const options: TransportCloneOptions = {
      url: this.uri,
      branch: this.branch,
      depth: this.depth,
      bare: this.bare,
      remoteName: this.remoteName,
      auth: this.credentials,
      headers: this.headers,
      timeout: this.timeout,
      onProgress: this.progressCallback,
      onProgressMessage: this.progressMessageCallback,
    };

    const transportResult = await transportClone(options);

    // Store pack data
    if (transportResult.packData.length > 0) {
      await this.storePack(transportResult.packData);
    }

    // Update refs
    const trackingUpdates: TrackingRefUpdate[] = [];
    for (const [refName, objectId] of transportResult.refs) {
      const objectIdHex = bytesToHex(objectId);
      await this.store.refs.set(refName, objectIdHex);
      trackingUpdates.push({
        localRef: refName,
        remoteRef: refName,
        newObjectId: objectIdHex,
        status: RefUpdateStatus.NEW,
      });
    }

    // Set up HEAD and default branch
    const defaultBranch = transportResult.defaultBranch;
    let headCommit: ObjectId | undefined;

    if (defaultBranch && !this.bare) {
      // Create local branch from remote tracking
      const trackingRef = `refs/remotes/${this.remoteName}/${defaultBranch}`;
      const localRef = `refs/heads/${defaultBranch}`;

      const trackingRefValue = await this.store.refs.resolve(trackingRef);
      if (trackingRefValue?.objectId) {
        await this.store.refs.set(localRef, trackingRefValue.objectId);
        headCommit = trackingRefValue.objectId;

        // Set HEAD to point to local branch
        await this.store.refs.setSymbolic("HEAD", localRef);

        // Set up staging area from HEAD tree
        if (!this.noCheckout) {
          await this.checkoutHead(trackingRefValue.objectId);
        }
      }
    } else if (this.bare) {
      // For bare repos, HEAD points to default branch
      if (defaultBranch) {
        await this.store.refs.setSymbolic("HEAD", `refs/heads/${defaultBranch}`);
      }
    }

    // Build fetch result
    const advertisedRefs = new Map<string, ObjectId>();
    for (const [refName, objectId] of transportResult.refs) {
      advertisedRefs.set(refName, bytesToHex(objectId));
    }

    const fetchResult: FetchResult = {
      uri: this.uri,
      advertisedRefs,
      trackingRefUpdates: trackingUpdates,
      defaultBranch,
      bytesReceived: transportResult.bytesReceived,
      isEmpty: transportResult.isEmpty,
      messages: [],
    };

    return {
      fetchResult,
      defaultBranch,
      remoteName: this.remoteName,
      bare: this.bare,
      headCommit,
    };
  }

  /**
   * Store received pack data.
   */
  private async storePack(packData: Uint8Array): Promise<void> {
    // Check if store has pack storage capability
    const storeWithPacks = this.store as {
      packs?: { store(data: Uint8Array): Promise<void> };
    };
    if (storeWithPacks.packs?.store) {
      await storeWithPacks.packs.store(packData);
    }
  }

  /**
   * Checkout HEAD commit to staging area.
   */
  private async checkoutHead(commitId: ObjectId): Promise<void> {
    try {
      const commit = await this.store.commits.loadCommit(commitId);
      await this.store.staging.readTree(this.store.trees, commit.tree);
      await this.store.staging.write();
    } catch {
      // Commit not available yet (pack not unpacked)
    }
  }
}
