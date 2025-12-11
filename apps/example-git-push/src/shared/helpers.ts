/**
 * Helper functions for the example app.
 */

import { execFile, execFileSync } from "node:child_process";
import * as fs from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Run a git command synchronously.
 * NOTE: Only use this when HTTP server is NOT running, as it blocks the event loop.
 */
export function runGit(args: string[], cwd: string): string {
  const result = execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  return result.trim();
}

/**
 * Run a git command asynchronously.
 * Use this when the HTTP server is running to avoid blocking the event loop.
 */
export async function runGitAsync(args: string[], cwd: string): Promise<string> {
  const result = await execFileAsync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  return result.stdout.trim();
}

/**
 * Run a git command and return success/failure.
 */
export function runGitSafe(args: string[], cwd: string): { ok: boolean; output: string } {
  try {
    const output = runGit(args, cwd);
    return { ok: true, output };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, output: message };
  }
}

/**
 * Run a git command asynchronously and return success/failure.
 */
export async function runGitSafeAsync(
  args: string[],
  cwd: string,
): Promise<{ ok: boolean; output: string }> {
  try {
    const output = await runGitAsync(args, cwd);
    return { ok: true, output };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, output: message };
  }
}

/**
 * Fix git object file permissions recursively.
 * Git clone/gc may create read-only pack files, but NodeFilesApi requires read permission.
 * This fixes permissions on all files in the .git/objects directory.
 */
export async function fixGitObjectPermissions(gitDir: string): Promise<void> {
  const objectsDir = `${gitDir}/objects`;

  async function fixDirPermissions(dirPath: string): Promise<void> {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = `${dirPath}/${entry.name}`;
        if (entry.isDirectory()) {
          await fixDirPermissions(fullPath);
        } else if (entry.isFile()) {
          await fs.chmod(fullPath, 0o644);
        }
      }
    } catch {
      // Directory might not exist
    }
  }

  await fixDirPermissions(objectsDir);
}

/**
 * Check if a directory exists.
 */
export async function directoryExists(path: string): Promise<boolean> {
  try {
    const stat = await fs.stat(path);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Remove a directory recursively.
 */
export async function removeDirectory(path: string): Promise<void> {
  try {
    await fs.rm(path, { recursive: true, force: true });
  } catch {
    // Ignore errors
  }
}

/**
 * Ensure a directory exists.
 */
export async function ensureDirectory(path: string): Promise<void> {
  await fs.mkdir(path, { recursive: true });
}

/**
 * Shorten an object ID for display.
 */
export function shortId(id: string): string {
  return id.slice(0, 7);
}

/**
 * Print a section header.
 */
export function printSection(title: string): void {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  ${title}`);
  console.log("=".repeat(60));
}

/**
 * Print a step message.
 */
export function printStep(step: number, message: string): void {
  console.log(`\n[Step ${step}] ${message}`);
  console.log("-".repeat(40));
}

/**
 * Print info message.
 */
export function printInfo(message: string): void {
  console.log(`  ${message}`);
}

/**
 * Print success message.
 */
export function printSuccess(message: string): void {
  console.log(`  ✓ ${message}`);
}

/**
 * Print error message.
 */
export function printError(message: string): void {
  console.log(`  ✗ ${message}`);
}

/**
 * Create author/committer information.
 */
export function createAuthor(timestamp?: number) {
  return {
    name: "VCS Example",
    email: "vcs@example.com",
    timestamp: timestamp ?? Math.floor(Date.now() / 1000),
    tzOffset: "+0000",
  };
}
