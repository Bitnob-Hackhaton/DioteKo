import { defineConfig, loadEnv } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { nitro } from "nitro/vite";
import path from "node:path";

// Les variables VITE_* sont figées au build : rebuild pour changer l'URL de l'API.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const define = Object.fromEntries(
    Object.entries(env).map(([key, value]) => [`import.meta.env.${key}`, JSON.stringify(value)]),
  );

  return {
    define,
    resolve: {
      alias: { "@": path.resolve(process.cwd(), "src") },
      dedupe: [
        "react",
        "react-dom",
        "@tanstack/react-query",
        "@tanstack/react-router",
        "@tanstack/react-start",
      ],
    },
    server: { port: 3000 },
    plugins: [
      tsconfigPaths(),
      tailwindcss(),
      // Entrée serveur : src/server.ts (enveloppe d'erreur SSR).
      tanstackStart({ server: { entry: "server" } }),
      // Build : serveur Node autonome (`node .output/server/index.mjs`).
      nitro({ preset: "node-server" }),
      viteReact(),
    ],
  };
});
