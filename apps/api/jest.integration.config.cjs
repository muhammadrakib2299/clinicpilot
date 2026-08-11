/**
 * Integration tests: the ones that need a real, migrated, seeded Postgres.
 *
 * A separate config rather than CLI flags, because Git Bash rewrites
 * path-shaped arguments — `--testPathIgnorePatterns "/node_modules/"` reached
 * jest as `C:\Program Files\Git\node_modules\`. Config files are not touched.
 *
 *   pnpm up:infra && pnpm db:migrate && pnpm db:rls && pnpm db:seed
 *   pnpm test:integration
 */
module.exports = {
  rootDir: ".",
  testEnvironment: "node",
  moduleFileExtensions: ["js", "json", "ts"],
  testRegex: "\\.integration\\.spec\\.ts$",
  transform: { "^.+\\.ts$": ["ts-jest", { tsconfig: "tsconfig.json" }] },
  // Loads the repo-root .env before the sandboxes exist. It cannot be done in
  // a spec: jest hands each test file a *copy* of process.env, and
  // `process.loadEnvFile` writes to the real process.
  globalSetup: "<rootDir>/test/load-env.cjs",
};
