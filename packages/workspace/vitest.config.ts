import path from "node:path";
import { defineConfig } from "vitest/config";

// Source-only workspace members are resolved to their TypeScript entrypoints
// (their dist/ is not built in this umbrella), mirroring the sibling packages'
// vitest configs. More-specific aliases MUST precede their prefixes.
const webrunFiles = path.resolve(import.meta.dirname, "../../../webrun-files/packages");

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 10000,
  },
  resolve: {
    alias: [
      // vcs-utils(-node) subpath exports (`./files`, `./hash/sha1`, …) map to src;
      // the `-node` regex must precede the plain one.
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
        find: "@statewalker/files-sync",
        replacement: path.resolve(import.meta.dirname, "../files-sync/src/index.ts"),
      },
      {
        find: /^@statewalker\/vcs-working-tree\/transformation$/,
        replacement: path.resolve(
          import.meta.dirname,
          "../working-tree/src/transformation/index.ts",
        ),
      },
      {
        find: /^@statewalker\/vcs-working-tree\/staging$/,
        replacement: path.resolve(import.meta.dirname, "../working-tree/src/staging/index.ts"),
      },
      {
        find: /^@statewalker\/vcs-working-tree$/,
        replacement: path.resolve(import.meta.dirname, "../working-tree/src/index.ts"),
      },
      {
        find: "@statewalker/vcs-core",
        replacement: path.resolve(import.meta.dirname, "../core/src/index.ts"),
      },
      {
        find: "@statewalker/vcs-transport",
        replacement: path.resolve(import.meta.dirname, "../transport/src/index.ts"),
      },
      {
        find: "@statewalker/content-store",
        replacement: path.resolve(import.meta.dirname, "../content-store/src/index.ts"),
      },
      {
        find: "@statewalker/merge-core",
        replacement: path.resolve(import.meta.dirname, "../merge-core/src/index.ts"),
      },
      {
        find: "@statewalker/storage",
        replacement: path.resolve(import.meta.dirname, "../storage/src/index.ts"),
      },
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
