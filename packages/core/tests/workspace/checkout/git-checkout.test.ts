/**
 * Tests for GitCheckout implementation
 *
 * Runs conformance tests against the Git file-based Checkout implementation.
 */

import { createInMemoryFilesApi } from "@statewalker/vcs-utils/files";
import { MemoryRefs } from "../../../src/history/refs/refs.impl.js";
import type { Checkout } from "../../../src/workspace/checkout/checkout.js";
import {
  GitCheckout,
  type GitCheckoutFilesApi,
} from "../../../src/workspace/checkout/git-checkout.js";
import { SimpleStaging } from "../../../src/workspace/staging/simple-staging.js";
import { checkoutConformanceTests } from "./checkout.conformance.test.js";

let checkout: GitCheckout;
let staging: SimpleStaging;
let refs: MemoryRefs;
let files: GitCheckoutFilesApi;

checkoutConformanceTests(
  "GitCheckout",
  async (): Promise<Checkout> => {
    // Create in-memory filesystem
    const baseFiles = createInMemoryFilesApi();

    // Create adapter to convert FilesApi to GitCheckoutFilesApi
    files = {
      // Adapt read() to return Promise<Uint8Array | undefined>
      read: async (path: string): Promise<Uint8Array | undefined> => {
        try {
          const chunks: Uint8Array[] = [];
          for await (const chunk of baseFiles.read(path)) {
            chunks.push(chunk);
          }
          if (chunks.length === 0) return undefined;
          // Concatenate chunks
          const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
          const result = new Uint8Array(totalLength);
          let offset = 0;
          for (const chunk of chunks) {
            result.set(chunk, offset);
            offset += chunk.length;
          }
          return result;
        } catch {
          return undefined;
        }
      },
      stats: async (path: string): Promise<{ isDirectory: boolean } | undefined> => {
        const fileStats = await baseFiles.stats(path);
        if (!fileStats) return undefined;
        return { isDirectory: fileStats.kind === "directory" };
      },
      write: baseFiles.write.bind(baseFiles),
      mkdir: baseFiles.mkdir.bind(baseFiles),
      remove: baseFiles.remove.bind(baseFiles),
      removeDir: async (path: string): Promise<void> => {
        await baseFiles.remove(path);
      },
    } as GitCheckoutFilesApi;

    // Create initial HEAD
    staging = new SimpleStaging();
    refs = new MemoryRefs();

    // Initialize HEAD to point to main branch
    await refs.setSymbolic("HEAD", "refs/heads/main");

    checkout = new GitCheckout({
      staging,
      refs,
      files,
      gitDir: "/.git",
    });

    return checkout;
  },
  async (): Promise<void> => {
    // Cleanup
    refs.clear();
  },
);
