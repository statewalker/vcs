/**
 * Test utilities for storage-git tests
 *
 * Provides consistent FilesApi-based fixture loading and test setup.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { FilesApi, MemFilesApi, NodeFilesApi } from "@statewalker/webrun-files";

/**
 * Creates a FilesApi backed by the real filesystem.
 * Use for tests that need to read fixtures from disk.
 */
export function createNodeFilesApi(): FilesApi {
  return new FilesApi(new NodeFilesApi({ fs }));
}

/**
 * Creates a FilesApi backed by an in-memory filesystem.
 * Use for tests that don't need disk fixtures.
 */
export function createMemFilesApi(): FilesApi {
  return new FilesApi(new MemFilesApi());
}

/**
 * Load a fixture file from the pack fixtures directory.
 * Returns the raw bytes of the fixture file.
 */
export async function loadPackFixture(files: FilesApi, fixtureName: string): Promise<Uint8Array> {
  const fixturesDir = path.join(import.meta.dirname, "pack/fixtures");
  const fixturePath = path.join(fixturesDir, fixtureName);
  return files.readFile(fixturePath);
}

/**
 * Get the path to a pack fixture file.
 */
export function getPackFixturePath(fixtureName: string): string {
  const fixturesDir = path.join(import.meta.dirname, "pack/fixtures");
  return path.join(fixturesDir, fixtureName);
}

/**
 * Create a MemFilesApi pre-loaded with pack fixtures.
 * This allows running pack tests entirely in-memory.
 */
export async function createMemFilesApiWithPackFixtures(): Promise<{
  files: FilesApi;
  fixturesDir: string;
}> {
  const memFiles = new FilesApi(new MemFilesApi());
  const nodeFiles = createNodeFilesApi();
  const fixturesDir = "/fixtures";

  // Load all pack fixtures into memory
  const fixtures = [
    "pack-34be9032ac282b11fa9babdc2b2a93ca996c9c2f.idx",
    "pack-34be9032ac282b11fa9babdc2b2a93ca996c9c2f.idxV2",
    "pack-34be9032ac282b11fa9babdc2b2a93ca996c9c2f.pack",
    "pack-df2982f284bbabb6bdb59ee3fcc6eb0983e20371.idx",
    "pack-df2982f284bbabb6bdb59ee3fcc6eb0983e20371.idxV2",
    "pack-df2982f284bbabb6bdb59ee3fcc6eb0983e20371.pack",
  ];

  await memFiles.mkdir(fixturesDir);

  for (const fixture of fixtures) {
    const data = await loadPackFixture(nodeFiles, fixture);
    const destPath = memFiles.joinPath(fixturesDir, fixture);
    await memFiles.write(destPath, [data]);
  }

  return { files: memFiles, fixturesDir };
}
