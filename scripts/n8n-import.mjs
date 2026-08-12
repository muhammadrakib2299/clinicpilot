import { readdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * Load `workflows/*.json` into the running n8n and switch them on.
 *
 *   pnpm n8n:import
 *
 * A script rather than three lines in `package.json`, for two reasons that are
 * both about this being reproducible rather than clever.
 *
 * **1. Activation is a separate step, and n8n says so.** `import:workflow`
 * deactivates everything it imports in a regular (non-queue) deployment, and
 * `--activeState=fromJson` is refused outright with "can only be used when n8n
 * is running in queue or multi-main mode". So each workflow is activated by id
 * afterwards, and n8n has to be restarted for a schedule trigger to be
 * registered — it prints "Please restart n8n for changes to take effect" and
 * means it.
 *
 * **2. Git Bash rewrites `/workflows` into a Windows path.** The container path
 * arrives at n8n as `C:/Program Files/Git/workflows` and the import finds
 * nothing — silently, reporting "Importing 0 workflows". The repo has hit this
 * once already (see the comment in `jest.integration.config.cjs`). `//workflows`
 * survives the rewrite and still resolves to `/workflows` inside the container.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const COMPOSE = ["compose", "-f", "infra/docker-compose.yml", "--env-file", ".env"];

/** The mount point, doubled so MSYS leaves it alone. */
const CONTAINER_DIR = "//workflows";

function docker(args, { capture = false } = {}) {
  const result = spawnSync("docker", args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (capture) process.stderr.write(result.stderr ?? "");
    process.exit(result.status ?? 1);
  }

  return result.stdout ?? "";
}

const n8n = (...args) => docker([...COMPOSE, "exec", "-T", "n8n", "n8n", ...args]);

const workflows = readdirSync(join(ROOT, "workflows"))
  .filter((name) => name.endsWith(".json"))
  .map((name) => JSON.parse(readFileSync(join(ROOT, "workflows", name), "utf8")));

if (workflows.length === 0) {
  console.error("No workflows found in ./workflows");
  process.exit(1);
}

n8n("import:workflow", "--separate", `--input=${CONTAINER_DIR}`);

// Every workflow carries a fixed `id`, which is what makes re-importing an
// update rather than a fourth copy of the same thing under the same name.
for (const workflow of workflows) {
  if (!workflow.id) {
    console.error(`${workflow.name}: no "id" — re-importing would duplicate it. Add one.`);
    process.exit(1);
  }
  if (workflow.active) {
    n8n("update:workflow", `--id=${workflow.id}`, "--active=true");
  }
}

// Schedule triggers are registered at startup, so this is not optional — an
// active workflow that n8n has not restarted into is a workflow that never runs.
docker([...COMPOSE, "restart", "n8n"]);

console.log(
  `\nImported and activated ${workflows.length} workflow(s), and restarted n8n.\n` +
    "Check it registered:  docker compose -f infra/docker-compose.yml logs n8n | grep Activated",
);
