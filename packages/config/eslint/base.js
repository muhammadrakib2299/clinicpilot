import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

/**
 * Base ESLint flat config shared by every TypeScript workspace.
 *
 * Deliberately type-*un*aware (no `projectService`): it keeps CI fast and lets
 * the same config serve apps and packages without per-workspace tsconfig
 * plumbing. `tsc --noEmit` is the type-correctness gate; ESLint is the style
 * and footgun gate.
 */
export const base = tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/build/**",
      "**/coverage/**",
      "**/node_modules/**",
      "**/*.tsbuildinfo",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.node },
    },
    rules: {
      // Underscore prefix is the agreed opt-out for intentionally unused bindings.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      // Structured logging replaces console in Phase 1; warn keeps CI green meanwhile.
      "no-console": ["warn", { allow: ["warn", "error"] }],
      eqeqeq: ["error", "smart"],
      "prefer-const": "error",
      "no-var": "error",
    },
  },
);

export default base;
