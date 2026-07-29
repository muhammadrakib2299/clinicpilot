import { base } from "@clinicpilot/config/eslint/base";

// `.mjs` because apps/api is CommonJS (NestJS decorator emit) — ESLint resolves
// a bare `eslint.config.js` using the package `type`, which would break the
// ESM import above.
export default base;
