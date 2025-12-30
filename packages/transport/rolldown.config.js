import { defineConfig } from "rolldown";

export default defineConfig({
  input: {
    index: "src/index.ts",
    "protocol/index": "src/protocol/index.ts",
    "negotiation/index": "src/negotiation/index.ts",
    "connection/index": "src/connection/index.ts",
    "operations/index": "src/operations/index.ts",
    "streams/index": "src/streams/index.ts",
  },
  output: {
    dir: "dist",
    format: "esm",
    entryFileNames: "[name].js",
    chunkFileNames: "[name]-[hash].js",
  },
  treeshake: true,
});
