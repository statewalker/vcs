import { GitCommand } from "../git-command.js";

/**
 * Remote configuration entry.
 *
 * Based on JGit's RemoteConfig.
 */
export interface RemoteConfig {
  /** Remote name */
  name: string;
  /** Fetch URLs */
  urls: string[];
  /** Push URLs (defaults to fetch URLs if not set) */
  pushUrls: string[];
  /** Fetch refspecs */
  fetchRefspecs: string[];
  /** Push refspecs */
  pushRefspecs: string[];
}

/**
 * Add a remote to the repository.
 *
 * Equivalent to `git remote add`.
 *
 * Based on JGit's RemoteAddCommand.
 *
 * Note: This is a simplified implementation. Full remote configuration
 * would be stored in git config, but for now we store it in refs.
 *
 * @example
 * ```typescript
 * await git.remoteAdd()
 *   .setName("upstream")
 *   .setUri("https://github.com/user/repo")
 *   .call();
 * ```
 */
export class RemoteAddCommand extends GitCommand<RemoteConfig> {
  private name?: string;
  private uri?: string;
  private fetchRefspec?: string;

  /**
   * Set the remote name.
   *
   * @param name Remote name
   */
  setName(name: string): this {
    this.checkCallable();
    this.name = name;
    return this;
  }

  /**
   * Get the remote name.
   */
  getName(): string | undefined {
    return this.name;
  }

  /**
   * Set the remote URI.
   *
   * @param uri Remote URL
   */
  setUri(uri: string): this {
    this.checkCallable();
    this.uri = uri;
    return this;
  }

  /**
   * Get the remote URI.
   */
  getUri(): string | undefined {
    return this.uri;
  }

  /**
   * Set custom fetch refspec.
   *
   * If not set, defaults to +refs/heads/*:refs/remotes/{name}/*
   *
   * @param refspec Fetch refspec
   */
  setFetchRefspec(refspec: string): this {
    this.checkCallable();
    this.fetchRefspec = refspec;
    return this;
  }

  /**
   * Execute the remote add operation.
   *
   * @returns Remote configuration
   * @throws Error if name or URI is not set
   */
  async call(): Promise<RemoteConfig> {
    this.checkCallable();
    this.setCallable(false);

    if (!this.name) {
      throw new Error("Remote name must be specified");
    }
    if (!this.uri) {
      throw new Error("Remote URI must be specified");
    }

    // Check if remote already exists
    const existingRemote = await this.getRemoteConfig(this.name);
    if (existingRemote) {
      throw new Error(`Remote '${this.name}' already exists`);
    }

    // Default fetch refspec
    const fetchRefspec = this.fetchRefspec || `+refs/heads/*:refs/remotes/${this.name}/*`;

    // Create remote config
    const config: RemoteConfig = {
      name: this.name,
      urls: [this.uri],
      pushUrls: [],
      fetchRefspecs: [fetchRefspec],
      pushRefspecs: [],
    };

    // Store remote config
    await this.storeRemoteConfig(config);

    return config;
  }

  /**
   * Get existing remote config.
   */
  private async getRemoteConfig(name: string): Promise<RemoteConfig | undefined> {
    // Check if remote tracking refs exist
    let hasRefs = false;
    for await (const _ref of this.store.refs.list(`refs/remotes/${name}/`)) {
      hasRefs = true;
      break;
    }
    if (hasRefs) {
      // Remote exists (we don't have full config storage yet)
      return {
        name,
        urls: [],
        pushUrls: [],
        fetchRefspecs: [],
        pushRefspecs: [],
      };
    }
    return undefined;
  }

  /**
   * Store remote config.
   *
   * Note: This is a simplified implementation. Full config would go in .git/config.
   */
  private async storeRemoteConfig(_config: RemoteConfig): Promise<void> {
    // In a full implementation, this would write to git config
    // For now, remote config is implicit from the fetch/push operations
  }
}

/**
 * Remove a remote from the repository.
 *
 * Equivalent to `git remote remove`.
 *
 * Based on JGit's RemoteRemoveCommand.
 *
 * @example
 * ```typescript
 * await git.remoteRemove()
 *   .setRemoteName("upstream")
 *   .call();
 * ```
 */
export class RemoteRemoveCommand extends GitCommand<RemoteConfig | undefined> {
  private remoteName?: string;

  /**
   * Set the remote name to remove.
   *
   * @param name Remote name
   */
  setRemoteName(name: string): this {
    this.checkCallable();
    this.remoteName = name;
    return this;
  }

  /**
   * Get the remote name.
   */
  getRemoteName(): string | undefined {
    return this.remoteName;
  }

