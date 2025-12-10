/**
 * Helper functions for the git performance benchmark
 */

import { execSync, spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import type { ObjectId } from "@webrun-vcs/storage";
import { PACK_DIR, REPO_DIR } from "./config.js";

export function shortId(id: ObjectId): string {
  return id.substring(0, 7);
}

export function printSection(title: string): void {
  console.log(`\n${"=".repeat(70)}`);
  console.log(`  ${title}`);
  console.log("=".repeat(70));
}

export function printInfo(label: string, value: string | number | boolean): void {
  console.log(`  ${label}: ${value}`);
}

export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms.toFixed(2)} ms`;
  }
  if (ms < 60000) {
    return `${(ms / 1000).toFixed(2)} s`;
  }
  return `${(ms / 60000).toFixed(2)} min`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export async function directoryExists(dirPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

export async function listPackFiles(): Promise<{ name: string; size: number }[]> {
  const packs: { name: string; size: number }[] = [];

  try {
    const files = await fs.readdir(PACK_DIR);
    for (const file of files) {
      if (file.endsWith(".pack")) {
        const packPath = `${PACK_DIR}/${file}`;
        const stats = await fs.stat(packPath);
        packs.push({ name: file, size: stats.size });
      }
    }
  } catch {
    // Pack directory doesn't exist
  }

  return packs;
}

export function runGitCommand(cmd: string, cwd: string = REPO_DIR): string {
  try {
    return execSync(cmd, { cwd, encoding: "utf-8", maxBuffer: 50 * 1024 * 1024 }).trim();
  } catch (error) {
    const e = error as { stderr?: string; message?: string };
    throw new Error(`Git command failed: ${e.stderr || e.message}`);
  }
}

export async function runGitCommandAsync(args: string[], cwd: string = REPO_DIR): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("git", args, { cwd, stdio: "inherit" });
    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Git command failed with code ${code}`));
      }
    });
    proc.on("error", reject);
  });
}

export function printBanner(title: string, subtitle?: string): void {
  console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║                                                                              ║
║           ${title.padEnd(64)}║
║                                                                              ║${subtitle ? `\n║  ${subtitle.padEnd(74)}║\n║                                                                              ║` : ""}
╚══════════════════════════════════════════════════════════════════════════════╝
`);
}

/**
 * Fix git object file permissions recursively.
 * Git gc creates read-only pack files, but NodeFilesApi requires write permission.
 * This fixes permissions on all files in the .git/objects directory.
 */
export async function fixGitObjectPermissions(): Promise<void> {
  const objectsDir = `${REPO_DIR}/.git/objects`;

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
