/**
 * Configuration constants for the git performance benchmark
 */

import * as path from "node:path";

// export const GIT_REPO_URL = "https://github.com/git/git.git";
export const GIT_REPO_URL = "https://github.com/isomorphic-git/isomorphic-git";
export const REPO_DIR = path.join(process.cwd(), "git-repo");
export const GIT_DIR = ".git";
export const PERF_OUTPUT_FILE = path.join(process.cwd(), "performance-results.json");
export const COMMIT_LIMIT = 1000;
export const PACK_DIR = path.join(REPO_DIR, GIT_DIR, "objects", "pack");
