const { existsSync } = require("node:fs");
const { resolve } = require("node:path");

/**
 * Loads the repo-root `.env` before jest builds its test sandboxes.
 *
 * It has to happen here rather than in the spec. Jest's `node` test
 * environment hands each file a *copy* of `process.env`, and
 * `process.loadEnvFile` is a native binding that writes to the real process —
 * so calling it inside a test succeeds, changes nothing the test can see, and
 * the connection quietly falls back to the default URL on the default port.
 * That failure looks like "password authentication failed", which sends you
 * looking at credentials rather than at where they came from.
 *
 * `globalSetup` runs in jest's own process before any sandbox exists, so the
 * copy each one receives already has the values.
 */
module.exports = () => {
  const envFile = resolve(__dirname, "../../../.env");
  if (existsSync(envFile)) process.loadEnvFile(envFile);
};
