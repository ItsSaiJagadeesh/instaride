/*
 * InstaRide: a fork of RideFlow (GPL-3.0-or-later).
 * Paying for a finished trip. InstaRide never holds the money: the rider pays the driver directly, by cash or by UPI.
 * For UPI the app shows a QR code made from a upi:// link that already contains the driver's UPI ID and the exact fare,
 * so the rider scans it with any UPI app and does not type an amount. UPI does not tell us when a payment arrives, so the
 * driver confirms it ("collected in cash" or "collected by UPI").
 */
import type { Ride, RidePayment } from "@shared/schema";

/** Letters, digits, space and a dot only: UPI apps are fussy about the payee name. */
function cleanName(name: string): string {
  const n = name.replace(/[^A-Za-z0-9 .]/g, "").replace(/\s+/g, " ").trim().slice(0, 40);
  return n || "InstaRide Driver";
}

/** The upi://pay link the QR code carries. Amount in rupees with two decimals. */
export function buildUpiUrl(opts: { upiId: string; payeeName: string; amount: number; rideId: string }): string {
  // A short reference keeps the QR code simple (fewer squares scan better on cheap cameras). 16 characters is plenty to tell trips apart.
  const ref = ("IR" + opts.rideId.replace(/[^A-Za-z0-9]/g, "")).slice(0, 16);
  const q: Array<[string, string]> = [
    ["pa", opts.upiId],
    ["pn", cleanName(opts.payeeName)],
    ["am", Math.max(0, opts.amount).toFixed(2)],
    ["cu", "INR"],
    ["tn", "InstaRide trip"],
    ["tr", ref],
  ];
  return "upi://pay?" + q.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
}

/** The payment record a trip gets when the driver completes it. */
export function newPayment(ride: Ride): RidePayment | undefined {
  if (!ride.fare) return undefined;
  return { status: "pending", amount: ride.fare.totalFare };
}

/**
 * Reviews open once the payment is collected. Trips finished before payments existed have no payment record,
 * and count as settled so their reviews keep working.
 */
export function paymentSettled(ride: Ride): boolean {
  return !ride.payment || ride.payment.status === "collected";
}
