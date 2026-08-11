/**
 * Refuses to start production with development secrets.
 *
 * `.env.example` ships `change-me-dev-only`, which is correct for a file in a
 * public repository and catastrophic if it reaches a deployment. Nothing about
 * a working local run distinguishes the two — the app boots identically either
 * way — so the check has to be explicit.
 *
 * Deliberately fatal rather than a warning. A warning in a startup log is
 * something you read after the incident.
 */

/** Values that appear in `.env.example` or are obviously placeholders. */
const KNOWN_PLACEHOLDERS = [
  "change-me-dev-only",
  "dev-service-token-change-me",
  "changeme",
  "secret",
  "password",
  "clinicpilot_app_dev",
];

const MIN_LENGTH = 16;

export interface SecretIssue {
  name: string;
  problem: string;
}

/**
 * Checks the secrets a production deployment must have set properly.
 *
 * Returns the problems rather than throwing, so the caller can report all of
 * them at once. Being told about one missing variable per restart is a way to
 * spend an afternoon on a five-minute task.
 */
export function auditSecrets(env: NodeJS.ProcessEnv = process.env): SecretIssue[] {
  const issues: SecretIssue[] = [];

  for (const name of ["JWT_SECRET", "SERVICE_TOKEN"]) {
    const value = env[name];

    if (!value) {
      issues.push({ name, problem: "is not set" });
      continue;
    }
    if (value.length < MIN_LENGTH) {
      issues.push({ name, problem: `is shorter than ${MIN_LENGTH} characters` });
    }
    if (KNOWN_PLACEHOLDERS.some((placeholder) => value.toLowerCase().includes(placeholder))) {
      issues.push({ name, problem: "is still a placeholder from .env.example" });
    }
  }

  // Not a secret, but the same class of "works locally, wrong in production":
  // the app and owner roles being equal means RLS is silently unenforced.
  const owner = env["DATABASE_URL"];
  const app = env["APP_DATABASE_URL"];

  if (!app) {
    issues.push({
      name: "APP_DATABASE_URL",
      problem: "is not set, so the gateway runs as the migration owner and RLS is bypassed",
    });
  } else if (owner && roleOf(app) === roleOf(owner)) {
    issues.push({
      name: "APP_DATABASE_URL",
      problem: "uses the same role as DATABASE_URL, which is a superuser and bypasses RLS",
    });
  }

  return issues;
}

function roleOf(url: string): string | null {
  try {
    return decodeURIComponent(new URL(url).username) || null;
  } catch {
    return null;
  }
}

/**
 * Called at boot. Throws in production, warns otherwise.
 *
 * Development is *expected* to run with placeholders — that is what they are
 * for — so the same check that stops a deployment must not stop a clone from
 * starting. It still prints, because a developer who has half-configured
 * something should be told.
 */
export function assertProductionSecrets(
  env: NodeJS.ProcessEnv = process.env,
  log: (message: string) => void = console.warn,
): void {
  const issues = auditSecrets(env);
  if (issues.length === 0) return;

  const detail = issues.map(({ name, problem }) => `  - ${name} ${problem}`).join("\n");

  if (env["NODE_ENV"] === "production") {
    throw new Error(
      `Refusing to start: this deployment is using development secrets.\n${detail}\n` +
        "Generate real values (`openssl rand -base64 32`) and set them in the environment.",
    );
  }

  log(`[secrets] development configuration detected — not safe for a deployment:\n${detail}`);
}
