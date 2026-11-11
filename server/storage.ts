/*
 * InstaRide: a fork of RideFlow (GPL-3.0-or-later).
 * Redis-backed storage. Set REDIS_URL (default redis://127.0.0.1:6379) and run Redis with
 * append-only persistence enabled so data survives restarts.
 */
import { randomUUID, randomBytes } from "crypto";
import Redis from "ioredis";
import type {
  StoredUser,
  Ride,
  RideEvent,
  UserRole,
  PlatformConfig,
  AuditEntry,
} from "@shared/schema";

const P = "instaride:";

export const DEFAULT_CONFIG: PlatformConfig = {
  enabledVehicleTypes: ["bike", "auto"],
  // Placeholder rates in rupees: set the real ones in Super Admin > Settings.
  rates: {
    bike: { baseFare: 15, perKm: 6, perMinute: 0.5, minimumFare: 25 },
    auto: { baseFare: 25, perKm: 11, perMinute: 1, minimumFare: 35 },
    erickshaw: { baseFare: 15, perKm: 7, perMinute: 0.5, minimumFare: 25 },
    car: { baseFare: 50, perKm: 14, perMinute: 1.5, minimumFare: 80 },
  },
  platformFeePerRide: 5,
  maxFeesDue: 100,
  surgePricing: false,
  surgeMultiplier: 1,
  roadFactor: 1.3,
  minutesPerKm: 3,
  // Approximate centre of Jangareddygudem: check on a map and adjust in Settings.
  serviceArea: { name: "Jangareddygudem", lat: 17.1225, lng: 81.2945, radiusKm: 15 },
};

export interface OtpRecord {
  hash: string; // HMAC of the code: the code itself is never stored
  attempts: number;
  sentAt: number;
}

const phoneKey = (role: UserRole, phone: string) => `${role}:${phone}`;

export class RedisStorage {
  private redis: Redis;

  constructor() {
    this.redis = new Redis(process.env.REDIS_URL || "redis://127.0.0.1:6379", {
      retryStrategy(times) {
        if (times > 10) return null;
        return Math.min(times * 200, 2000);
      },
      lazyConnect: true,
    });
  }

  async initialize(hashPassword: (pw: string) => Promise<string>): Promise<void> {
    await this.redis.connect();
    console.log("Connected to Redis");
    await this.migratePhoneIndex();
    const seeded = await this.redis.get(P + "seeded");
    if (seeded) return;

    const phone = (process.env.ADMIN_PHONE || "").trim();
    let password = process.env.ADMIN_PASSWORD || "";
    const isProd = process.env.NODE_ENV === "production";
    if (isProd && (!/^[6-9]\d{9}$/.test(phone) || password.length < 12)) {
      throw new Error(
        "First start in production needs ADMIN_PHONE (10 digits) and ADMIN_PASSWORD (at least 12 characters)",
      );
    }
    let generated = false;
    const adminPhone = phone || "9999999999";
    if (!password) {
      password = randomBytes(9).toString("base64url");
      generated = true;
    }
    const id = randomUUID();
    const admin: StoredUser = {
      id,
      phone: adminPhone,
      passwordHash: await hashPassword(password),
      role: "admin",
      fullName: "Super Admin",
      createdAt: new Date().toISOString(),
    };
    await this.redis.hset(P + "users", id, JSON.stringify(admin));
    await this.redis.hset(P + "phones", phoneKey("admin", adminPhone), id);
    await this.redis.set(P + "seeded", "1");
    if (generated) {
      console.log(`Super Admin created. Phone: ${adminPhone}  Password: ${password}  (shown once: save it now)`);
    } else {
      console.log(`Super Admin created for phone ${adminPhone}`);
    }
  }

  // ---- users ----
  async getUser(id: string): Promise<StoredUser | undefined> {
    const data = await this.redis.hget(P + "users", id);
    return data ? JSON.parse(data) : undefined;
  }

  /** One phone number can have one account per role (for example a rider account and a driver account). */
  async getUserByPhone(phone: string, role: UserRole): Promise<StoredUser | undefined> {
    const id = await this.redis.hget(P + "phones", phoneKey(role, phone));
    return id ? this.getUser(id) : undefined;
  }

