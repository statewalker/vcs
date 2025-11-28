import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["**/tests/**/*.test.ts"],
    coverage: {
      reporter: ["text", "lcov"],
    },
  },
  resolve: {
    alias: {
      "@webrun-vcs/core": "/packages/core/src",
      "@webrun-vcs/diff": "/packages/diff/src",
    },
  },
});
