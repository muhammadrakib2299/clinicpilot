import { assertProductionSecrets, auditSecrets } from "./secrets";

const GOOD = {
  JWT_SECRET: "3xX8kQpZ2mNv7bLrTfWyUa4cHdGjEs9P",
  SERVICE_TOKEN: "aB7kLm2QwErTyUiOpAsDfGhJkZxCvBnM",
  DATABASE_URL: "postgresql://owner:pw@db:5432/clinicpilot",
  APP_DATABASE_URL: "postgresql://clinicpilot_app:otherpw@db:5432/clinicpilot",
};

describe("auditSecrets", () => {
  it("passes a properly configured deployment", () => {
    expect(auditSecrets(GOOD)).toEqual([]);
  });

  it("catches the placeholder that ships in .env.example", () => {
    // The whole reason this exists: a deployment using these boots and serves
    // traffic exactly like a correct one.
    const issues = auditSecrets({ ...GOOD, JWT_SECRET: "change-me-dev-only" });

    expect(issues).toContainEqual({
      name: "JWT_SECRET",
      problem: "is still a placeholder from .env.example",
    });
  });

  it("catches a secret that is merely short", () => {
    const issues = auditSecrets({ ...GOOD, SERVICE_TOKEN: "hunter2" });

    expect(issues.map((i) => i.problem)).toContain("is shorter than 16 characters");
  });

  it("catches an unset secret", () => {
    const { SERVICE_TOKEN: _omitted, ...rest } = GOOD;

    expect(auditSecrets(rest)).toContainEqual({ name: "SERVICE_TOKEN", problem: "is not set" });
  });

  it("catches the gateway running as the migration owner", () => {
    // Not a secret, but the same shape of mistake: it works locally and
    // silently disables every tenant policy.
    const issues = auditSecrets({ ...GOOD, APP_DATABASE_URL: GOOD.DATABASE_URL });

    expect(issues[0]?.problem).toMatch(/same role as DATABASE_URL/);
  });

  it("catches APP_DATABASE_URL being absent entirely", () => {
    const { APP_DATABASE_URL: _omitted, ...rest } = GOOD;

    expect(auditSecrets(rest)[0]?.problem).toMatch(/RLS is bypassed/);
  });

  it("reports every problem at once, not the first", () => {
    const issues = auditSecrets({ JWT_SECRET: "x", SERVICE_TOKEN: "y" });

    expect(issues.length).toBeGreaterThanOrEqual(3);
  });
});

describe("assertProductionSecrets", () => {
  it("throws in production", () => {
    expect(() =>
      assertProductionSecrets({ ...GOOD, NODE_ENV: "production", JWT_SECRET: "change-me-dev-only" }),
    ).toThrow(/Refusing to start/);
  });

  it("only warns in development, because placeholders are the point there", () => {
    const warnings: string[] = [];

    assertProductionSecrets({ ...GOOD, JWT_SECRET: "change-me-dev-only" }, (m) => warnings.push(m));

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/not safe for a deployment/);
  });

  it("stays silent when everything is set properly", () => {
    const warnings: string[] = [];

    assertProductionSecrets({ ...GOOD, NODE_ENV: "production" }, (m) => warnings.push(m));

    expect(warnings).toEqual([]);
  });
});
