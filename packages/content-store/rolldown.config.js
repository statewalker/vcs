import { defineConfig } from "rolldown";

export default defineConfig({
  input: "src/index.ts",
  output: {
    dir: "dist",
    format: "esm",
    entryFileNames: "[name].js",
    chunkFileNames: "[name]-[hash].js",
  },
  external: [
    "@statewalker/webrun-files",
    /^@statewalker\/webrun-files\//,
    "@statewalker/storage",
  ],
  treeshake: true,
});
