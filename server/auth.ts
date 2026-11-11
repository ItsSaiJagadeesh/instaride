/*
 * InstaRide: a fork of RideFlow (GPL-3.0-or-later).
 * Password hashing (scrypt), signed bearer tokens (HMAC-SHA256), role guards, login rate limiting.
 */
import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHmac } from "crypto";
import { promisify } from "util";
import type { Request, Response, NextFunction } from "express";
import type { StoredUser, User, UserRole } from "@shared/schema";
import { storage } from "./storage";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: StoredUser;
    }
  }
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = await scrypt(password, Buffer.from(saltHex, "hex"), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function getSecret(): string {
  const fromEnv = process.env.SESSION_SECRET;
  if (fromEnv && fromEnv.length >= 32) return fromEnv;
  if (process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET must be set to a random string of at least 32 characters in production");
  }
  if (!devSecret) {
    devSecret = randomBytes(32).toString("hex");
    console.warn("SESSION_SECRET is not set: using a temporary secret. Logins will reset when the server restarts.");
  }
  return devSecret;
}
let devSecret: string | undefined;

/** Fail fast on startup if production config is unsafe. */
export function assertSecurityConfig() {
  getSecret();
}

const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function b64url(buf: Buffer | string) {
  return Buffer.from(buf).toString("base64url");
}

/** Secret used to sign tokens and to hash one-time codes. */
export function hmacSecret(): string {
  return getSecret();
}

const SIGNUP_TTL_MS = 10 * 60 * 1000;

/** Proof that a phone number was just verified with a code, so the person can finish creating an account. */
export function signSignupToken(role: "rider" | "driver", phone: string): string {
  const payload = b64url(JSON.stringify({ purpose: "signup", role, phone, exp: Date.now() + SIGNUP_TTL_MS }));
  const sig = createHmac("sha256", getSecret()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifySignupToken(token: string): { role: "rider" | "driver"; phone: string } | null {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = createHmac("sha256", getSecret()).update(payload).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const d = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (d.purpose !== "signup" || (d.role !== "rider" && d.role !== "driver") || typeof d.phone !== "string" || d.exp < Date.now()) return null;
    return { role: d.role, phone: d.phone };
  } catch {
    return null;
  }
}

export function signToken(userId: string): string {
  const payload = b64url(JSON.stringify({ sub: userId, exp: Date.now() + TOKEN_TTL_MS }));
  const sig = createHmac("sha256", getSecret()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyToken(token: string): string | null {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = createHmac("sha256", getSecret()).update(payload).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof data.sub !== "string" || typeof data.exp !== "number" || data.exp < Date.now()) return null;
    return data.sub;
  } catch {
    return null;
  }
}

export async function authenticate(req: Request, res: Response, next: NextFunction) {
  const header = req.header("authorization") || "";
  const match = /^Bearer (.+)$/.exec(header);
  const userId = match ? verifyToken(match[1]) : null;
  if (!userId) return res.status(401).json({ message: "Please log in" });
  const user = await storage.getUser(userId);
  if (!user) return res.status(401).json({ message: "Please log in" });
  if (user.suspended) return res.status(403).json({ message: "This account is suspended" });
  req.user = user;
  next();
}

export function requireRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ message: "Not allowed" });
    }
    next();
  };
}

/** The signed-in user may act on :id only if it is themselves (or they are a Super Admin). */
export function requireSelfOrAdmin(paramName: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const id = req.params[paramName];
    if (!req.user || (req.user.id !== id && req.user.role !== "admin")) {
      return res.status(403).json({ message: "Not allowed" });
    }
    next();
  };
}

export function toSafeUser(u: StoredUser): User {
  const { passwordHash: _ph, verification, ...rest } = u;
  if (!verification) return rest;
  const { files, ...v } = verification;
  return { ...rest, verification: { ...v, uploaded: Object.keys(files) as any } };
}

// ---- simple in-memory rate limiter (per process; enough for a single-server pilot) ----
const hits = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: (req: Request) => string, max: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const k = key(req);
    const now = Date.now();
    const entry = hits.get(k);
    if (!entry || entry.resetAt < now) {
      hits.set(k, { count: 1, resetAt: now + windowMs });
      return next();
    }
    entry.count += 1;
    if (entry.count > max) {
      res.setHeader("Retry-After", Math.ceil((entry.resetAt - now) / 1000).toString());
      return res.status(429).json({ message: "Too many attempts. Please try again later." });
    }
    next();
  };
}

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of hits) if (v.resetAt < now) hits.delete(k);
}, 60_000).unref();
