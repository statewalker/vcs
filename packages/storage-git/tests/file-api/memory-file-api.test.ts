/**
 * Tests for MemoryFileApi
 */

import { MemoryFileApi } from "../../src/file-api/memory-file-api.js";
import { createFileApiTestSuite } from "./file-api.suite.js";

// Run shared test suite against MemoryFileApi
createFileApiTestSuite("MemoryFileApi", () => new MemoryFileApi());
