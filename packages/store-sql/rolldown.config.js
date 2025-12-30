import { defineConfig } from "rolldown";

export default defineConfig({
  input: {
    index: "src/index.ts",
    "adapters/sql-js-adapter": "src/adapters/sql-js-adapter.ts",
  },
  output: {
    dir: "dist",
    format: "esm",
    entryFileNames: "[name].js",
    chunkFileNames: "[name]-[hash].js",
  },
  external: [
    "@webrun-vcs/compression",
    "@webrun-vcs/storage",
    "@webrun-vcs/storage-default",
    "sql.js",
  ],
  treeshake: true,
});
