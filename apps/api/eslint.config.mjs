import { base } from "@clinicpilot/config/eslint/base";

// `.mjs` because apps/api is CommonJS (NestJS decorator emit) — ESLint resolves
// a bare `eslint.config.js` using the package `type`, which would break the
// ESM import above.
export default [
  ...base,
  {
    // Seed and config scripts are CLIs run by a human. `console` is their user
    // interface, not leftover debugging, so the service-wide ban does not apply.
    files: ["src/db/seed.ts", "src/fhir/seed-hapi.ts", "drizzle.config.ts"],
    rules: { "no-console": "off" },
  },
];
