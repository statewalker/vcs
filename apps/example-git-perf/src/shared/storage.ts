/**
 * Storage initialization utilities
 */

import * as fs from "node:fs/promises";
import { FilesApi, NodeFilesApi } from "@statewalker/webrun-files";
import { setCompression } from "@webrun-vcs/compression";
import { createNodeCompression } from "@webrun-vcs/compression/compression-node";
import { createGitStorage, type GitStorage } from "@webrun-vcs/storage-git";
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

export async function openStorage(): Promise<GitStorage> {
  initCompression();
  const files = createFilesApi();
  return createGitStorage(files, GIT_DIR, { create: false });
}
