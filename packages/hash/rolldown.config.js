import { defineConfig } from "rolldown";

export default defineConfig({
  input: {
    index: "src/index.ts",
    "sha1/index": "src/sha1/index.ts",
    "fossil-checksum/index": "src/fossil-checksum/index.ts",
    "rolling-checksum/index": "src/rolling-checksum/index.ts",
    "strong-checksum/index": "src/strong-checksum/index.ts",
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
  treeshake: true,
});
