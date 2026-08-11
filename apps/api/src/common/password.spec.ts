import { hashPassword, verifyPassword } from "./password";

// scrypt at 64 MB is deliberately slow; a handful of hashes exceeds the default.
jest.setTimeout(30_000);

describe("hashPassword", () => {
  it("verifies the password it was given", async () => {
    const hash = await hashPassword("correct horse battery staple");

    expect(await verifyPassword("correct horse battery staple", hash)).toBe(true);
  });

  it("rejects a different password", async () => {
    const hash = await hashPassword("correct horse battery staple");

    expect(await verifyPassword("Correct horse battery staple", hash)).toBe(false);
  });

  it("salts, so the same password never produces the same hash", async () => {
    const [a, b] = await Promise.all([hashPassword("same"), hashPassword("same")]);

    expect(a).not.toBe(b);
    // Both still verify — the salt is in the encoding, not a secret.
    expect(await verifyPassword("same", a)).toBe(true);
    expect(await verifyPassword("same", b)).toBe(true);
  });

  it("stores its cost parameters, so they can be raised without breaking logins", async () => {
    const hash = await hashPassword("x");
    const [prefix, cost, blockSize, parallelism] = hash.split("$");

    expect(prefix).toBe("scrypt");
    expect(Number(cost)).toBeGreaterThanOrEqual(2 ** 16);
    expect(Number(blockSize)).toBe(8);
    expect(Number(parallelism)).toBe(1);
  });

  it("normalises unicode, so a password types the same on any keyboard", async () => {
    // U+00E9 vs U+0065 U+0301 — visually identical, different bytes. macOS and
    // Windows disagree about which one a keystroke produces.
    const composed = "café";
    const decomposed = "café";
    expect(composed).not.toBe(decomposed);

    const hash = await hashPassword(composed);
    expect(await verifyPassword(decomposed, hash)).toBe(true);
  });
});

describe("verifyPassword", () => {
  it.each([
    ["empty", ""],
    ["not our format", "$2b$10$abcdefghijklmnopqrstuv"],
    ["wrong prefix", "argon2$65536$8$1$c2FsdA==$aGFzaA=="],
    ["too few fields", "scrypt$65536$8$1$c2FsdA=="],
    ["non-numeric cost", "scrypt$sixty$8$1$c2FsdA==$aGFzaA=="],
    ["empty salt", "scrypt$65536$8$1$$aGFzaA=="],
  ])("returns false rather than throwing on a %s hash", async (_label, stored) => {
    // A corrupted row must fail the login, not 500 the endpoint — a 500 on one
    // account and a 401 on every other is itself an answer to "does this
    // account exist".
    await expect(verifyPassword("anything", stored)).resolves.toBe(false);
  });

  it("rejects a hash whose digest has been truncated", async () => {
    // Not a hypothetical. scrypt finishes with PBKDF2, whose output blocks are
    // generated independently — so a shorter derived key is a *prefix* of the
    // full one, and deriving `expected.length` bytes against a truncated
    // digest matched. Truncated to one byte, any password would have had a
    // 1-in-256 chance. A length floor is what closes it.
    const hash = await hashPassword("secret");

    for (const cut of [4, 8, 20, 40]) {
      expect(await verifyPassword("secret", hash.slice(0, -cut))).toBe(false);
    }
  });
});
