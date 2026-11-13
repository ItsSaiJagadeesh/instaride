/*
 * InstaRide: a fork of RideFlow (GPL-3.0-or-later).
 * Checks the proof that Firebase gives the app after a person has typed the text-message code it sent.
 *
 * The app never just says "this number is verified". It hands the server a signed token (a Firebase ID token), and
 * this module checks, on the server, with Google's published signing certificates:
 *   - the signature is Google's (RS256, a certificate that Google lists for the token's key id),
 *   - it was issued for OUR project (audience and issuer),
 *   - it is fresh (not expired, and the person signed in within the last few minutes),
 *   - the person signed in with a phone number, and it is the number being verified,
 *   - it has not been used before (a token works once here).
 *
 * Settings (all optional except the first):
 *   FIREBASE_PROJECT_ID           your Firebase project id, for example instaride-9f5eb. Switches this on.
 *   FIREBASE_PROOF_MAX_AGE_SECONDS  how recent the sign-in must be (default 300)
 *   FIREBASE_CERTS_URL            where Google's certificates are fetched from (only changed in tests)
 */
import { createHash, createPublicKey, verify as cryptoVerify } from "crypto";
import { storage } from "./storage";

export class ProofError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export const firebaseEnabled = () => !!(process.env.FIREBASE_PROJECT_ID || "").trim();

const GOOGLE_CERTS = "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";
const certsUrl = () => process.env.FIREBASE_CERTS_URL || GOOGLE_CERTS;
const maxAgeSeconds = () => {
  const n = Number(process.env.FIREBASE_PROOF_MAX_AGE_SECONDS);
  return Number.isFinite(n) && n > 0 ? n : 300;
};

/** Called at startup so a typo in the project id stops the server instead of silently blocking sign-in. */
export function assertFirebaseConfig() {
  const id = (process.env.FIREBASE_PROJECT_ID || "").trim();
  if (id && !/^[a-z][a-z0-9-]{3,29}$/.test(id)) {
    throw new Error("FIREBASE_PROJECT_ID looks wrong. It is the project id from Firebase (for example instaride-9f5eb), with small letters, numbers and dashes only.");
  }
}

let certCache: { certs: Record<string, string>; expires: number } | null = null;

async function getCerts(force = false): Promise<Record<string, string>> {
  if (!force && certCache && certCache.expires > Date.now()) return certCache.certs;
  let res: Response;
  try {
    res = await fetch(certsUrl(), { signal: AbortSignal.timeout(8000) });
  } catch {
    throw new ProofError("We could not check your sign-in right now. Please try again in a moment.", 503);
  }
  if (!res.ok) throw new ProofError("We could not check your sign-in right now. Please try again in a moment.", 503);
  const certs = (await res.json()) as Record<string, string>;
  const maxAge = /max-age=(\d+)/.exec(res.headers.get("cache-control") || "")?.[1];
  certCache = { certs, expires: Date.now() + Math.min(Number(maxAge || 3600), 6 * 3600) * 1000 };
  return certs;
}

/** Forgets the cached certificates. Used by the tests. */
export function resetFirebaseCertCache() {
  certCache = null;
}

const decode = (part: string) => JSON.parse(Buffer.from(part, "base64url").toString("utf8"));

/**
 * Throws ProofError unless `token` proves that the holder verified +91<phone> with Firebase just now.
 * A token is accepted once only.
 */
export async function verifyFirebaseIdToken(token: string, phone: string): Promise<void> {
  const projectId = (process.env.FIREBASE_PROJECT_ID || "").trim();
  const bad = (msg = "We could not verify this sign-in. Please ask for a new code and try again.") => new ProofError(msg, 400);
  if (!projectId) throw bad("Sign-in by Firebase is not switched on.");
  if (typeof token !== "string" || token.length > 5000) throw bad();

  const parts = token.split(".");
  if (parts.length !== 3) throw bad();
  let header: any, payload: any;
  try {
    header = decode(parts[0]);
    payload = decode(parts[1]);
  } catch {
    throw bad();
  }
  if (header?.alg !== "RS256" || typeof header?.kid !== "string") throw bad();

  let pem = (await getCerts())[header.kid];
  if (!pem) pem = (await getCerts(true))[header.kid]; // Google rotates its keys, so look once more before refusing
  if (!pem) throw bad();

  let signatureOk = false;
  try {
    signatureOk = cryptoVerify("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey(pem), Buffer.from(parts[2], "base64url"));
  } catch {
    signatureOk = false;
  }
  if (!signatureOk) throw bad();

  const now = Math.floor(Date.now() / 1000);
  const skew = 60;
  const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
  if (!isNum(payload.exp) || payload.exp <= now) throw bad("This sign-in expired. Please ask for a new code.");
  if (!isNum(payload.iat) || payload.iat > now + skew) throw bad();
  if (!isNum(payload.auth_time) || payload.auth_time > now + skew) throw bad();
  if (now - payload.auth_time > maxAgeSeconds()) throw bad("This sign-in is too old. Please ask for a new code.");
  if (payload.aud !== projectId) throw bad();
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) throw bad();
  if (typeof payload.sub !== "string" || payload.sub.length < 1 || payload.sub.length > 128) throw bad();
  if (payload.firebase?.sign_in_provider !== "phone") throw bad();
  if (payload.phone_number !== `+91${phone}`) throw bad("This sign-in is for a different phone number.");

  const digest = createHash("sha256").update(token).digest("hex");
  if (!(await storage.acquireLock("fbproof:" + digest, 10 * 60 * 1000))) {
    throw bad("This sign-in was already used. Please ask for a new code.");
  }
}
