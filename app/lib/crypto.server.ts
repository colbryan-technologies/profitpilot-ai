import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { env } from "./env.server";

const ALGO = "aes-256-gcm";

function key(): Buffer {
  const raw = env().ENCRYPTION_KEY;
  if (!raw) {
    if (env().NODE_ENV === "production") throw new Error("ENCRYPTION_KEY is required");
    return createHash("sha256").update("profitpilot-dev-only-key").digest();
  }
  const buf = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (buf.length !== 32) throw new Error("ENCRYPTION_KEY must decode to 32 bytes");
  return buf;
}

/** Encrypts UTF-8 text to `v1:<iv>:<tag>:<ciphertext>` (all base64url). */
export function encrypt(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), ct.toString("base64url")].join(":");
}

export function decrypt(payload: string): string {
  const [version, iv, tag, ct] = payload.split(":");
  if (version !== "v1" || !iv || !tag || !ct) throw new Error("Malformed encrypted payload");
  const decipher = createDecipheriv(ALGO, key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/** Stable hash for privacy-preserving identifiers (emails, IPs). */
export function hashIdentifier(value: string): string {
  return sha256Hex(value.trim().toLowerCase());
}
