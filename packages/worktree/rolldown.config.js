import { defineConfig } from "rolldown";

export default defineConfig({
  input: "src/index.ts",
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
  external: [
    "@statewalker/webrun-files",
    "@webrun-vcs/vcs",
    "@webrun-vcs/utils",
    /^@webrun-vcs\/utils\//,
    "node:fs/promises",
    "node:fs",
    "node:path",
    "node:crypto",
  ],
  treeshake: true,
});
