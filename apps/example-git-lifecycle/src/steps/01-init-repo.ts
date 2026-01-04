/**
 * Step 01: Initialize Repository with FilesApi
 *
 * Creates a new Git repository using the VCS library with FilesApi
 * for filesystem operations.
 */

import * as fs from "node:fs/promises";
import { createGitRepository, type GitRepository } from "@statewalker/vcs-core";
import {
  cleanupRepo,
  createFilesApi,
  GIT_DIR,
  log,
  logInfo,
  logSection,
  REPO_DIR,
  state,
} from "../shared/index.js";

export async function run(): Promise<void> {
  logSection("Step 01: Initialize Repository with FilesApi");

  log("Cleaning up any existing repository...");
  await cleanupRepo();

  log("Creating repository directory...");
  await fs.mkdir(REPO_DIR, { recursive: true });

  log("Initializing Git repository with VCS library...");
  const files = createFilesApi();

  const repository = (await createGitRepository(files, GIT_DIR, {
    create: true,
    defaultBranch: "main",
  })) as GitRepository;

  // Store repository in shared state
  state.repository = repository;

  logInfo("Repository created at", REPO_DIR);
  logInfo("Git directory", `${REPO_DIR}/${GIT_DIR}`);
  logInfo("Default branch", "main");

  log("Repository initialization complete!");
}
