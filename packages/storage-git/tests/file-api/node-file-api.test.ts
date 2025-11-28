/**
 * Tests for NodeFileApi
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { NodeFileApi } from "../../src/file-api/node-file-api.js";
import { createFileApiTestSuite } from "./file-api.suite.js";

let tempDir: string;

// Run shared test suite against NodeFileApi
createFileApiTestSuite(
  "NodeFileApi",
  async () => {
    // Create unique temp directory for each test
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "storage-git-test-"));
    return new NodeFileApi(tempDir);
  },
  async () => {
    // Cleanup temp directory after each test
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  },
);
