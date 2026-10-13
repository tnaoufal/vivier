import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
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
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    setupFiles: ["./src/testing/dom-setup.ts"],
  },
});
