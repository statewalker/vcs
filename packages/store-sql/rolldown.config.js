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
  external: ["@statewalker/vcs-utils", "@statewalker/vcs-core", "sql.js"],
  treeshake: true,
});
