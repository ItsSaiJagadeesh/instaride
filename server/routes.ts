/*
 * InstaRide: a fork of RideFlow (GPL-3.0-or-later).
 * Roles: admin = Super Admin, rider = InstaRider, driver = InstaDriver.
 */
import express from "express";
import type { Express, Request, Response } from "express";
import { createServer, type Server } from "node:http";
import { randomInt, randomBytes, randomUUID } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { ZodError } from "zod";
import { storage } from "./storage";
import {
  authenticate,
  requireRole,
  requireSelfOrAdmin,
  verifyPassword,
  signToken,
  signSignupToken,
  verifySignupToken,
  toSafeUser,
  rateLimit,
} from "./auth";
import { haversineKm, quoteFare } from "./fare";
import { searchPlaces, reversePlace } from "./geocode";
import { startPhoneProof, verifyPhoneProof, OtpError } from "./otp";
import { SmsError } from "./sms";
import { buildReadiness, MANUAL_STEPS } from "./readiness";
import {
  otpRequestSchema,
  otpVerifySchema,
  signupSchema,
  loginSchema,
  requestRideSchema,
  updateLocationSchema,
  configUpdateSchema,
  submitVerificationSchema,
  updateProfileSchema,
  emergencyContactSchema,
  favouriteSchema,
  deleteAccountSchema,
  sosSchema,
  verifyDecisionSchema,
  DOCUMENT_KINDS,
  RIDER_CANCEL_REASONS,
  DRIVER_CANCEL_REASONS,
} from "@shared/schema";
import type {
  StoredUser,
  Ride,
  RideStatus,
  PlatformConfig,
  DocumentKind,
} from "@shared/schema";

const UPLOADS_DIR = path.resolve(process.env.UPLOADS_DIR || path.join(process.cwd(), "data", "uploads"));
const MAX_DOC_BYTES = 3 * 1024 * 1024;
const ACTIVE = ["requested", "accepted", "arriving", "arrived", "in_progress"] as const;

function fail(res: Response, e: unknown, status = 400) {
  if (e instanceof ZodError) {
    return res.status(400).json({ message: e.issues[0]?.message || "Invalid data" });
  }
  return res.status(status).json({ message: (e as Error)?.message || "Invalid data" });
}

const dummyHash = "scrypt$00000000000000000000000000000000$" + "00".repeat(64);

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Can this InstaDriver go online and take rides right now? */
function driverEligibility(d: StoredUser, config: PlatformConfig): { ok: boolean; reason?: string } {
  if (d.role !== "driver") return { ok: false, reason: "Only InstaDrivers can go online" };
  if (d.suspended) return { ok: false, reason: "Your account is suspended" };
  const v = d.verification;
  if (!v || v.status !== "approved") {
    return { ok: false, reason: "Your bike has not been approved yet" };
  }
  if (!v.insuranceExpiry || v.insuranceExpiry < today()) {
    return { ok: false, reason: "Your insurance has expired. Upload the new insurance for approval" };
  }
  if (!v.fitnessExpiry || v.fitnessExpiry < today()) {
    return { ok: false, reason: "Your fitness certificate has expired" };
  }
  if ((d.feesDue || 0) >= config.maxFeesDue) {
    return { ok: false, reason: `Please pay your platform fee dues (₹${d.feesDue}) to go online` };
  }
  return { ok: true };
}

function sanitizeRide(viewer: StoredUser, ride: Ride): Ride {
  const out: Ride = { ...ride };
  if (viewer.role === "driver") delete out.startOtp; // only the InstaRider sees the start OTP
  if (viewer.role !== "admin") delete out.declinedBy; // who rejected a request is nobody else's business
  if (viewer.role !== "admin") delete out.cancelLog;
  if (viewer.role !== "admin" && out.review) {
    out.review = { rating: out.review.rating, createdAt: out.review.createdAt };
  }
  return out;
}

/**
 * The 4-digit code the rider tells the driver to start the trip.
 * RIDE_CODE_MODE=phone_last4 (the default): the last 4 digits of the rider's mobile number, easy for the rider to remember.
 * RIDE_CODE_MODE=random: a new random code for every ride (harder to guess, because it changes each time).
 */
async function makeStartCode(riderId: string): Promise<string> {
  if ((process.env.RIDE_CODE_MODE || "phone_last4").toLowerCase() !== "random") {
    const rider = await storage.getUser(riderId);
    const digits = (rider?.phone || "").replace(/\D/g, "");
    if (digits.length >= 4) return digits.slice(-4);
  }
  return String(randomInt(1000, 10000));
}

/** Only the offered reasons are stored. A missing reason stays empty, an invented one becomes "Other". */
function cleanCancelReason(role: "rider" | "driver", raw: unknown): string | undefined {
  const text = typeof raw === "string" ? raw.trim().slice(0, 80) : "";
  if (!text) return undefined;
  const offered: readonly string[] = role === "driver" ? DRIVER_CANCEL_REASONS : RIDER_CANCEL_REASONS;
  return offered.includes(text) ? text : "Other";
}

function canSeeRide(viewer: StoredUser, ride: Ride) {
  return viewer.role === "admin" || ride.riderId === viewer.id || ride.driverId === viewer.id;
}

function sniffImage(buf: Buffer): "jpg" | "png" | null {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return "png";
  return null;
}

