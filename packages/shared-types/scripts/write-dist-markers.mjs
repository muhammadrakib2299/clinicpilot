import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Tells Node which module system each build directory uses.
 *
 * The package has no top-level `"type"`, so Node treats every `.js` as
 * CommonJS — including the ESM build, which would fail to load the moment
 * anything `import()`ed it directly rather than bundling it. Bundlers infer
 * the format from syntax and do not need this; Node does.
 */
const dist = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");

for (const [dir, type] of [
  ["cjs", "commonjs"],
  ["esm", "module"],
]) {
  mkdirSync(join(dist, dir), { recursive: true });
  writeFileSync(join(dist, dir, "package.json"), JSON.stringify({ type }, null, 2) + "\n");
}
