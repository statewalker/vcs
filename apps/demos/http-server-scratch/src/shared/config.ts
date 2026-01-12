/**
 * Configuration constants for the HTTP server demo.
 */

import * as path from "node:path";

/** Base directory for repositories */
export const BASE_DIR = path.join(process.cwd(), "repos");

/** Remote (server) repository directory */
export const REMOTE_REPO_DIR = path.join(BASE_DIR, "remote.git");

/** Local (cloned) repository directory */
export const LOCAL_REPO_DIR = path.join(BASE_DIR, "local");

/** Default HTTP server port */
export const HTTP_PORT = 8080;

/** Remote URL for the HTTP server */
export const REMOTE_URL = `http://localhost:${HTTP_PORT}/remote.git`;

/** Branch name to create and push */
export const TEST_BRANCH = "feature-branch";

/** Default branch name */
export const DEFAULT_BRANCH = "main";
