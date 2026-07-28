import path from "node:path";
import { defineConfig } from "vitest/config";

// Source-only workspace members are resolved to their TypeScript entrypoints
// (their dist/ is not built in this umbrella), mirroring the sibling packages.
// More-specific aliases MUST come first so `-mem` wins over the `webrun-files` prefix.
const webrunFiles = path.resolve(import.meta.dirname, "../../../webrun-files/packages");
const webrunWire = path.resolve(import.meta.dirname, "../../../webrun-wire/packages");

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
      {
        find: "@statewalker/content-store",
        replacement: path.resolve(import.meta.dirname, "../content-store/src/index.ts"),
      },
      {
        find: "@statewalker/storage",
        replacement: path.resolve(import.meta.dirname, "../storage/src/index.ts"),
      },
      {
        find: "@statewalker/files-sync",
        replacement: path.resolve(import.meta.dirname, "../files-sync/src/index.ts"),
      },
      {
        find: "@statewalker/webrun-streams",
        replacement: path.resolve(webrunWire, "webrun-streams/src/index.ts"),
      },
    ],
  },
});
