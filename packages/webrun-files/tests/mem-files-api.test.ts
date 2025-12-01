/**
 * Tests for MemFilesApi implementation
 */

import { describe } from "vitest";
import { FilesApi, MemFilesApi } from "../src/index.js";
import { runFilesApiTestSuite } from "./shared/files-api-test-suite.js";

describe("MemFilesApi", () => {
  runFilesApiTestSuite({
    name: "MemFilesApi",

    createApi: () => {
      return new FilesApi(new MemFilesApi());
    },

    features: {
      nativeMove: false,
      nativeCopy: false,
      permissions: false,
      preciseTimestamps: true,
      maxFileSize: 50 * 1024 * 1024, // 50MB limit for memory
    },
  });
});
