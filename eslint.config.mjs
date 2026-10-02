import { dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { FlatCompat } from "@eslint/eslintrc"

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) })

const config = [
  {
    ignores: [".next/**", "out/**", "node_modules/**", "next-env.d.ts", ".playwright-mcp/**", "index.html"],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    // Tooling config files are CommonJS.
    files: ["*.config.js"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  {
    // The service worker runs in its own global scope, outside the app bundle.
    files: ["public/sw.js"],
    languageOptions: { globals: { self: "readonly", caches: "readonly", fetch: "readonly", URL: "readonly", Response: "readonly" } },
  },
]

export default config
