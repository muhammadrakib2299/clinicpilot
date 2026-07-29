import { base } from "@clinicpilot/config/eslint/base";

// `.mjs` because apps/api is CommonJS (NestJS decorator emit) — ESLint resolves
// a bare `eslint.config.js` using the package `type`, which would break the
// ESM import above.
export default [
  ...base,
  {
    files: ["src/**/*.ts", "test/**/*.ts"],
    rules: {
      // Incompatible with NestJS dependency injection. Nest resolves
      // constructor dependencies from `design:paramtypes`, which TypeScript
      // only emits for imports that survive as *values*. Rewriting an injected
      // class to `import type` erases it from the emitted metadata and the
      // provider fails to resolve at runtime — a green build that 500s on the
      // first request. The rule cannot tell an injected class from a plain
      // type, so it is off for this workspace only; every other workspace
      // still enforces it.
      "@typescript-eslint/consistent-type-imports": "off",
    },
  },
  {
    // Seed and config scripts are CLIs run by a human. `console` is their user
    // interface, not leftover debugging, so the service-wide ban does not apply.
    files: ["src/db/seed.ts", "src/fhir/seed-hapi.ts", "drizzle.config.ts"],
    rules: { "no-console": "off" },
  },
];
