import js from "@eslint/js";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist", ".output", ".vinxi"],
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // eslint-plugin-react-hooks 7 ships the React Compiler's diagnostics.
      // This app does not run the compiler, and three of those rules flag
      // deliberate patterns here (ref-backed retained pools read during
      // render, state synced from effects, hand-tuned memo dependencies) that
      // the compiler would otherwise take over. Keep the rest of the set on.
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/preserve-manual-memoization": "off",
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "server-only",
              message:
                "TanStack Start does not use the Next.js `server-only` package. Rename the module to `*.server.ts` or mark it with `@tanstack/react-start/server-only`.",
            },
          ],
        },
      ],
      // TanStack Start route files must export their `Route` next to the
      // route component; that named export is part of the framework contract.
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true, allowExportNames: ["Route"] },
      ],
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  {
    // TanStack Start route files export a `Route` object whose component is
    // a local function; the router plugin owns HMR for those files, so the
    // Fast Refresh heuristic ("move components to their own file") does not
    // apply to them.
    files: ["src/routes/**/*.tsx"],
    rules: { "react-refresh/only-export-components": "off" },
  },
  {
    // shadcn/ui primitives export their cva variants next to the component
    // (buttonVariants, badgeVariants...) by design; that pattern is shared
    // across the whole ecosystem and only affects dev-time Fast Refresh.
    files: ["src/components/ui/**/*.tsx"],
    rules: { "react-refresh/only-export-components": "off" },
  },
  eslintPluginPrettier,
);
