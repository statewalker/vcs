import { defineConfig } from "rolldown";

export default defineConfig({
  input: "src/index.ts",
  output: [
    {
      dir: "dist/esm",
      format: "esm",
    },
    {
      dir: "dist/cjs",
      format: "cjs",
    },
  ],
  external: [
    "@webrun-vcs/compression",
    "@webrun-vcs/diff",
    "@webrun-vcs/storage",
    "@webrun-vcs/storage-default",
    "@webrun-vcs/storage-mem",
  ],
  treeshake: true,
});
