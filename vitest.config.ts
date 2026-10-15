import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // The shared analysis package, read straight from its sources (its
      // tests run here too, see `include`).
      "@vivier/analysis": fileURLToPath(
        new URL("./packages/analysis/src/index.ts", import.meta.url),
      ),
      // "cloudflare:workers" only exists inside an actual Cloudflare Workers
      // runtime; vitest runs under Node, so every test file needs a stand-in
      // for it (see the stub's own doc comment).
      "cloudflare:workers": fileURLToPath(
        new URL("./src/testing/cloudflare-workers.stub.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    // Component tests opt into jsdom with a `// @vitest-environment jsdom`
    // header; everything else stays on the faster node environment.
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "packages/analysis/src/**/*.test.ts"],
    setupFiles: ["./src/testing/dom-setup.ts"],
  },
});