  /** Older data indexed phones without a role. Rewrite those entries once. */
  private async migratePhoneIndex(): Promise<void> {
    const entries = await this.redis.hgetall(P + "phones");
    for (const [key, id] of Object.entries(entries)) {
      if (key.includes(":")) continue;
      const user = await this.getUser(id);
      if (user) await this.redis.hset(P + "phones", phoneKey(user.role, user.phone), id);
      await this.redis.hdel(P + "phones", key);
    }
  }

  /** Returns undefined if the phone number is already registered (atomic). */
  async createUser(user: Omit<StoredUser, "id" | "createdAt">): Promise<StoredUser | undefined> {
    const id = randomUUID();
    const claimed = await this.redis.hsetnx(P + "phones", phoneKey(user.role, user.phone), id);
    if (!claimed) return undefined;
    const newUser: StoredUser = { ...user, id, createdAt: new Date().toISOString() };
    await this.redis.hset(P + "users", id, JSON.stringify(newUser));
    return newUser;
  }

  async updateUser(id: string, updates: Partial<StoredUser>): Promise<StoredUser | undefined> {
    const user = await this.getUser(id);
    if (!user) return undefined;
    const updated = { ...user, ...updates };
    await this.redis.hset(P + "users", id, JSON.stringify(updated));
    return updated;
  }

  async deleteUser(id: string): Promise<boolean> {
    const user = await this.getUser(id);
    if (!user) return false;
    await this.redis.hdel(P + "users", id);
    await this.redis.hdel(P + "phones", phoneKey(user.role, user.phone));
    return true;
  }

  async getAllUsers(): Promise<StoredUser[]> {
    const data = await this.redis.hvals(P + "users");
    return data.map((d) => JSON.parse(d));
  }

  async getUsersByRole(role: UserRole): Promise<StoredUser[]> {
    return (await this.getAllUsers()).filter((u) => u.role === role);
  }

  // ---- rides ----
  async createRide(ride: Omit<Ride, "id" | "createdAt">): Promise<Ride> {
    const id = randomUUID();
    const newRide: Ride = { ...ride, id, createdAt: new Date().toISOString() };
    await this.redis.hset(P + "rides", id, JSON.stringify(newRide));
    return newRide;
  }

  async getRide(id: string): Promise<Ride | undefined> {
    const data = await this.redis.hget(P + "rides", id);
    return data ? JSON.parse(data) : undefined;
  }

  async updateRide(id: string, updates: Partial<Ride>): Promise<Ride | undefined> {
    const ride = await this.getRide(id);
    if (!ride) return undefined;
    const updated = { ...ride, ...updates };
    await this.redis.hset(P + "rides", id, JSON.stringify(updated));
    return updated;
  }