  /**
   * Execute the remote remove operation.
   *
   * @returns Removed remote config, or undefined if not found
   */
  async call(): Promise<RemoteConfig | undefined> {
    this.checkCallable();
    this.setCallable(false);

    if (!this.remoteName) {
      throw new Error("Remote name must be specified");
    }

    // Get refs to delete
    const refsToDelete: string[] = [];
    for await (const ref of this.store.refs.list(`refs/remotes/${this.remoteName}/`)) {
      refsToDelete.push(ref.name);
    }

    if (refsToDelete.length === 0) {
      return undefined;
    }

    // Delete refs
    for (const refName of refsToDelete) {
      await this.store.refs.delete(refName);
    }

    return {
      name: this.remoteName,
      urls: [],
      pushUrls: [],
      fetchRefspecs: [],
      pushRefspecs: [],
    };
  }
}

/**
 * List remotes in the repository.
 *
 * Equivalent to `git remote -v`.
 *
 * Based on JGit's RemoteListCommand.
 *
 * @example
 * ```typescript
 * const remotes = await git.remoteList().call();
 * for (const remote of remotes) {
 *   console.log(remote.name, remote.urls[0]);
 * }
 * ```
 */
export class RemoteListCommand extends GitCommand<RemoteConfig[]> {
  /**
   * Execute the remote list operation.
   *
   * @returns List of remote configurations
   */
  async call(): Promise<RemoteConfig[]> {
    this.checkCallable();
    this.setCallable(false);

    // Discover remotes from refs/remotes/* namespace
    const remoteNames = new Set<string>();
    for await (const ref of this.store.refs.list("refs/remotes/")) {
      // Extract remote name from ref
      const parts = ref.name.split("/");
      if (parts.length >= 3) {
        remoteNames.add(parts[2]);
      }
    }

    // Build remote configs
    const remotes: RemoteConfig[] = [];
    for (const name of remoteNames) {
      remotes.push({
        name,
        urls: [], // Would come from git config
        pushUrls: [],
        fetchRefspecs: [`+refs/heads/*:refs/remotes/${name}/*`],
        pushRefspecs: [],
      });
    }

    return remotes;
  }
}

/**
 * Set URL for a remote.
 *
 * Equivalent to `git remote set-url`.
 *
 * Based on JGit's RemoteSetUrlCommand.
 *
 * @example
 * ```typescript
 * await git.remoteSetUrl()
 *   .setRemoteName("origin")
 *   .setRemoteUri("https://github.com/user/repo")
 *   .call();
 * ```
 */
export class RemoteSetUrlCommand extends GitCommand<RemoteConfig> {
  private remoteName?: string;
  private remoteUri?: string;
  private pushUri = false;
  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: API placeholder for future implementation
  private oldUri?: string;

  /**
   * Set the remote name.
   *
   * @param name Remote name
   */
  setRemoteName(name: string): this {
    this.checkCallable();
    this.remoteName = name;
    return this;
  }

  /**
   * Get the remote name.
   */
  getRemoteName(): string | undefined {
    return this.remoteName;
  }

  /**
   * Set the new remote URI.
   *
   * @param uri New remote URL
   */
  setRemoteUri(uri: string): this {
    this.checkCallable();
    this.remoteUri = uri;
    return this;
  }

  /**
   * Get the new remote URI.
   */
  getRemoteUri(): string | undefined {
    return this.remoteUri;
  }

  /**
   * Set whether this is a push URL.
   *
   * @param push Whether to set push URL
   */
  setPush(push: boolean): this {
    this.checkCallable();
    this.pushUri = push;
    return this;
  }

  /**
   * Whether this is a push URL.
   */
  isPush(): boolean {
    return this.pushUri;
  }

  /**
   * Set the old URI to replace (for --add behavior).
   *
   * @param uri Old URI to replace
   */
  setOldUri(uri: string): this {
    this.checkCallable();
    this.oldUri = uri;
    return this;
  }

  /**
   * Execute the remote set-url operation.
   *
   * @returns Updated remote configuration
   * @throws Error if remote name or URI is not set
   */
  async call(): Promise<RemoteConfig> {
    this.checkCallable();
    this.setCallable(false);

    if (!this.remoteName) {
      throw new Error("Remote name must be specified");
    }
    if (!this.remoteUri) {
      throw new Error("Remote URI must be specified");
    }

    // Check if remote exists
    let hasRefs = false;
    for await (const _ref of this.store.refs.list(`refs/remotes/${this.remoteName}/`)) {
      hasRefs = true;
      break;
    }

    if (!hasRefs) {
      throw new Error(`Remote '${this.remoteName}' does not exist`);
    }

    // In a full implementation, this would update git config
    // For now, return the config with the new URL
    const urls = this.pushUri ? [] : [this.remoteUri];
    const pushUrls = this.pushUri ? [this.remoteUri] : [];

    return {
      name: this.remoteName,
      urls,
      pushUrls,
      fetchRefspecs: [`+refs/heads/*:refs/remotes/${this.remoteName}/*`],
      pushRefspecs: [],
    };
  }
}
