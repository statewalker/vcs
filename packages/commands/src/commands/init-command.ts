import { createGitRepository, createInMemoryFilesApi, type FilesApi } from "@statewalker/vcs-core";
import { MemoryStagingStore } from "@statewalker/vcs-store-mem";

import { Git } from "../git.js";
import type { InitResult } from "../results/init-result.js";
import { createGitStore, type GitStore } from "../types.js";

/**
 * Command to initialize a new Git repository.
 *
 * Based on JGit's InitCommand pattern. This command creates a new
 * Git repository with the specified configuration.
 *
 * Note: Unlike other commands, InitCommand does not extend GitCommand
 * because it creates a new repository rather than operating on an existing one.
 *
 * @example
 * ```typescript
 * // Initialize in-memory repository
 * const result = await new InitCommand().call();
 * const git = result.git;
 *
 * // Initialize file-based repository
 * import { createNodeFilesApi } from "@statewalker/vcs-utils-node/files";
 * const files = createNodeFilesApi({ fs, rootDir: "/path/to/project" });
 * const result = await new InitCommand()
 *   .setFilesApi(files)
 *   .setDirectory(".git")
 *   .call();
 *
 * // Initialize bare repository
 * const result = await new InitCommand()
 *   .setBare(true)
 *   .setInitialBranch("main")
 *   .call();
 * ```
 */
export class InitCommand {
  private files?: FilesApi;
  private directory?: string;
  private gitDir?: string;
  private bare = false;
  private initialBranch = "main";
  private callable = true;

  /**
   * Set the FilesApi implementation for storage.
   *
   * If not set, an in-memory FilesApi will be used.
   *
   * @param files The FilesApi to use for repository storage
   * @returns this for method chaining
   */
  setFilesApi(files: FilesApi): this {
    this.checkCallable();
    this.files = files;
    return this;
  }

  /**
   * Set the working directory for the repository.
   *
   * For non-bare repositories, this is the parent of the .git directory.
   * If gitDir is not explicitly set, it will be `${directory}/.git`.
   *
   * @param directory The working directory path
   * @returns this for method chaining
   */
  setDirectory(directory: string): this {
    this.checkCallable();
    this.directory = directory;
    return this;
  }

  /**
   * Set the git directory path.
   *
   * For non-bare repositories, this is typically `.git` inside the working directory.
   * For bare repositories, this is the repository root.
   *
   * @param gitDir The .git directory path
   * @returns this for method chaining
   */
  setGitDir(gitDir: string): this {
    this.checkCallable();
    this.gitDir = gitDir;
    return this;
  }

  /**
   * Set whether to create a bare repository.
   *
   * Bare repositories have no working tree and are typically used
   * as central repositories for pushing/pulling.
   *
   * @param bare True for bare repository, false for normal
   * @returns this for method chaining
   */
  setBare(bare: boolean): this {
    this.checkCallable();
    this.bare = bare;
    return this;
  }

  /**
   * Set the initial branch name.
   *
   * This is the branch that HEAD will point to after initialization.
   * Defaults to "main".
   *
   * @param branch The initial branch name
   * @returns this for method chaining
   */
  setInitialBranch(branch: string): this {
    this.checkCallable();
    this.initialBranch = branch;
    return this;
  }

  /**
   * Execute the init command and create a new repository.
   *
   * @returns InitResult containing the Git facade, store, and repository
   * @throws Error if the command has already been called
   */
  async call(): Promise<InitResult> {
    this.checkCallable();
    this.setCallable(false);

    // Use in-memory FilesApi if none provided
    const files = this.files ?? createInMemoryFilesApi();

    // Determine git directory
    const gitDir = this.resolveGitDir();

    // Create the repository
    const repository = await createGitRepository(files, gitDir, {
      create: true,
      defaultBranch: this.initialBranch,
      bare: this.bare,
    });

    // Create staging store
    const staging = new MemoryStagingStore();

    // Create GitStore from repository
    const store: GitStore = createGitStore({
      repository,
      staging,
    });

    // Create Git facade
    const git = Git.wrap(store);

    return {
      git,
      store,
      repository,
      initialBranch: this.initialBranch,
      bare: this.bare,
      gitDir,
    };
  }

  /**
   * Resolve the git directory path based on configuration.
   */
  private resolveGitDir(): string {
    // If gitDir is explicitly set, use it
    if (this.gitDir !== undefined) {
      return this.gitDir;
    }

    // If directory is set, derive gitDir
    if (this.directory !== undefined) {
      if (this.bare) {
        // Bare repositories: the directory IS the git directory
        return this.directory;
      } else {
        // Normal repositories: .git inside the directory
        return `${this.directory}/.git`;
      }
    }

    // Default to .git
    return ".git";
  }

  /**
   * Check if the command is still callable.
   * @throws Error if the command has already been executed
   */
  private checkCallable(): void {
    if (!this.callable) {
      throw new Error("InitCommand can only be called once");
    }
  }

  /**
   * Set the callable state.
   */
  private setCallable(value: boolean): void {
    this.callable = value;
  }
}
