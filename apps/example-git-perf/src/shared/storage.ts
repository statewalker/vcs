/**
 * Storage initialization utilities using high-level Repository API
 */

import * as fs from "node:fs/promises";
import { createGitRepository, createNodeFilesApi, type GitRepository } from "@statewalker/vcs-core";
import { setCompression } from "@statewalker/vcs-utils";
import { createNodeCompression } from "@statewalker/vcs-utils/compression-node";
import { GIT_DIR, REPO_DIR } from "./config.js";

let compressionInitialized = false;

export function initCompression(): void {
  if (!compressionInitialized) {
    setCompression(createNodeCompression());
    compressionInitialized = true;
  }
}

export function createFilesApi() {
  return createNodeFilesApi({ fs, rootDir: REPO_DIR });
}

/**
 * Open storage using high-level Repository API.
 */
export async function openStorage(): Promise<GitRepository> {
  initCompression();
  const files = createFilesApi();
  // Use high-level Repository API via createGitRepository()
  return (await createGitRepository(files, GIT_DIR, { create: false })) as GitRepository;
}
