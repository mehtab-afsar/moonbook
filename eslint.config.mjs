import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vendored runtime bundled into supabase/.temp by `supabase start` — not
    // project source, and it's gitignored.
    "supabase/.temp/**",
    "supabase/.branches/**",
    "test-results/**",
    "playwright-report/**",
  ]),
  {
    // Playwright fixtures are declared as `async ({ deps }, use) => { … }` and
    // the rule sees a bare call to something named `use` inside a function
    // that is not a component. It is not a React hook and there is no React
    // here at all — the whole directory runs in node, driving a browser.
    files: ["e2e/**/*.ts"],
    rules: { "react-hooks/rules-of-hooks": "off" },
  },
]);

export default eslintConfig;
