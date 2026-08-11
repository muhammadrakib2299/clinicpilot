import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  type ScryptOptions,
} from "node:crypto";

/**
 * `promisify` picks the 3-argument overload, which drops the options object —
 * and the options are the entire security posture of a KDF. Wrapped by hand so
 * the cost parameters are actually passed.
 */
function scrypt(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keylen, options, (error, derived) => {
      if (error) reject(error);
      else resolve(derived);
    });
  });
}

/**
 * Password hashing with scrypt from the standard library.
 *
 * argon2id is the textbook answer and would be the choice with a free hand.
 * scrypt wins here for one practical reason: it is memory-hard, it is in Node
 * itself, and it needs no native module. Both argon2 and bcrypt compile at
 * install time, which means a toolchain in the Docker build, a second one for
 * Windows development, and a class of "works on my machine" that this project
 * has already spent a session on.
 *
 * The parameters below are the interesting part of any scrypt implementation,
 * so they are stored *in* the hash: a future increase applies to new passwords
 * immediately and old ones keep verifying against the cost they were made
 * with. Rehash-on-login is the migration path and is not built yet.
 */

/** CPU/memory cost. 2^16 is ~64 MB per hash — the current OWASP floor. */
const COST = 2 ** 16;
const BLOCK_SIZE = 8;
const PARALLELISM = 1;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;

/**
 * Shortest digest `verifyPassword` will consider.
 *
 * Not paranoia — scrypt finishes with PBKDF2, and PBKDF2 generates its output
 * blocks independently, so a shorter derived key is a *prefix* of a longer one.
 * Without this floor, truncating a stored hash to its first byte would leave it
 * verifying against one byte of comparison: 1-in-256 for any password. A test
 * that truncated a hash found it.
 *
 * A floor rather than an equality check, so raising KEY_LENGTH later does not
 * invalidate every hash written before the change.
 */
const MIN_KEY_LENGTH = 32;

/** scrypt's memory use is roughly 128 * N * r, and Node caps it below that. */
const MAX_MEMORY = 256 * COST * BLOCK_SIZE;

const PREFIX = "scrypt";

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derived = await scrypt(password.normalize("NFKC"), salt, KEY_LENGTH, {
    N: COST,
    r: BLOCK_SIZE,
    p: PARALLELISM,
    maxmem: MAX_MEMORY,
  });

  return [
    PREFIX,
    COST,
    BLOCK_SIZE,
    PARALLELISM,
    salt.toString("base64"),
    derived.toString("base64"),
  ].join("$");
}

/**
 * Verify a password against a stored hash.
 *
 * Returns false for a malformed hash rather than throwing: a corrupted row
 * should fail the login, not 500 the endpoint and tell an attacker that this
 * particular account is interesting.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== PREFIX) return false;

  const [, cost, blockSize, parallelism, saltB64, expectedB64] = parts;
  const n = Number(cost);
  const r = Number(blockSize);
  const p = Number(parallelism);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(saltB64!, "base64");
    expected = Buffer.from(expectedB64!, "base64");
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length < MIN_KEY_LENGTH) return false;

  let derived: Buffer;
  try {
    derived = await scrypt(password.normalize("NFKC"), salt, expected.length, {
      N: n,
      r,
      p,
      maxmem: Math.max(MAX_MEMORY, 256 * n * r),
    });
  } catch {
    return false;
  }

  // Constant-time. `===` on the encoded strings would leak how much of the
  // hash matched through timing, one byte at a time.
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}
