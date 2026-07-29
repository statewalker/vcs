import path from "node:path";
import { defineConfig } from "vitest/config";

// vcs-core is source-only in this umbrella (dist is not built), and so are the
// sibling workspace packages its tests touch — resolve them to their TypeScript
// entrypoints, mirroring how the sibling packages' vitest configs alias to src.
const webrunFiles = path.resolve(import.meta.dirname, "../../../webrun-files/packages");

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    globals: false,
    environment: "node",
    testTimeout: 10000,
  },
  resolve: {
    alias: [
      // vcs-utils(-node) have many subpath exports (`./files`, `./hash/sha1`,
      // `./compression`, …), each mapping `./X → dist/X`; resolve them (and the
      // bare entry) to src. The `-node` regex must precede the plain one.
      {
        find: /^@statewalker\/vcs-utils-node\/(.*)$/,
        replacement: path.resolve(import.meta.dirname, "../utils-node/src/$1/index.ts"),
      },
      {
        find: /^@statewalker\/vcs-utils-node$/,
        replacement: path.resolve(import.meta.dirname, "../utils-node/src/index.ts"),
      },
      {
        find: /^@statewalker\/vcs-utils\/(.*)$/,
        replacement: path.resolve(import.meta.dirname, "../utils/src/$1/index.ts"),
      },
      {
        find: /^@statewalker\/vcs-utils$/,
        replacement: path.resolve(import.meta.dirname, "../utils/src/index.ts"),
      },
      {
        find: /^@statewalker\/vcs-core$/,
        replacement: path.resolve(import.meta.dirname, "src/index.ts"),
      },
      {
        find: "@statewalker/vcs-store-mem",
        replacement: path.resolve(import.meta.dirname, "../store-mem/src/index.ts"),
      },
      {
        // Transitive: a delta test imports vcs-store-mem, which imports
        // vcs-working-tree (staging types). Resolve it to src so the suite
        // runs on a clean checkout without vcs-working-tree's dist built.
        find: "@statewalker/vcs-working-tree",
        replacement: path.resolve(import.meta.dirname, "../working-tree/src/index.ts"),
      },
      {
        find: "@statewalker/storage",
        replacement: path.resolve(import.meta.dirname, "../storage/src/index.ts"),
      },
      {
        find: "@statewalker/webrun-files-mem",
        replacement: path.join(webrunFiles, "webrun-files-mem/src/index.ts"),
      },
      {
        find: "@statewalker/webrun-files",
        replacement: path.join(webrunFiles, "webrun-files/src/index.ts"),
      },
    ],
  },
});
