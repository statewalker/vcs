import { defineConfig } from "rolldown";

export default defineConfig({
  input: {
    index: "src/index.ts",
    "workspace/staging/index": "src/workspace/staging/index.ts",
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
