import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

/**
 * Encryption for credentials belonging to somebody else's server.
 *
 * This app is meant to be used by people who bring their own Nextcloud, so an
 * app password is theirs rather than the deployment's: it cannot live in the
 * environment and it must not be readable by anything that leaks the database
 * alone. AES-256-GCM, keyed from CC_SECRET_KEY, which lives only on the server.
 *
 * GCM rather than CBC so a tampered ciphertext fails to decrypt rather than
 * decrypting into something else.
 */

const ALGORITHM = "aes-256-gcm";

function key() {
  const secret = process.env.CC_SECRET_KEY;
  if (!secret || secret.length < 16) {
    throw new Error(
      "CC_SECRET_KEY is missing. Set a long random value in the environment before connecting a calendar server.",
    );
  }
  // A fixed salt keeps the key stable across restarts; the per-message IV is
  // what makes two encryptions of the same password differ.
  return scryptSync(secret, "cc.caldav.v1", 32);
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${body.toString("base64url")}`;
}

export function decryptSecret(stored: string): string {
  const [version, iv, tag, body] = stored.split(".");
  if (version !== "v1" || !iv || !tag || !body) {
    throw new Error("That stored credential is not in a form this version understands.");
  }
  const decipher = createDecipheriv(ALGORITHM, key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(body, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

/** Whether the server is configured to hold credentials at all. */
export const canHoldSecrets = () => Boolean(process.env.CC_SECRET_KEY);
