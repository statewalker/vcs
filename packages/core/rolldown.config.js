import { defineConfig } from "rolldown";

export default defineConfig({
  input: {
    index: "src/index.ts",
    "staging/index": "src/staging/index.ts",
    "format/index": "src/format/index.ts",
  },
  output: {
    dir: "dist",
    format: "esm",
    entryFileNames: "[name].js",
    chunkFileNames: "[name]-[hash].js",
  },
  external: [/^@webrun-vcs\/utils/],
  treeshake: true,
});
