/*
 * InstaRide: a fork of RideFlow (GPL-3.0-or-later).
 * Encrypts small secrets (a driver's bank account number) before they are saved, so the database alone never shows them.
 * AES-256-GCM, with a key derived from DATA_KEY if set, otherwise from SESSION_SECRET. If that secret is ever changed, saved bank
 * details can no longer be read and the driver has to enter them again. Set DATA_KEY once and keep it, to avoid that.
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "crypto";

let devFallback: string | undefined;

function key(): Buffer {
  const base = process.env.DATA_KEY || process.env.SESSION_SECRET || (devFallback ??= randomBytes(32).toString("hex"));
  return Buffer.from(hkdfSync("sha256", base, "instaride", "bank-details-v1", 32));
}

export function encryptText(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]).toString("base64");
}

/** Returns undefined if the text was changed, or was made with a different key. */
export function decryptText(blob: string): string | undefined {
  try {
    const raw = Buffer.from(blob, "base64");
    const d = createDecipheriv("aes-256-gcm", key(), raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8");
  } catch {
    return undefined;
  }
}
