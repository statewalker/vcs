import path from "node:path";
import { defineConfig } from "vitest/config";

// The webrun-files packages are source-only workspace members in this umbrella
// (their dist/ is not built), so resolve them to their TypeScript entrypoints.
// merge-core is a same-repo sibling package, resolved to its own src.
const webrunFiles = path.resolve(import.meta.dirname, "../../../webrun-files/packages");

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    // More specific finds (`-mem`, `merge-core`) must precede the shorter
    // `@statewalker/webrun-files` prefix so aliasing does not shadow them.
    alias: [
      {
        find: "@statewalker/webrun-files-mem",
        replacement: path.resolve(webrunFiles, "webrun-files-mem/src/index.ts"),
      },
      {
        find: "@statewalker/merge-core",
        replacement: path.resolve(import.meta.dirname, "../merge-core/src/index.ts"),
      },
      {
        find: "@statewalker/webrun-files",
        replacement: path.resolve(webrunFiles, "webrun-files/src/index.ts"),
      },
    ],
  },
});
