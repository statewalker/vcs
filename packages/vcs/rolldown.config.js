import { defineConfig } from "rolldown";

export default defineConfig({
  input: {
    index: "src/index.ts",
    "interfaces/index": "src/interfaces/index.ts",
    "engine/index": "src/engine/index.ts",
    "base/index": "src/base/index.ts",
    "format/index": "src/format/index.ts",
    "stores/index": "src/stores/index.ts",
    "binary-storage/index": "src/binary-storage/index.ts",
    "object-storage/index": "src/object-storage/index.ts",
    "delta-compression/index": "src/delta-compression/index.ts",
    "garbage-collection/index": "src/garbage-collection/index.ts",
  },
  output: [
    {
      dir: "dist/esm",
      format: "esm",
      entryFileNames: "[name].js",
      chunkFileNames: "[name]-[hash].js",
    },
    {
      dir: "dist/cjs",
      format: "cjs",
      entryFileNames: "[name].cjs",
      chunkFileNames: "[name]-[hash].cjs",
    },
  ],
  external: ["@webrun-vcs/utils"],
  treeshake: true,
});
