/**
 * Tests for NodeFilesApi implementation
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe } from "vitest";
import { FilesApi, NodeFilesApi } from "../src/index.js";
import { runFilesApiTestSuite } from "./shared/files-api-test-suite.js";

describe("NodeFilesApi", () => {
  let testDir: string;

  runFilesApiTestSuite({
    name: "NodeFilesApi",

    createApi: async () => {
      // Create unique temp directory for each test
      testDir = await fs.mkdtemp(path.join(os.tmpdir(), "filesapi-test-"));

      const nodeFs = new NodeFilesApi({
        fs,
        rootDir: testDir,
      });

      return new FilesApi(nodeFs);
    },

    cleanup: async () => {
      // Remove test directory after each test
      if (testDir) {
        await fs.rm(testDir, { recursive: true, force: true });
      }
    },

    features: {
      nativeMove: true,
      nativeCopy: true,
      permissions: true,
      preciseTimestamps: true,
    },
  });
});
