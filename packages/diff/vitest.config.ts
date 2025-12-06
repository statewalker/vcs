import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@webrun-vcs/diff": resolve(__dirname, "./src"),
      "@webrun-vcs/hash/fossil-checksum": resolve(__dirname, "../hash/src/fossil-checksum/index.ts"),
      "@webrun-vcs/hash/rolling-checksum": resolve(__dirname, "../hash/src/rolling-checksum/index.ts"),
      "@webrun-vcs/hash/strong-checksum": resolve(__dirname, "../hash/src/strong-checksum/index.ts"),
      "@webrun-vcs/hash/sha1": resolve(__dirname, "../hash/src/sha1/index.ts"),
      "@webrun-vcs/hash": resolve(__dirname, "../hash/src/index.ts"),
    },
  },
});
