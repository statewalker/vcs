import { defineConfig } from "vite";

export default defineConfig({
  build: {
    target: "esnext",
    outDir: "dist",
  },
  optimizeDeps: {
    exclude: ["@statewalker/vcs-store-mem", "@statewalker/vcs-transport-webrtc"],
  },
});
