import path from "node:path";
import { defineConfig } from "vitest/config";

// Source-only umbrella: sibling workspace packages are not built (no dist), so
// resolve them to their TypeScript entrypoints, mirroring packages/core/vitest.config.ts.
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
      // vcs-utils(-node) expose many subpath exports; resolve them (and the bare
      // entry) to src. The `-node` regex must precede the plain one.
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
        replacement: path.resolve(import.meta.dirname, "../core/src/index.ts"),
      },
      {
        find: /^@statewalker\/vcs-working-tree\/transformation$/,
        replacement: path.resolve(import.meta.dirname, "../working-tree/src/transformation/index.ts"),
      },
      {
        find: /^@statewalker\/vcs-working-tree$/,
        replacement: path.resolve(import.meta.dirname, "../working-tree/src/index.ts"),
      },
      {
        find: /^@statewalker\/vcs-store-files$/,
        replacement: path.resolve(import.meta.dirname, "src/index.ts"),
      },
      {
        find: "@statewalker/storage",
        replacement: path.resolve(import.meta.dirname, "../storage/src/index.ts"),
      },
      {
        find: "@statewalker/webrun-files-node",
        replacement: path.join(webrunFiles, "webrun-files-node/src/index.ts"),
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
