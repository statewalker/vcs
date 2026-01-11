import { defineConfig } from "rolldown";

export default defineConfig({
  input: {
    index: "src/index.ts",
    "staging/index": "src/staging/index.ts",
    "common/format/index": "src/common/format/index.ts",
  },
  output: {
    dir: "dist",
    format: "esm",
    entryFileNames: "[name].js",
    chunkFileNames: "[name]-[hash].js",
  },
  external: [/^@statewalker\/vcs-utils/],
  treeshake: true,
});