export async function registerRoutes(app: Express): Promise<Server> {
  const auth = authenticate;
  const adminOnly = [authenticate, requireRole("admin")];

  // ------------------------------------------------------------------ auth
  // Riders and drivers have no password. They sign in (or sign up) with a code sent to their phone.
  // The same phone number may have one rider account and one driver account.
  const codeErrors = (res: Response, e: unknown) => {
    if (e instanceof OtpError || e instanceof SmsError) return res.status(e.status).json({ message: e.message });
    return fail(res, e);
  };

  const otpIpLimit = Number(process.env.OTP_IP_LIMIT_PER_HOUR) || 30;

  app.post(
    "/api/auth/otp/request",
    rateLimit((req) => "otpreq:" + req.ip, otpIpLimit, 60 * 60 * 1000),
    async (req: Request, res: Response) => {
      try {
        const p = otpRequestSchema.parse(req.body);
        const out = await startPhoneProof(p.phone);
        return res.json({ sent: out.mode === "code", ...out }); // mode "firebase": Firebase sends the text, the server does not
      } catch (e) {
        return codeErrors(res, e);
      }
    },
  );

  app.post(
    "/api/auth/otp/verify",
    rateLimit((req) => "otpver:" + req.ip, 60, 15 * 60 * 1000),
    async (req: Request, res: Response) => {
      try {
        const p = otpVerifySchema.parse(req.body);
        await verifyPhoneProof(p.phone, { otp: p.otp, idToken: p.idToken });
        const user = await storage.getUserByPhone(p.phone, p.role);
        if (user) {
          if (user.suspended) return res.status(403).json({ message: "This account is suspended" });
          return res.json({ token: signToken(user.id), user: toSafeUser(user) });
        }
        return res.json({ needsSignup: true, signupToken: signSignupToken(p.role, p.phone) });
      } catch (e) {
        return codeErrors(res, e);
      }
    },
  );

  app.post(
    "/api/auth/signup",
    rateLimit((req) => "signup:" + req.ip, 20, 60 * 60 * 1000),
    async (req: Request, res: Response) => {
      try {
        const p = signupSchema.parse(req.body);
        const proof = verifySignupToken(p.signupToken);
        if (!proof) return res.status(400).json({ message: "Your sign-up session expired. Please verify your number again." });
        if (proof.role === "driver" && !p.vehicle) {
          return res.status(400).json({ message: "InstaDrivers must enter their vehicle type and number" });
        }
        const user = await storage.createUser({
          phone: proof.phone,
          role: proof.role,
          fullName: p.fullName,
          isOnline: false,
          vehicle: proof.role === "driver" ? p.vehicle : undefined,
          verification: proof.role === "driver" ? { status: "not_submitted", uploaded: [], files: {} } : undefined,
          rating: proof.role === "driver" ? 5.0 : undefined,
          totalRides: 0,
          totalEarnings: 0,
          feesDue: 0,
        });
        if (!user) return res.status(409).json({ message: "An account already exists for this number. Please sign in." });
        return res.json({ token: signToken(user.id), user: toSafeUser(user) });
      } catch (e) {
        return fail(res, e);
      }
    },
  );

  // Super Admin only: the web console signs in with a password.
  app.post(
    "/api/auth/login",
    rateLimit((req) => "login:" + req.ip + ":" + String(req.body?.phone ?? ""), 10, 15 * 60 * 1000),
    async (req: Request, res: Response) => {
      try {
        const p = loginSchema.parse(req.body);
        const user = await storage.getUserByPhone(p.phone, "admin");
        const ok = await verifyPassword(p.password, user?.passwordHash ?? dummyHash);
        if (!user || !ok) return res.status(401).json({ message: "Wrong mobile number or password" });
        return res.json({ token: signToken(user.id), user: toSafeUser(user) });
      } catch (e) {
        return fail(res, e);
      }
    },
  );

  // For uptime monitors and Docker: says only whether the server and its database are alive. Reveals nothing else.
  app.get("/api/health", async (_req, res) => {
    try {
      if (await storage.ping()) return res.json({ ok: true });
    } catch { /* fall through */ }
    return res.status(503).json({ ok: false });
  });

  // Public: what the signup screens need to show before anyone logs in.
  app.get("/api/config/public", async (_req, res) => {
    const c = await storage.getConfig();
    return res.json({
      enabledVehicleTypes: c.enabledVehicleTypes,
      platformFeePerRide: c.platformFeePerRide,
      maxFeesDue: c.maxFeesDue,
      serviceAreaName: c.serviceArea.name,
      supportPhone: c.supportPhone || "",
      supportEmail: c.supportEmail || "",
      sourceCodeUrl: c.sourceCodeUrl || "",
    });
  });

  app.get("/api/me", auth, (req, res) => res.json(toSafeUser(req.user!)));

  // ----------------------------------------------------------------- users
  app.get("/api/user/:id", auth, requireSelfOrAdmin("id"), async (req, res) => {
    const user = await storage.getUser(req.params.id as string);
    if (!user) return res.status(404).json({ message: "User not found" });
    return res.json(toSafeUser(user));
  });

  app.put("/api/user/:id/location", auth, requireSelfOrAdmin("id"), async (req, res) => {
    try {
      const p = updateLocationSchema.parse(req.body);
      const user = await storage.updateUser(req.params.id as string, { currentLocation: { lat: p.lat, lng: p.lng } });
      if (!user) return res.status(404).json({ message: "User not found" });
      return res.json({ success: true });
    } catch (e) {
      return fail(res, e);
    }
  });

  app.put("/api/user/:id/online", auth, requireRole("driver"), requireSelfOrAdmin("id"), async (req, res) => {
    const wantOnline = req.body?.isOnline === true;
    const driver = req.user!;
    if (wantOnline) {
      const config = await storage.getConfig();
      const check = driverEligibility(driver, config);
      if (!check.ok) return res.status(403).json({ message: check.reason });
    }
    const updated = await storage.updateUser(driver.id, { isOnline: wantOnline });
    return res.json(toSafeUser(updated!));
  });

  async function eligibleOnlineDrivers(): Promise<StoredUser[]> {
    const config = await storage.getConfig();
    const all = await storage.getUsersByRole("driver");
    return all.filter((d) => d.isOnline && d.currentLocation && driverEligibility(d, config).ok);
  }

  app.get("/api/drivers/nearby", auth, async (req, res) => {
    const lat = parseFloat(req.query.lat as string);
    const lng = parseFloat(req.query.lng as string);
    const radius = Math.min(parseFloat(req.query.radius as string) || 5, 20);
    const vehicleType = req.query.vehicleType as string | undefined;
    if (isNaN(lat) || isNaN(lng)) return res.status(400).json({ message: "lat and lng required" });
    const drivers = await eligibleOnlineDrivers();
    const nearby = drivers
      .filter((d) => d.id !== req.user!.id && (!vehicleType || d.vehicle?.type === vehicleType))
      .map((d) => ({
        id: d.id,
        vehicleType: d.vehicle?.type,
        rating: d.rating,
        currentLocation: d.currentLocation!,
        distance:
          Math.round(haversineKm(lat, lng, d.currentLocation!.lat, d.currentLocation!.lng) * 10) / 10,
      }))
      .filter((d) => d.distance <= radius)
      .sort((a, b) => a.distance - b.distance);
    return res.json(nearby);
  });

  // ------------------------------------------------ driver verification
  app.put(
    "/api/driver/documents/:kind",
    express.json({ limit: "5mb" }),
    auth,
    requireRole("driver"),
    async (req, res) => {
      try {
        const kind = req.params.kind as DocumentKind;
        if (!DOCUMENT_KINDS.includes(kind)) return res.status(400).json({ message: "Unknown document type" });
        const driver = req.user!;
        const v = driver.verification!;
        const isRenewal = v.status === "approved" && kind === "insurance";
        if (!["not_submitted", "needs_fix"].includes(v.status) && !isRenewal) {
          return res.status(400).json({ message: "Your documents are already submitted" });
        }
        if (v.status === "needs_fix" && !(v.fixKinds || []).includes(kind) && v.files[kind]) {
          return res.status(400).json({ message: "The admin did not ask you to re-upload this one" });
        }
        const b64 = typeof req.body?.data === "string" ? req.body.data.replace(/^data:[^,]+,/, "") : "";
        const buf = Buffer.from(b64, "base64");
        if (buf.length === 0) return res.status(400).json({ message: "No image received" });
        if (buf.length > MAX_DOC_BYTES) return res.status(400).json({ message: "Image is too large (max 3 MB)" });
        const ext = sniffImage(buf);
        if (!ext) return res.status(400).json({ message: "Only JPG or PNG photos are accepted" });

        const dir = path.join(UPLOADS_DIR, driver.id);
        await fs.promises.mkdir(dir, { recursive: true });
        for (const old of ["jpg", "png"]) {
          await fs.promises.rm(path.join(dir, `${kind}.${old}`), { force: true });
        }
        const file = `${kind}.${ext}`;
        await fs.promises.writeFile(path.join(dir, file), buf, { mode: 0o600 });

        const files = { ...v.files, [kind]: file };
        const fixKinds = (v.fixKinds || []).filter((k) => k !== kind);
        const next = isRenewal
          ? { ...v, files, status: "pending" as const, submittedAt: new Date().toISOString(), fixKinds: [] }
          : { ...v, files, fixKinds };
        const updated = await storage.updateUser(driver.id, {
          verification: next,
          ...(isRenewal ? { isOnline: false } : {}),
        });
        return res.json(toSafeUser(updated!));
      } catch (e) {
        return fail(res, e);
      }
    },
  );

  app.post("/api/driver/submit", auth, requireRole("driver"), async (req, res) => {
    try {
      const p = submitVerificationSchema.parse(req.body ?? {});
      const driver = req.user!;
      const v = driver.verification!;
      if (!["not_submitted", "needs_fix"].includes(v.status)) {
        return res.status(400).json({ message: "Already submitted" });
      }
      const missing = DOCUMENT_KINDS.filter((k) => !v.files[k]);
      if (missing.length) {
        return res.status(400).json({ message: `Please upload: ${missing.join(", ").replace(/_/g, " ")}` });
      }
      if ((v.fixKinds || []).length) {
        return res.status(400).json({ message: "Please re-upload the items the admin asked for" });
      }
      const updated = await storage.updateUser(driver.id, {
        vehicle: p.vehicleNumber && driver.vehicle ? { ...driver.vehicle, number: p.vehicleNumber } : driver.vehicle,
        verification: {
          ...v,
          status: "pending",
          submittedAt: new Date().toISOString(),
          rejectionReason: undefined,
        },
      });
      return res.json(toSafeUser(updated!));
    } catch (e) {
      return fail(res, e);
    }
  });

  // ----------------------------------------------------------------- rides
  app.get("/api/fare/estimate", auth, async (req, res) => {
    const pLat = parseFloat(req.query.pLat as string);
    const pLng = parseFloat(req.query.pLng as string);
    const dLat = parseFloat(req.query.dLat as string);
    const dLng = parseFloat(req.query.dLng as string);
    if ([pLat, pLng, dLat, dLng].some(isNaN)) return res.status(400).json({ message: "Coordinates required" });
    const config = await storage.getConfig();
    const sa = config.serviceArea;
    if ([[pLat, pLng], [dLat, dLng]].some(([la, ln]) => haversineKm(sa.lat, sa.lng, la, ln) > sa.radiusKm)) {
      return res.status(400).json({ message: `We only serve ${sa.name} for now` });
    }
    const km = haversineKm(pLat, pLng, dLat, dLng);
    if (km < 0.1) return res.status(400).json({ message: "Pickup and drop are too close" });
    const types = config.enabledVehicleTypes;
    const quotes = Object.fromEntries(types.map((t) => [t, quoteFare(config, t, km)]));
    const requested = req.query.vehicleType as string | undefined;
    if (requested && quotes[requested]) return res.json({ ...quotes[requested], quotes });
    return res.json({ quotes });
  });

  app.post("/api/rides", auth, requireRole("rider"), async (req, res) => {
    try {
      const p = requestRideSchema.parse(req.body);
      const rider = req.user!;
      const config = await storage.getConfig();
      if (!config.enabledVehicleTypes.includes(p.vehicleType)) {
        return res.status(400).json({ message: "This vehicle type is not available right now" });
      }
      const sa = config.serviceArea;
      const outside = [p.pickup, p.dropoff].some((pt) => haversineKm(sa.lat, sa.lng, pt.lat, pt.lng) > sa.radiusKm);
      if (outside) return res.status(400).json({ message: `We only serve ${sa.name} for now` });
      const km = haversineKm(p.pickup.lat, p.pickup.lng, p.dropoff.lat, p.dropoff.lng);
      if (km < 0.1) return res.status(400).json({ message: "Pickup and drop are too close" });
      const mine = await storage.getRidesByRider(rider.id);
      if (mine.some((r) => (ACTIVE as readonly string[]).includes(r.status))) {
        return res.status(409).json({ message: "You already have a ride in progress" });
      }
      const quote = quoteFare(config, p.vehicleType, km);
      const { distance, duration, ...fare } = quote;
      const ride = await storage.createRide({
        riderId: rider.id,
        vehicleType: p.vehicleType,
        status: "requested",
        pickup: p.pickup,
        dropoff: p.dropoff,
        riderName: rider.fullName,
        fare,
        distance,
        duration,
      });
      await storage.createEvent({
        type: "ride_requested",
        rideId: ride.id,
        userId: rider.id,
        data: { fare: ride.fare },
        read: false,
      });
      for (const d of await eligibleOnlineDrivers()) {
        if (d.vehicle?.type !== p.vehicleType) continue;
        const dist = haversineKm(p.pickup.lat, p.pickup.lng, d.currentLocation!.lat, d.currentLocation!.lng);
        if (dist <= 10) {
          await storage.createEvent({
            type: "ride_requested",
            rideId: ride.id,
            userId: d.id,
            data: { pickup: ride.pickup, dropoff: ride.dropoff, fare: ride.fare, riderName: rider.fullName },
            read: false,
          });
        }
      }
      return res.json(sanitizeRide(rider, ride));
    } catch (e) {
      return fail(res, e);
    }
  });

  app.get("/api/rides/available", auth, requireRole("driver"), async (req, res) => {
    const driver = req.user!;
    const config = await storage.getConfig();
    if (!driverEligibility(driver, config).ok || !driver.currentLocation || !driver.vehicle) return res.json([]);
    const active = await storage.getActiveRides();
    const list = active
      .filter((r) => r.status === "requested" && r.vehicleType === driver.vehicle!.type)
      .filter((r) => !(r.declinedBy || []).includes(driver.id))
      .filter(
        (r) => haversineKm(r.pickup.lat, r.pickup.lng, driver.currentLocation!.lat, driver.currentLocation!.lng) <= 10,
      )
      .map((r) => sanitizeRide(driver, r));
    return res.json(list);
  });

  app.get("/api/rides/rider/:riderId", auth, requireSelfOrAdmin("riderId"), async (req, res) => {
    const rides = await storage.getRidesByRider(req.params.riderId as string);
    return res.json(rides.map((r) => sanitizeRide(req.user!, r)));
  });

  app.get("/api/rides/driver/:driverId", auth, requireSelfOrAdmin("driverId"), async (req, res) => {
    const rides = await storage.getRidesByDriver(req.params.driverId as string);
    return res.json(rides.map((r) => sanitizeRide(req.user!, r)));
  });

  app.get("/api/rides/driver/:driverId/active", auth, requireSelfOrAdmin("driverId"), async (req, res) => {
    const rides = await storage.getRidesByDriver(req.params.driverId as string);
    const active = rides.find((r) => (ACTIVE as readonly string[]).includes(r.status));
    return res.json(active ? sanitizeRide(req.user!, active) : null);
  });

  app.get("/api/rides/rider/:riderId/active", auth, requireSelfOrAdmin("riderId"), async (req, res) => {
    const rides = await storage.getRidesByRider(req.params.riderId as string);
    const active = rides.find((r) => (ACTIVE as readonly string[]).includes(r.status));
    if (active) return res.json(sanitizeRide(req.user!, active));
    const recent = rides
      .filter((r) => r.status === "completed" && r.completedAt)
      .sort((a, b) => new Date(b.completedAt!).getTime() - new Date(a.completedAt!).getTime())[0];
    if (recent && Date.now() - new Date(recent.completedAt!).getTime() < 60000) {
      return res.json(sanitizeRide(req.user!, recent));
    }
    return res.json(null);
  });

  app.get("/api/rides/rider/:riderId/recent-completed", auth, requireSelfOrAdmin("riderId"), async (req, res) => {
    const rides = await storage.getRidesByRider(req.params.riderId as string);
    const completed = rides.find((r) => r.status === "completed" && !r.review);
    return res.json(completed ? sanitizeRide(req.user!, completed) : null);
  });

  app.get("/api/rides/:id", auth, async (req, res) => {
    const ride = await storage.getRide(req.params.id as string);
    if (!ride || !canSeeRide(req.user!, ride)) return res.status(404).json({ message: "Ride not found" });
    return res.json(sanitizeRide(req.user!, ride));
  });

  // The driver rejects a request (or lets the 30-second timer run out). It disappears for this driver only.
  app.put("/api/rides/:id/decline", auth, requireRole("driver"), async (req, res) => {
    const driver = req.user!;
    const rideId = req.params.id as string;
    if (!(await storage.acquireLock("accept:" + rideId, 5000))) {
      return res.status(409).json({ message: "Please try again" });
    }
    try {
      const ride = await storage.getRide(rideId);
      if (!ride) return res.status(404).json({ message: "Ride not found" });
      // Already taken or cancelled: there is nothing left to hide, so this is not an error.
      if (ride.status !== "requested") return res.json({ ok: true });
      const declined = ride.declinedBy || [];
      if (!declined.includes(driver.id)) await storage.updateRide(rideId, { declinedBy: [...declined, driver.id] });
      return res.json({ ok: true });
    } finally {
      await storage.releaseLock("accept:" + rideId);
    }
  });

  app.put("/api/rides/:id/accept", auth, requireRole("driver"), async (req, res) => {
    const driver = req.user!;
    const config = await storage.getConfig();
    const check = driverEligibility(driver, config);
    if (!check.ok) return res.status(403).json({ message: check.reason });

    const rideId = req.params.id as string;
    if (!(await storage.acquireLock("accept:" + rideId, 5000))) {
      return res.status(409).json({ message: "Another driver is accepting this ride" });
    }
    try {
      const ride = await storage.getRide(rideId);
      if (!ride) return res.status(404).json({ message: "Ride not found" });
      if (ride.status !== "requested") return res.status(409).json({ message: "Ride is no longer available" });
      if ((ride.declinedBy || []).includes(driver.id)) {
        return res.status(403).json({ message: "You rejected or cancelled this ride" });
      }
      if (ride.vehicleType !== driver.vehicle?.type) {
        return res.status(403).json({ message: "This ride needs a different vehicle type" });
      }
      const mine = await storage.getRidesByDriver(driver.id);
      if (mine.some((r) => (ACTIVE as readonly string[]).includes(r.status))) {
        return res.status(409).json({ message: "Finish your current ride first" });
      }
      const updated = await storage.updateRide(rideId, {
        driverId: driver.id,
        driverName: driver.fullName,
        driverVehicle: driver.vehicle,
        driverRating: driver.rating,
        status: "accepted",
        acceptedAt: new Date().toISOString(),
        startOtp: await makeStartCode(ride.riderId),
      });
      await storage.createEvent({
        type: "ride_accepted",
        rideId,
        userId: ride.riderId,
        data: { driverName: driver.fullName, vehicle: driver.vehicle },
        read: false,
      });
      return res.json(sanitizeRide(driver, updated!));
    } finally {
      await storage.releaseLock("accept:" + rideId);
    }
  });

  const DRIVER_STEPS: Record<string, RideStatus[]> = {
    arriving: ["accepted"],
    arrived: ["accepted", "arriving"],
    in_progress: ["arrived"],
    completed: ["in_progress"],
  };
  const EVENT_FOR: Record<string, string> = {
    arriving: "driver_arriving",
    arrived: "driver_arrived",
    in_progress: "ride_started",
    completed: "ride_completed",
    cancelled: "ride_cancelled",
  };

  app.put("/api/rides/:id/status", auth, async (req, res) => {
    const user = req.user!;
    const status = req.body?.status as RideStatus;
    const ride = await storage.getRide(req.params.id as string);
    if (!ride || !canSeeRide(user, ride)) return res.status(404).json({ message: "Ride not found" });
    const isDriver = ride.driverId === user.id;
    const isRider = ride.riderId === user.id;
    const beforeStart: RideStatus[] = ["requested", "accepted", "arriving", "arrived"];

    // ---- cancel (InstaRider or InstaDriver, before the trip starts)
    if (status === "cancelled") {
      if (!(isRider || isDriver)) return res.status(403).json({ message: "Not allowed" });
      if (!beforeStart.includes(ride.status)) {
        return res.status(400).json({ message: "The trip has already started" });
      }
      if (isDriver && !isRider) {
        // Driver backs out: the ride goes back to searching so the rider does not start over.
        const why = cleanCancelReason("driver", req.body?.reason);
        const reopened = await storage.updateRide(ride.id, {
          declinedBy: [...(ride.declinedBy || []), user.id],
          cancelLog: [...(ride.cancelLog || []), { by: "driver", reason: why, at: new Date().toISOString() }],
          status: "requested",
          driverId: undefined,
          driverName: undefined,
          driverVehicle: undefined,
          driverRating: undefined,
          acceptedAt: undefined,
          arrivedAt: undefined,
          startOtp: undefined,
        });
        await storage.createEvent({
          type: "ride_cancelled",
          rideId: ride.id,
          userId: ride.riderId,
          data: { by: "driver", searchingAgain: true, reason: cleanCancelReason("driver", req.body?.reason) },
          read: false,
        });
        return res.json(sanitizeRide(user, reopened!));
      }
      const riderWhy = cleanCancelReason("rider", req.body?.reason);
      const nowIso = new Date().toISOString();
      const updated = await storage.updateRide(ride.id, {
        status: "cancelled",
        cancelledBy: "rider",
        cancelReason: riderWhy,
        cancelledAt: nowIso,
        cancelLog: [...(ride.cancelLog || []), { by: "rider", reason: riderWhy, at: nowIso }],
        completedAt: nowIso,
      });
      if (ride.driverId) {
        await storage.createEvent({
          type: "ride_cancelled",
          rideId: ride.id,
          userId: ride.driverId,
          data: { by: "rider" },
          read: false,
        });
      }
      return res.json(sanitizeRide(user, updated!));
    }

    // ---- driver steps
    if (!isDriver || !DRIVER_STEPS[status]) return res.status(403).json({ message: "Not allowed" });
    if (!DRIVER_STEPS[status].includes(ride.status)) {
      return res.status(400).json({ message: `Cannot move from ${ride.status} to ${status}` });
    }
    const updates: Partial<Ride> = { status };
    if (status === "arrived") updates.arrivedAt = new Date().toISOString();
    if (status === "in_progress") {
      const otp = String(req.body?.otp ?? "");
      if (!ride.startOtp || otp !== ride.startOtp) {
        return res.status(400).json({ message: "Wrong start code. Ask the rider for the 4-digit code" });
      }
      updates.startedAt = new Date().toISOString();
    }
    if (status === "completed") {
      updates.completedAt = new Date().toISOString();
      if (ride.fare) {
        const config = await storage.getConfig();
        const feesDue = (user.feesDue || 0) + ride.fare.platformFee;
        await storage.updateUser(user.id, {
          totalRides: (user.totalRides || 0) + 1,
          totalEarnings: (user.totalEarnings || 0) + ride.fare.driverEarnings,
          feesDue,
          ...(feesDue >= config.maxFeesDue ? { isOnline: false } : {}),
        });
      }
    }
    const updated = await storage.updateRide(ride.id, updates);
    const type = EVENT_FOR[status];
    for (const uid of [ride.riderId, ride.driverId]) {
      if (uid) {
        await storage.createEvent({
          type: type as any,
          rideId: ride.id,
          userId: uid,
          data: { status, fare: ride.fare },
          read: false,
        });
      }
    }
    return res.json(sanitizeRide(user, updated!));
  });

  app.put("/api/rides/:id/review", auth, requireRole("rider"), async (req, res) => {
    const rating = Number(req.body?.rating);
    const comment = typeof req.body?.comment === "string" ? req.body.comment.trim().slice(0, 500) : undefined;
    if (!(rating >= 1 && rating <= 5)) return res.status(400).json({ message: "Rating must be between 1 and 5" });
    const ride = await storage.getRide(req.params.id as string);
    if (!ride || ride.riderId !== req.user!.id) return res.status(404).json({ message: "Ride not found" });
    if (ride.status !== "completed") return res.status(400).json({ message: "Can only review completed rides" });
    if (ride.review) return res.status(400).json({ message: "Ride already reviewed" });
    const review = { rating: Math.round(rating), comment: comment || undefined, createdAt: new Date().toISOString() };
    const updated = await storage.updateRide(ride.id, { review });
    if (ride.driverId) {
      const reviewed = (await storage.getRidesByDriver(ride.driverId)).filter((r) => r.review);
      const total = reviewed.reduce((s, r) => s + (r.review?.rating || 0), 0);
      const avg = total / reviewed.length;
      await storage.updateUser(ride.driverId, { rating: Math.round(avg * 10) / 10 });
    }
    return res.json(sanitizeRide(req.user!, updated!));
  });

  // ---------------------------------------------------------------- events
  app.get("/api/events/:userId", auth, requireSelfOrAdmin("userId"), async (req, res) => {
    return res.json(await storage.getEventsByUser(req.params.userId as string));
  });

  app.put("/api/events/:eventId/read", auth, async (req, res) => {
    const e = await storage.getEvent(req.params.eventId as string);
    if (!e || e.userId !== req.user!.id) return res.status(404).json({ message: "Not found" });
    await storage.markEventRead(e.id);
    return res.json({ success: true });
  });

  // ----------------------------------------------------------- Super Admin
  app.get("/api/admin/stats", ...adminOnly, async (_req, res) => {
    const rides = await storage.getAllRides();
    const users = await storage.getAllUsers();
    const drivers = users.filter((u) => u.role === "driver");
    const riders = users.filter((u) => u.role === "rider");
    const completed = rides.filter((r) => r.status === "completed");
    const sum = (f: (r: Ride) => number) => completed.reduce((s, r) => s + f(r), 0);
    const feesDueTotal = drivers.reduce((s, d) => s + (d.feesDue || 0), 0);
    const platformFeesEarned = sum((r) => r.fare?.platformFee || 0);
    return res.json({
      totalDrivers: drivers.length,
      totalRiders: riders.length,
      pendingVerifications: drivers.filter((d) => d.verification?.status === "pending").length,
      onlineDrivers: drivers.filter((d) => d.isOnline && !d.suspended).length,
      totalRides: rides.length,
      activeRides: rides.filter((r) => (ACTIVE as readonly string[]).includes(r.status)).length,
      completedRides: completed.length,
      cancelledRides: rides.filter((r) => r.status === "cancelled").length,
      suspendedUsers: users.filter((u) => u.suspended).length,
      totalFares: sum((r) => r.fare?.totalFare || 0),
      totalDriverEarnings: sum((r) => r.fare?.driverEarnings || 0),
      platformFeesEarned,
      platformFeesCollected: Math.max(platformFeesEarned - feesDueTotal, 0),
      feesDueTotal,
      sosOpen: rides.filter((r) => r.sos && !r.sos.ackAt).length,
    });
  });

  app.get("/api/admin/rides", ...adminOnly, async (_req, res) => res.json(await storage.getAllRides()));

  app.get("/api/admin/users", ...adminOnly, async (_req, res) => {
    const all = await storage.getAllUsers();
    return res.json(all.filter((u) => u.role !== "admin").map(toSafeUser));
  });

  app.get("/api/admin/verifications", ...adminOnly, async (req, res) => {
    const status = (req.query.status as string) || "pending";
    const drivers = (await storage.getUsersByRole("driver")).filter((d) => d.verification?.status === status);
    drivers.sort((a, b) => (a.verification?.submittedAt || "").localeCompare(b.verification?.submittedAt || ""));
    return res.json(drivers.map(toSafeUser));
  });

  app.get("/api/admin/documents/:userId/:kind", ...adminOnly, async (req, res) => {
    const kind = req.params.kind as DocumentKind;
    if (!DOCUMENT_KINDS.includes(kind)) return res.status(400).json({ message: "Unknown document type" });
    const user = await storage.getUser(req.params.userId as string);
    const file = user?.verification?.files[kind];
    if (!user || !file) return res.status(404).json({ message: "Not found" });
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.sendFile(path.join(UPLOADS_DIR, user.id, file), { dotfiles: "allow" });
  });

  app.post("/api/admin/drivers/:id/verify", ...adminOnly, async (req, res) => {
    try {
      const d = verifyDecisionSchema.parse(req.body);
      const admin = req.user!;
      const driver = await storage.getUser(req.params.id as string);
      if (!driver || driver.role !== "driver" || !driver.verification) {
        return res.status(404).json({ message: "Driver not found" });
      }
      const v = driver.verification;
      if (v.status !== "pending") return res.status(400).json({ message: "This application is not waiting for review" });
      const now = new Date().toISOString();
      let next = { ...v, reviewedAt: now, reviewedBy: admin.id };
      if (d.decision === "approve") {
        next = {
          ...next,
          status: "approved",
          vahanChecked: true,
          insuranceExpiry: d.insuranceExpiry,
          fitnessExpiry: d.fitnessExpiry,
          rejectionReason: undefined,
          fixKinds: [],
        };
      } else if (d.decision === "needs_fix") {
        const files = { ...v.files };
        for (const k of d.kinds) {
          const f = files[k];
          if (f) await fs.promises.rm(path.join(UPLOADS_DIR, driver.id, f), { force: true });
          delete files[k];
        }
        next = { ...next, status: "needs_fix", fixKinds: d.kinds, rejectionReason: d.reason, files };
      } else {
        next = { ...next, status: "rejected", rejectionReason: d.reason, fixKinds: [] };
      }
      const updated = await storage.updateUser(driver.id, { verification: next, isOnline: false });
      await storage.addAudit({
        actorId: admin.id,
        actorName: admin.fullName,
        action: "driver_verification_" + d.decision,
        entity: `driver:${driver.id}`,
        before: v.status,
        after: next.status,
      });
      await storage.createEvent({
        type: "verification_update",
        rideId: "",
        userId: driver.id,
        data: { status: next.status, reason: next.rejectionReason },
        read: false,
      });
      return res.json(toSafeUser(updated!));
    } catch (e) {
      return fail(res, e);
    }
  });

  app.put("/api/admin/users/:id/suspend", ...adminOnly, async (req, res) => {
    const user = await storage.getUser(req.params.id as string);
    if (!user) return res.status(404).json({ message: "User not found" });
    if (user.role === "admin") return res.status(403).json({ message: "Cannot suspend admin" });
    const updated = await storage.updateUser(user.id, {
      suspended: !user.suspended,
      isOnline: user.suspended ? user.isOnline : false,
    });
    await storage.addAudit({
      actorId: req.user!.id,
      actorName: req.user!.fullName,
      action: user.suspended ? "unsuspend_user" : "suspend_user",
      entity: `user:${user.id}`,
    });
    return res.json(toSafeUser(updated!));
  });

  app.delete("/api/admin/users/:id", ...adminOnly, async (req, res) => {
    const user = await storage.getUser(req.params.id as string);
    if (!user) return res.status(404).json({ message: "User not found" });
    if (user.role === "admin") return res.status(403).json({ message: "Cannot remove admin" });
    await storage.deleteUser(user.id);
    await fs.promises.rm(path.join(UPLOADS_DIR, user.id), { recursive: true, force: true });
    await storage.addAudit({
      actorId: req.user!.id,
      actorName: req.user!.fullName,
      action: "delete_user",
      entity: `user:${user.id}`,
    });
    return res.json({ success: true });
  });

  app.put("/api/admin/rides/:id/cancel", ...adminOnly, async (req, res) => {
    const ride = await storage.getRide(req.params.id as string);
    if (!ride) return res.status(404).json({ message: "Ride not found" });
    if (["completed", "cancelled"].includes(ride.status)) {
      return res.status(400).json({ message: "Ride already " + ride.status });
    }
    const updated = await storage.updateRide(ride.id, {
      status: "cancelled",
      cancelledBy: "admin",
      completedAt: new Date().toISOString(),
    });
    await storage.addAudit({
      actorId: req.user!.id,
      actorName: req.user!.fullName,
      action: "cancel_ride",
      entity: `ride:${ride.id}`,
    });
    return res.json(updated);
  });

  app.post("/api/admin/drivers/:id/settle", ...adminOnly, async (req, res) => {
    const amount = Number(req.body?.amount);
    const driver = await storage.getUser(req.params.id as string);
    if (!driver || driver.role !== "driver") return res.status(404).json({ message: "Driver not found" });
    const due = driver.feesDue || 0;
    if (!(amount > 0) || amount > due) {
      return res.status(400).json({ message: `Enter an amount between ₹1 and ₹${due}` });
    }
    const updated = await storage.updateUser(driver.id, { feesDue: due - amount });
    await storage.addAudit({
      actorId: req.user!.id,
      actorName: req.user!.fullName,
      action: "settle_driver_fees",
      entity: `driver:${driver.id}`,
      before: due,
      after: due - amount,
    });
    return res.json(toSafeUser(updated!));
  });

  app.get("/api/admin/config", ...adminOnly, async (_req, res) => res.json(await storage.getConfig()));

  app.put("/api/admin/config", ...adminOnly, async (req, res) => {
    try {
      const updates = configUpdateSchema.parse(req.body);
      const before = await storage.getConfig();
      const after = await storage.updateConfig(updates as Partial<PlatformConfig>);
      await storage.addAudit({
        actorId: req.user!.id,
        actorName: req.user!.fullName,
        action: "update_config",
        entity: "config",
        before,
        after,
      });
      return res.json(after);
    } catch (e) {
      return fail(res, e);
    }
  });

  // The go-live meter.
  app.get("/api/admin/readiness", ...adminOnly, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    return res.json(await buildReadiness(req));
  });

  app.put("/api/admin/readiness/manual/:id", ...adminOnly, async (req, res) => {
    const id = String(req.params.id);
    if (!MANUAL_STEPS.some((m) => m.id === id)) return res.status(404).json({ message: "Unknown step" });
    const done = req.body?.done === true;
    await storage.setManualCheck(id, done);
    await storage.addAudit({ actorId: req.user!.id, actorName: req.user!.fullName, action: done ? "meter_mark_done" : "meter_mark_undone", entity: `step:${id}` });
    return res.json({ success: true });
  });

  app.get("/api/admin/audit", ...adminOnly, async (_req, res) => res.json(await storage.getAudit(100)));

  // ------------------------------------------------------- my account
  const firstName = (full: string | undefined) => (full || "").trim().split(/\s+/)[0] || "";

  app.put("/api/me", auth, async (req, res) => {
    try {
      const p = updateProfileSchema.parse(req.body);
      const updated = await storage.updateUser(req.user!.id, { fullName: p.fullName });
      return res.json(toSafeUser(updated!));
    } catch (e) {
      return fail(res, e);
    }
  });

  app.put("/api/me/emergency-contact", auth, async (req, res) => {
    try {
      const p = emergencyContactSchema.parse(req.body);
      const updated = await storage.updateUser(req.user!.id, { emergencyContact: p });
      return res.json(toSafeUser(updated!));
    } catch (e) {
      return fail(res, e);
    }
  });

  app.delete("/api/me/emergency-contact", auth, async (req, res) => {
    const updated = await storage.updateUser(req.user!.id, { emergencyContact: undefined });
    return res.json(toSafeUser(updated!));
  });

  app.post("/api/me/favourites", auth, requireRole("rider"), async (req, res) => {
    try {
      const p = favouriteSchema.parse(req.body);
      const list = req.user!.favourites || [];
      if (list.length >= 10) return res.status(400).json({ message: "You can save up to 10 places" });
      const fav = { id: randomUUID(), ...p };
      const updated = await storage.updateUser(req.user!.id, { favourites: [...list, fav] });
      return res.json(toSafeUser(updated!));
    } catch (e) {
      return fail(res, e);
    }
  });

  app.delete("/api/me/favourites/:id", auth, requireRole("rider"), async (req, res) => {
    const list = (req.user!.favourites || []).filter((f) => f.id !== req.params.id);
    const updated = await storage.updateUser(req.user!.id, { favourites: list });
    return res.json(toSafeUser(updated!));
  });

  app.delete("/api/me", auth, async (req, res) => {
    try {
      const p = deleteAccountSchema.parse(req.body);
      const user = req.user!;
      if (user.role === "admin") return res.status(403).json({ message: "The Super Admin account cannot be deleted here" });
      const rides = user.role === "rider" ? await storage.getRidesByRider(user.id) : await storage.getRidesByDriver(user.id);
      if (rides.some((r) => (ACTIVE as readonly string[]).includes(r.status))) {
        return res.status(409).json({ message: "Finish or cancel your current ride before deleting your account" });
      }
      await verifyPhoneProof(user.phone, { otp: p.otp, idToken: p.idToken });
      // Keep the trip records (needed for fee and dispute history) but remove the person's name from them.
      for (const r of rides) {
        await storage.updateRide(
          r.id,
          user.role === "rider"
            ? { riderName: "Deleted user" }
            : { driverName: "Deleted driver", driverVehicle: r.driverVehicle ? { ...r.driverVehicle, number: "REMOVED" } : undefined },
        );
      }
      await storage.deleteUser(user.id);
      await fs.promises.rm(path.join(UPLOADS_DIR, user.id), { recursive: true, force: true });
      await storage.addAudit({
        actorId: user.id,
        actorName: "Deleted user",
        action: "delete_own_account",
        entity: `role:${user.role}`,
        after: p.reason || "",
      });
      return res.json({ success: true });
    } catch (e) {
      return codeErrors(res, e);
    }
  });

  // A code to your own number, to confirm that you really want to delete your account.
  app.post(
    "/api/me/otp",
    rateLimit((req) => "meotp:" + req.ip, otpIpLimit, 60 * 60 * 1000),
    auth,
    async (req, res) => {
      try {
        if (req.user!.role === "admin") return res.status(403).json({ message: "Not available for the Super Admin account" });
        const out = await startPhoneProof(req.user!.phone);
        return res.json({ sent: out.mode === "code", ...out });
      } catch (e) {
        return codeErrors(res, e);
      }
    },
  );

  // ---------------------------------------------------- address search
  const geoLimit = rateLimit((req) => "geo:" + req.ip, 40, 60 * 1000);

  app.get("/api/geocode/search", geoLimit, auth, async (req, res) => {
    try {
      const q = String(req.query.q ?? "");
      if (q.trim().length < 3) return res.json([]);
      const config = await storage.getConfig();
      return res.json(await searchPlaces(q, config.serviceArea));
    } catch (e: any) {
      return res.status(e?.status || 502).json({ message: e?.message || "Address search failed" });
    }
  });

  app.get("/api/geocode/reverse", geoLimit, auth, async (req, res) => {
    try {
      const lat = parseFloat(req.query.lat as string);
      const lng = parseFloat(req.query.lng as string);
      if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
        return res.status(400).json({ message: "lat and lng required" });
      }
      return res.json((await reversePlace(lat, lng)) || { label: "", address: "" });
    } catch (e: any) {
      return res.status(e?.status || 502).json({ message: e?.message || "Address lookup failed" });
    }
  });

  // -------------------------------------------- trip sharing and SOS
  const ENDED_LINK_GRACE_MS = 60 * 60 * 1000;

  app.post("/api/rides/:id/share", auth, requireRole("rider"), async (req, res) => {
    const ride = await storage.getRide(req.params.id as string);
    if (!ride || ride.riderId !== req.user!.id) return res.status(404).json({ message: "Ride not found" });
    if (!(ACTIVE as readonly string[]).includes(ride.status) || ride.status === "requested") {
      return res.status(400).json({ message: "You can share a trip once a driver has accepted it" });
    }
    const token = randomBytes(24).toString("base64url");
    await storage.createShare(ride.id, token, 24 * 60 * 60);
    return res.json({ token, path: `/track/${token}` });
  });

  // Public (no login): whoever has the link can see this one trip, without any phone numbers.
  app.get(
    "/api/track/:token",
    rateLimit((req) => "track:" + req.ip, 120, 60 * 1000),
    async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      const token = String(req.params.token || "");
      if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return res.status(404).json({ message: "Trip link not found" });
      const rideId = await storage.getShareRideId(token);
      const ride = rideId ? await storage.getRide(rideId) : undefined;
      if (!ride) return res.status(404).json({ message: "Trip link not found or expired" });
      const ended = ride.status === "completed" || ride.status === "cancelled";
      const endedAt = ride.completedAt ? new Date(ride.completedAt).getTime() : 0;
      if (ended && Date.now() - endedAt > ENDED_LINK_GRACE_MS) {
        return res.status(410).json({ message: "This trip has ended and the link has expired" });
      }
      const driver = ride.driverId ? await storage.getUser(ride.driverId) : undefined;
      const rider = await storage.getUser(ride.riderId);
      return res.json({
        status: ride.status,
        riderFirstName: firstName(rider?.fullName ?? ride.riderName),
        pickup: ride.pickup,
        dropoff: ride.dropoff,
        driver: ride.driverId
          ? {
              firstName: firstName(ride.driverName),
              vehicle: ride.driverVehicle ? { type: ride.driverVehicle.type, number: ride.driverVehicle.number } : null,
              location: driver?.currentLocation ?? null,
            }
          : null,
        sos: !!ride.sos,
        serverTime: new Date().toISOString(),
      });
    },
  );

  app.post("/api/rides/:id/sos", auth, async (req, res) => {
    try {
      const p = sosSchema.parse(req.body ?? {});
      const user = req.user!;
      const ride = await storage.getRide(req.params.id as string);
      if (!ride || (ride.riderId !== user.id && ride.driverId !== user.id)) {
        return res.status(404).json({ message: "Ride not found" });
      }
      if (!(ACTIVE as readonly string[]).includes(ride.status)) {
        return res.status(400).json({ message: "SOS is only available during a ride" });
      }
      const raisedBy = ride.riderId === user.id ? "rider" : "driver";
      const where = p.lat !== undefined && p.lng !== undefined ? { lat: p.lat, lng: p.lng } : user.currentLocation;
      const sos = {
        at: ride.sos?.at ?? new Date().toISOString(),
        lat: where?.lat,
        lng: where?.lng,
        raisedBy: ride.sos?.raisedBy ?? (raisedBy as "rider" | "driver"),
        // a new press re-opens an acknowledged alert
        ackBy: undefined,
        ackAt: undefined,
      };
      await storage.updateRide(ride.id, { sos });
      await storage.createEvent({ type: "sos_alert", rideId: ride.id, userId: user.id, data: { raisedBy }, read: true });
      return res.json({ success: true });
    } catch (e) {
      return fail(res, e);
    }
  });

  app.get("/api/admin/sos", ...adminOnly, async (_req, res) => {
    const rides = (await storage.getAllRides()).filter(
      (r) => r.sos && (!r.sos.ackAt || Date.now() - new Date(r.sos.ackAt).getTime() < 24 * 60 * 60 * 1000),
    );
    const out = [];
    for (const r of rides) {
      const rider = await storage.getUser(r.riderId);
      const driver = r.driverId ? await storage.getUser(r.driverId) : undefined;
      out.push({
        rideId: r.id,
        status: r.status,
        sos: r.sos,
        pickup: r.pickup,
        dropoff: r.dropoff,
        rider: rider ? { name: rider.fullName, phone: rider.phone, emergencyContact: rider.emergencyContact ?? null } : null,
        driver: driver
          ? { name: driver.fullName, phone: driver.phone, vehicle: driver.vehicle ?? null, location: driver.currentLocation ?? null }
          : null,
      });
    }
    out.sort((a, b) => Number(!!a.sos?.ackAt) - Number(!!b.sos?.ackAt) || (b.sos!.at > a.sos!.at ? 1 : -1));
    return res.json(out);
  });

  app.post("/api/admin/sos/:rideId/ack", ...adminOnly, async (req, res) => {
    const ride = await storage.getRide(req.params.rideId as string);
    if (!ride || !ride.sos) return res.status(404).json({ message: "No SOS on this ride" });
    await storage.updateRide(ride.id, { sos: { ...ride.sos, ackBy: req.user!.id, ackAt: new Date().toISOString() } });
    await storage.addAudit({
      actorId: req.user!.id,
      actorName: req.user!.fullName,
      action: "acknowledge_sos",
      entity: `ride:${ride.id}`,
    });
    return res.json({ success: true });
  });

  return createServer(app);
}
