import path from "node:path";
import { defineConfig } from "vitest/config";

// The webrun-files packages are source-only workspace members in this umbrella
// (their dist/ is not built), so resolve them to their TypeScript entrypoints —
// mirroring how the repo-root vitest config aliases its own packages to src.
const webrunFiles = path.resolve(import.meta.dirname, "../../../webrun-files/packages");

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: [
      {
        find: "@statewalker/webrun-files-mem",
        replacement: path.resolve(webrunFiles, "webrun-files-mem/src/index.ts"),
      },
      {
        find: "@statewalker/webrun-files",
        replacement: path.resolve(webrunFiles, "webrun-files/src/index.ts"),
      },
    ],
  },
});
