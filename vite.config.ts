import { defineConfig, loadEnv, type UserConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { nitro } from "nitro/vite";

// Standard Vite/TanStack Start config: Tailwind, path aliases, TanStack Start
// with its client/server import protection, and Nitro's Cloudflare module
// preset for production builds.
export default defineConfig(({ command, mode }) => {
  const isDevBuild = command === "build" && mode === "development";
  const loadedEnv = loadEnv(mode, process.cwd(), "VITE_");
  const envDefine = Object.fromEntries(
    Object.entries(loadedEnv).map(([key, value]) => [
      `import.meta.env.${key}`,
      JSON.stringify(value),
    ]),
  );

  const config: UserConfig = {
    define: envDefine,
    ...(isDevBuild
      ? {
          environments: {
            client: { define: { "process.env.NODE_ENV": JSON.stringify("development") } },
          },
        }
      : {}),
    css: { transformer: "lightningcss" as const },
    build: {
      // "cloudflare:workers" (rate-limit.server.ts) is a real
      // built-in module inside the deployed Cloudflare Worker itself, never
      // something to bundle -- same idea as Node's own "node:*" builtins
      // being external by default. The file that imports it is server-only
      // by its `.server.ts` naming convention, so this never touches the
      // client bundle in practice.
      rollupOptions: { external: ["cloudflare:workers"] },
    },
    resolve: {
      // "@vivier/analysis" is the shared analysis package, read straight
      // from its sources here (the processor reads its built dist/).
      alias: {
        "@": `${process.cwd()}/src`,
        "@vivier/analysis": `${process.cwd()}/packages/analysis/src/index.ts`,
      },
      dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime"],
    },
    optimizeDeps: {
      include: [
        "react",
        "react-dom",
        "react-dom/client",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
      ],
      ignoreOutdatedRequests: true,
    },
    plugins: [
      tailwindcss(),
      tsConfigPaths({ projects: ["./tsconfig.json"] }),
      tanstackStart({
        // Redirect TanStack Start's bundled server entry to src/server.ts
        // (our SSR error wrapper). nitro/vite builds from this.
        server: { entry: "server" },
        importProtection: {
          behavior: "error",
          client: { files: ["**/server/**"], specifiers: ["server-only"] },
        },
      }),
      // Production builds target the Cloudflare Worker. NITRO_PRESET=node-server
      // builds the same site as a Node server for a local production preview
      // (`node .output/server/index.mjs`), which is how load times are measured.
      ...(command === "build"
        ? [
            nitro({
              preset: process.env["NITRO_PRESET"] ?? "cloudflare-module",
              // The Node preview serves pre-compressed files, as the edge does.
              compressPublicAssets: process.env["NITRO_PRESET"] === "node-server",
            }),
          ]
        : []),
      viteReact(),
    ],
  };

  return config;
});
