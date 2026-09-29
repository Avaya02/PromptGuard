import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // Monaco is large and only the run-detail route needs it, so it is
          // isolated into its own chunk that other routes never download.
          monaco: ["monaco-editor/esm/vs/editor/editor.api.js"],
          react: ["react", "react-dom", "react-router-dom"],
          charts: ["recharts"]
        }
      }
    },
    chunkSizeWarningLimit: 1500
  }
});
