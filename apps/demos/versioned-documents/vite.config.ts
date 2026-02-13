import { defineConfig } from "vite";

export default defineConfig({
  build: {
    target: "esnext",
    outDir: "dist",
  },
  optimizeDeps: {
    exclude: ["@statewalker/vcs-core", "@statewalker/vcs-commands"],
  },
});
