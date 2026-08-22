import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: path.resolve(import.meta.dirname, "client"),
  publicDir: path.resolve(import.meta.dirname, "client/public"),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client/src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
    },
  },
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    host: "0.0.0.0",
    allowedHosts: [
      "5173-i5mhl4gp6gqoi32rrl979-7cd62328.sg1.manus.computer",
      ".manus.computer",
      ".manuspre.computer",
      ".manus-asia.computer",
      "localhost",
      "127.0.0.1",
    ],
    proxy: {
      "/api/ocr": {
        target: "https://vellum-tides.vercel.app",
        changeOrigin: true,
      },
    },
  },
});
