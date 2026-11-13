/*
 * InstaRide: a fork of RideFlow (GPL-3.0-or-later).
 * One-time codes for signing in. A code is 6 digits, valid for 5 minutes, used once, and allows 5 wrong
 * tries. Codes are stored only as an HMAC. Sending is limited per phone (cooldown and per hour).
 *
 * Special codes, for testing and for Google's Play Store reviewers:
 *   OTP_TEST_CODE=123456          every number gets this code. Refused in production.
 *   OTP_FIXED=9876500001:123456   only these numbers get a fixed code (and no SMS is sent). Allowed in
 *                                 production on purpose: use for demo accounts that hold no real data.
 */
import { randomInt, createHmac, timingSafeEqual } from "crypto";
import { storage } from "./storage";
import { sendSms } from "./sms";
import { hmacSecret } from "./auth";
import { firebaseEnabled, verifyFirebaseIdToken, ProofError } from "./firebase";

export class OtpError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

const num = (name: string, fallback: number) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
const ttl = () => num("OTP_TTL_SECONDS", 300);
const resendGap = () => num("OTP_RESEND_SECONDS", 30);
const maxSendsPerHour = () => num("OTP_MAX_SENDS_PER_HOUR", 5);
const maxAttempts = () => num("OTP_MAX_ATTEMPTS", 5);

/** Called at startup so a risky setting stops the server instead of being silently live. */
export function assertOtpConfig() {
  if (process.env.NODE_ENV === "production" && process.env.OTP_TEST_CODE) {
    throw new Error("OTP_TEST_CODE must not be set in production (it would let anyone sign in as anyone). Use OTP_FIXED for specific demo numbers.");
  }
  for (const [phone, code] of fixedEntries()) {
    if (!/^[6-9]\d{9}$/.test(phone) || !/^\d{6}$/.test(code)) {
      throw new Error("OTP_FIXED must look like 9876500001:123456,9876500002:123456");
    }
  }
}

function fixedEntries(): [string, string][] {
  const out: [string, string][] = [];
  for (const raw of (process.env.OTP_FIXED || "").split(",")) {
    const item = raw.trim();
    if (!item) continue;
    const [phone = "", code = ""] = item.split(":").map((x: string) => x.trim());
    out.push([phone, code]);
  }
  return out;
}

function fixedCodeFor(phone: string): string | null {
  if (process.env.NODE_ENV !== "production" && process.env.OTP_TEST_CODE) return process.env.OTP_TEST_CODE;
  const hit = fixedEntries().find(([p]) => p === phone);
  return hit ? hit[1] : null;
}

function hashCode(phone: string, code: string): string {
  return createHmac("sha256", hmacSecret()).update(`otp:${phone}:${code}`).digest("hex");
}

/** Creates a code and sends it. Returns how many seconds the person must wait before asking again. */
export async function sendOtp(phone: string): Promise<{ resendAfterSeconds: number }> {
  const existing = await storage.getOtp(phone);
  const now = Date.now();
  if (existing) {
    const wait = Math.ceil((existing.sentAt + resendGap() * 1000 - now) / 1000);
    if (wait > 0) throw new OtpError(`Please wait ${wait} seconds before asking for a new code.`, 429);
  }
  if ((await storage.countOtpSend(phone)) > maxSendsPerHour()) {
    throw new OtpError("Too many codes were requested for this number. Please try again in an hour.", 429);
  }

  const fixed = fixedCodeFor(phone);
  const code = fixed ?? String(randomInt(0, 1_000_000)).padStart(6, "0");
  await storage.setOtp(phone, { hash: hashCode(phone, code), attempts: 0, sentAt: now }, ttl());
  if (!fixed) {
    try {
      await sendSms(phone, `${code} is your InstaRide verification code. It is valid for ${Math.round(ttl() / 60)} minutes. Do not share it with anyone.`);
    } catch (e) {
      await storage.deleteOtp(phone); // let the person try again straight away
      throw e;
    }
  }
  return { resendAfterSeconds: resendGap() };
}

/** Checks a code. A correct code is used up. Throws OtpError with a message the app can show. */
export type ProofMode = "code" | "firebase";

/**
 * How a number proves it is theirs:
 *   "code"      the 6-digit code made and (unless it is a fixed test number) texted by this server;
 *   "firebase"  Firebase texts the code, and the app hands the server Google's signed proof.
 * Numbers with a fixed test code always use "code", so testers and Play Store reviewers never depend on SMS.
 */
export function proofMode(phone: string): ProofMode {
  if (fixedCodeFor(phone)) return "code";
  return firebaseEnabled() ? "firebase" : "code";
}

/**
 * Starts proving a phone number. For "code" it creates and texts the code. For "firebase" it only applies the same
 * limits (wait between requests, and a cap per hour, so one number cannot run up text-message costs). Firebase sends the text.
 */
export async function startPhoneProof(phone: string): Promise<{ resendAfterSeconds: number; mode: ProofMode }> {
  if (proofMode(phone) === "code") {
    const out = await sendOtp(phone);
    return { ...out, mode: "code" };
  }
  const existing = await storage.getOtp(phone);
  const now = Date.now();
  if (existing) {
    const wait = Math.ceil((existing.sentAt + resendGap() * 1000 - now) / 1000);
    if (wait > 0) throw new OtpError(`Please wait ${wait} seconds before asking for a new code.`, 429);
  }
  if ((await storage.countOtpSend(phone)) > maxSendsPerHour()) {
    throw new OtpError("Too many codes were requested for this number. Please try again in an hour.", 429);
  }
  await storage.setOtp(phone, { hash: "firebase", attempts: 0, sentAt: now }, ttl());
  return { resendAfterSeconds: resendGap(), mode: "firebase" };
}

/** Checks the proof the app sends: the 6-digit code, or a Firebase proof. Throws a message the app can show. */
export async function verifyPhoneProof(phone: string, proof: { otp?: string; idToken?: string }): Promise<void> {
  const mode = proofMode(phone);
  if (proof.idToken) {
    if (mode !== "firebase") throw new OtpError("Please sign in with the 6-digit code for this number.");
    try {
      await verifyFirebaseIdToken(proof.idToken, phone);
    } catch (e) {
      if (e instanceof ProofError) throw new OtpError(e.message, e.status);
      throw e;
    }
    return;
  }
  if (!proof.otp) throw new OtpError("Enter the 6-digit code");
  if (mode === "firebase") throw new OtpError("Please update the InstaRide app to sign in with this number.");
  await checkOtp(phone, proof.otp);
}

export async function checkOtp(phone: string, code: string): Promise<void> {
  const rec = await storage.getOtp(phone);
  if (!rec) throw new OtpError("This code has expired. Ask for a new one.");
  if (rec.attempts >= maxAttempts()) {
    await storage.deleteOtp(phone);
    throw new OtpError("Too many wrong tries. Ask for a new code.", 429);
  }
  const given = Buffer.from(hashCode(phone, code), "hex");
  const want = Buffer.from(rec.hash, "hex");
  const ok = given.length === want.length && timingSafeEqual(given, want);
  if (!ok) {
    const left = maxAttempts() - rec.attempts - 1;
    const remaining = Math.max(0, Math.ceil((rec.sentAt + ttl() * 1000 - Date.now()) / 1000));
    await storage.setOtp(phone, { ...rec, attempts: rec.attempts + 1 }, Math.max(remaining, 1));
    throw new OtpError(left > 0 ? `Wrong code. ${left} ${left === 1 ? "try" : "tries"} left.` : "Wrong code. Ask for a new one.");
  }
  await storage.deleteOtp(phone);
}