  async getAllRides(): Promise<Ride[]> {
    const data = await this.redis.hvals(P + "rides");
    return data
      .map((d) => JSON.parse(d) as Ride)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async getRidesByRider(riderId: string): Promise<Ride[]> {
    return (await this.getAllRides()).filter((r) => r.riderId === riderId);
  }

  async getRidesByDriver(driverId: string): Promise<Ride[]> {
    return (await this.getAllRides()).filter((r) => r.driverId === driverId);
  }

  async getActiveRides(): Promise<Ride[]> {
    return (await this.getAllRides()).filter((r) => !["completed", "cancelled"].includes(r.status));
  }

  /** Short-lived lock so two drivers cannot accept the same ride. */
  async acquireLock(key: string, ttlMs: number): Promise<boolean> {
    const res = await this.redis.set(P + "lock:" + key, "1", "PX", ttlMs, "NX");
    return res === "OK";
  }

  async releaseLock(key: string): Promise<void> {
    await this.redis.del(P + "lock:" + key);
  }

  // ---- events ----
  async createEvent(event: Omit<RideEvent, "id" | "createdAt">): Promise<RideEvent> {
    const id = randomUUID();
    const e: RideEvent = { ...event, id, createdAt: new Date().toISOString() };
    await this.redis.hset(P + "events", id, JSON.stringify(e));
    return e;
  }

  async getEventsByUser(userId: string): Promise<RideEvent[]> {
    const data = await this.redis.hvals(P + "events");
    return data
      .map((d) => JSON.parse(d) as RideEvent)
      .filter((e) => e.userId === userId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 50);
  }

  async getEvent(id: string): Promise<RideEvent | undefined> {
    const data = await this.redis.hget(P + "events", id);
    return data ? JSON.parse(data) : undefined;
  }

  async markEventRead(eventId: string): Promise<void> {
    const e = await this.getEvent(eventId);
    if (e) {
      e.read = true;
      await this.redis.hset(P + "events", eventId, JSON.stringify(e));
    }
  }

  // ---- config ----
  async getConfig(): Promise<PlatformConfig> {
    const data = await this.redis.get(P + "config");
    if (!data) return structuredClone(DEFAULT_CONFIG);
    const stored = JSON.parse(data) as Partial<PlatformConfig>;
    return {
      ...DEFAULT_CONFIG,
      ...stored,
      rates: { ...DEFAULT_CONFIG.rates, ...(stored.rates || {}) },
      serviceArea: { ...DEFAULT_CONFIG.serviceArea, ...(stored.serviceArea || {}) },
    };
  }

  async updateConfig(updates: Partial<PlatformConfig>): Promise<PlatformConfig> {
    const current = await this.getConfig();
    const updated: PlatformConfig = {
      ...current,
      ...updates,
      rates: { ...current.rates, ...(updates.rates || {}) },
      serviceArea: { ...current.serviceArea, ...(updates.serviceArea || {}) },
    };
    await this.redis.set(P + "config", JSON.stringify(updated));
    return updated;
  }

  // ---- one-time codes ----
  async getOtp(phone: string): Promise<OtpRecord | null> {
    const raw = await this.redis.get(P + "otp:" + phone);
    return raw ? JSON.parse(raw) : null;
  }

  async setOtp(phone: string, record: OtpRecord, ttlSeconds: number): Promise<void> {
    await this.redis.set(P + "otp:" + phone, JSON.stringify(record), "EX", ttlSeconds);
  }

  async deleteOtp(phone: string): Promise<void> {
    await this.redis.del(P + "otp:" + phone);
  }

  /** Counts how many codes were sent to a phone in the last hour. */
  async countOtpSend(phone: string): Promise<number> {
    const key = P + "otpsends:" + phone;
    const n = await this.redis.incr(key);
    if (n === 1) await this.redis.expire(key, 3600);
    return n;
  }

  async ping(): Promise<boolean> {
    return (await this.redis.ping()) === "PONG";
  }

  // ---- go-live meter: steps only a person can do, ticked off by the Super Admin ----
  async getManualChecks(): Promise<Record<string, boolean>> {
    const raw = await this.redis.hgetall(P + "meter:manual");
    return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, v === "1"]));
  }

  async setManualCheck(id: string, done: boolean): Promise<void> {
    if (done) await this.redis.hset(P + "meter:manual", id, "1");
    else await this.redis.hdel(P + "meter:manual", id);
  }

  // ---- trip share links ----
  async createShare(rideId: string, token: string, ttlSeconds: number): Promise<void> {
    await this.redis.set(P + "share:" + token, rideId, "EX", ttlSeconds);
  }

  async getShareRideId(token: string): Promise<string | null> {
    return this.redis.get(P + "share:" + token);
  }

  // ---- audit log (append only) ----
  async addAudit(entry: Omit<AuditEntry, "id" | "createdAt">): Promise<void> {
    const e: AuditEntry = { ...entry, id: randomUUID(), createdAt: new Date().toISOString() };
    await this.redis.lpush(P + "audit", JSON.stringify(e));
    await this.redis.ltrim(P + "audit", 0, 4999);
  }

  async getAudit(limit = 100): Promise<AuditEntry[]> {
    const data = await this.redis.lrange(P + "audit", 0, limit - 1);
    return data.map((d) => JSON.parse(d));
  }
}

export const storage = new RedisStorage();
