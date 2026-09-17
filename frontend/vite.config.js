import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    outDir: "../pages",
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(import.meta.dirname, "admin.html"),
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("@dnd-kit")) return "drag-drop";
          if (id.includes("@tanstack")) return "table";
          if (id.includes("lucide-react")) return "icons";
          if (id.includes("qrcode")) return "qrcode";
          return "react-vendor";
        },
      },
    },
  },
});
