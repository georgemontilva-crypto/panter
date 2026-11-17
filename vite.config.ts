import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    // En desarrollo la API corre aparte (npm run dev:server) en el puerto 3001.
    proxy: { "/api": "http://localhost:3001" },
  },
});
