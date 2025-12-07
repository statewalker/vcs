import { defineConfig } from "rolldown";

export default defineConfig({
  input: {
    index: "src/index.ts",
    "adapters/sql-js-adapter": "src/adapters/sql-js-adapter.ts",
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
  external: ["@webrun-vcs/compression", "@webrun-vcs/storage", "@webrun-vcs/storage-default", "sql.js"],
  treeshake: true,
});
