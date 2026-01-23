/**
 * Shared utilities for the Git CLI sandbox
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createGitStore, Git, type GitStore } from "@statewalker/vcs-commands";
import {
  createFileTreeIterator,
  createGitRepository,
  FileStagingStore,
  type FilesApi,
  type GitRepository,
} from "@statewalker/vcs-core";
import { setCompressionUtils } from "@statewalker/vcs-utils";
import { createNodeCompression } from "@statewalker/vcs-utils-node/compression";
import { createNodeFilesApi } from "@statewalker/vcs-utils-node/files";

// Initialize compression for pack operations
setCompressionUtils(createNodeCompression());

/**
 * Context for CLI operations
 */
export interface CliContext {
  cwd: string;
  git: Git;
  store: GitStore;
  repository: GitRepository;
  files: FilesApi;
}

/**
 * Find the repository root from the current directory
 */
export async function findRepoRoot(startDir: string): Promise<string | null> {
  let dir = path.resolve(startDir);
  const root = path.parse(dir).root;

  while (dir !== root) {
    const gitDir = path.join(dir, ".git");

    try {
      const stat = await fs.stat(gitDir);
      if (stat.isDirectory()) {
        return dir;
      }
    } catch {
      // Not found, continue up
    }

    dir = path.dirname(dir);
  }

  return null;
}

/**
 * Open an existing repository
 */
export async function openRepository(repoDir: string): Promise<CliContext> {
  const files = createNodeFilesApi({ rootDir: repoDir });

  const repository = await createGitRepository(files, ".git", {
    create: false,
  });

  // Create worktree iterator for filesystem operations
  const worktree = createFileTreeIterator({
    files,
    rootPath: "",
    gitDir: ".git",
  });

  const staging = new FileStagingStore(files, ".git/index");
  await staging.read();
  const store = createGitStore({
    repository,
    staging,
    worktree,
    files,
    workTreeRoot: "",
  });

  const git = Git.wrap(store);

  return {
    cwd: repoDir,
    git,
    store,
    repository,
    files,
  };
}

/**
 * Initialize a new repository
 */
export async function initRepository(
  repoDir: string,
  options: { bare?: boolean; defaultBranch?: string } = {},
): Promise<CliContext> {
  const files = createNodeFilesApi({ rootDir: repoDir });

  const gitDir = options.bare ? "." : ".git";
  const repository = await createGitRepository(files, gitDir, {
    create: true,
    bare: options.bare,
    defaultBranch: options.defaultBranch || "main",
  });

  // Create worktree iterator for filesystem operations (if not bare)
  const worktree = options.bare
    ? undefined
    : createFileTreeIterator({
        files,
        rootPath: "",
        gitDir: ".git",
      });

  const indexPath = options.bare ? "index" : ".git/index";
  const staging = new FileStagingStore(files, indexPath);
  const store = createGitStore({
    repository,
    staging,
    worktree,
    files: options.bare ? undefined : files,
    workTreeRoot: options.bare ? undefined : "",
  });
  const git = Git.wrap(store);

  return {
    cwd: repoDir,
    git,
    store,
    repository,
    files,
  };
}

/**
 * Format a SHA-1 hash for display (short form)
 */
export function shortId(id: string, length = 7): string {
  return id.slice(0, length);
}

/**
 * Format a date for display
 */
export function formatDate(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString();
}

/**
 * Print output styling utilities
 */
export const colors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
};

export function colorize(text: string, ...codes: string[]): string {
  if (!process.stdout.isTTY) {
    return text;
  }
  return `${codes.join("")}${text}${colors.reset}`;
}

export function success(text: string): string {
  return colorize(text, colors.green);
}

export function error(text: string): string {
  return colorize(text, colors.red);
}

export function warning(text: string): string {
  return colorize(text, colors.yellow);
}

export function info(text: string): string {
  return colorize(text, colors.cyan);
}

export function dim(text: string): string {
  return colorize(text, colors.dim);
}

export function bold(text: string): string {
  return colorize(text, colors.bold);
}

/**
 * Parse author/committer string
 */
export function formatAuthor(name: string, email: string): string {
  return `${name} <${email}>`;
}

/**
 * Get default author from environment or use placeholder
 */
export function getDefaultAuthor(): { name: string; email: string } {
  return {
    name: process.env.GIT_AUTHOR_NAME || process.env.USER || "User",
    email: process.env.GIT_AUTHOR_EMAIL || `${process.env.USER || "user"}@localhost`,
  };
}

/**
 * Print an error and exit
 */
export function fatal(message: string): never {
  console.error(error(`fatal: ${message}`));
  process.exit(1);
}

/**
 * Ensure we're in a repository
 */
export async function requireRepository(): Promise<CliContext> {
  const repoRoot = await findRepoRoot(process.cwd());
  if (!repoRoot) {
    fatal("not a git repository (or any of the parent directories): .git");
  }
  return openRepository(repoRoot);
}

/**
 * Text encoder for content
 */
export const textEncoder = new TextEncoder();
export const textDecoder = new TextDecoder();
