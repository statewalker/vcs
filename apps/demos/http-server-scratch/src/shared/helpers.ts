/**
 * Helper functions for the HTTP server demo.
 */

import { execFile, execFileSync } from "node:child_process";
import * as fs from "node:fs/promises";
import { promisify } from "node:util";
import { basename, dirname, type FilesApi, joinPath } from "@statewalker/vcs-core";

const execFileAsync = promisify(execFile);

/**
 * Run a git command synchronously.
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
 * Check if a directory exists.
 */
export async function directoryExists(dirPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Remove a directory recursively.
 */
export async function removeDirectory(dirPath: string): Promise<void> {
  try {
    await fs.rm(dirPath, { recursive: true, force: true });
  } catch {
    // Ignore errors
  }
}

/**
 * Ensure a directory exists.
 */
export async function ensureDirectory(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
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
  console.log(`  [OK] ${message}`);
}

/**
 * Print error message.
 */
export function printError(message: string): void {
  console.log(`  [ERROR] ${message}`);
}

/**
 * Create author/committer information.
 */
export function createAuthor(timestamp?: number) {
  return {
    name: "HTTP Server Demo",
    email: "demo@example.com",
    timestamp: timestamp ?? Math.floor(Date.now() / 1000),
    tzOffset: "+0000",
  };
}

/**
 * Concatenate byte arrays.
 */
export function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

/**
 * Write a file atomically (via temp file + rename)
 */
export async function atomicWriteFile(
  files: FilesApi,
  path: string,
  content: Uint8Array,
): Promise<void> {
  const dir = dirname(path);
  const base = basename(path);
  const tempPath = joinPath(dir, `.${base}.tmp.${Date.now()}`);

  try {
    await files.write(tempPath, [content]);
    await files.move(tempPath, path);
  } catch (error) {
    try {
      await files.remove(tempPath);
    } catch {
      // Ignore cleanup errors
    }
    throw error;
  }
}

/**
 * Ensure a directory exists using FilesApi
 */
export async function ensureDirFiles(files: FilesApi, path: string): Promise<void> {
  await files.mkdir(path);
}
