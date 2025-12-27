/**
 * Storage initialization utilities using high-level Repository API
 */

import * as fs from "node:fs/promises";
import { FilesApi, NodeFilesApi } from "@statewalker/webrun-files";
import { createGitRepository, type GitRepository } from "@webrun-vcs/core";
import { setCompression } from "@webrun-vcs/utils";
import { createNodeCompression } from "@webrun-vcs/utils/compression-node";
import { GIT_DIR, REPO_DIR } from "./config.js";

let compressionInitialized = false;

export function initCompression(): void {
  if (!compressionInitialized) {
    setCompression(createNodeCompression());
    compressionInitialized = true;
  }
}

export function createFilesApi(): FilesApi {
  const nodeFs = new NodeFilesApi({ fs, rootDir: REPO_DIR });
  return new FilesApi(nodeFs);
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
