// Checks the UPI link builder and the "payment settled" rule (GPL-3.0-or-later). Run: npx tsx scripts/payments-test.ts
import { buildUpiUrl, newPayment, paymentSettled } from "../server/payments";
import { UPI_ID_RE } from "../shared/schema";
import type { Ride } from "../shared/schema";

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, extra = "") => { if (ok) { pass++; console.log("  ok  ", name); } else { fail++; console.log("  FAIL", name, extra); } };

const url = buildUpiUrl({ upiId: "sai.driver@okbank", payeeName: "Sai Kumar", amount: 37, rideId: "a1b2-c3d4-e5f6" });
const u = new URL(url);
check("it is a upi://pay link", u.protocol === "upi:" && u.hostname === "pay", url);
check("it carries the driver's UPI ID", u.searchParams.get("pa") === "sai.driver@okbank");
check("the amount has two decimals", u.searchParams.get("am") === "37.00");
check("the currency is INR", u.searchParams.get("cu") === "INR");
check("the payee name is kept", u.searchParams.get("pn") === "Sai Kumar");
check("the reference is letters and digits only, at most 35 long", /^[A-Za-z0-9]{1,35}$/.test(u.searchParams.get("tr") || ""), u.searchParams.get("tr") || "");
check("a fare with paise keeps them", new URL(buildUpiUrl({ upiId: "a.b@upi", payeeName: "X", amount: 37.5, rideId: "r1" })).searchParams.get("am") === "37.50");
check("a negative amount becomes zero", new URL(buildUpiUrl({ upiId: "a.b@upi", payeeName: "X", amount: -5, rideId: "r1" })).searchParams.get("am") === "0.00");

const rough = new URL(buildUpiUrl({ upiId: "a.b@upi", payeeName: "Ravi & Sons <script>alert(1)</script> ‘Taxi’", amount: 10, rideId: "r1" }));
check("odd characters in the name are removed, so the link cannot be broken or abused", /^[A-Za-z0-9 .]+$/.test(rough.searchParams.get("pn") || "") && !(rough.search.includes("<")) && rough.searchParams.get("pa") === "a.b@upi", rough.search);
check("an empty name gets a safe default", new URL(buildUpiUrl({ upiId: "a.b@upi", payeeName: "!!!", amount: 10, rideId: "r1" })).searchParams.get("pn") === "InstaRide Driver");
check("a very long name is cut", (new URL(buildUpiUrl({ upiId: "a.b@upi", payeeName: "A".repeat(200), amount: 10, rideId: "r1" })).searchParams.get("pn") || "").length <= 40);
check("a very long ride id still gives a short reference", (new URL(buildUpiUrl({ upiId: "a.b@upi", payeeName: "X", amount: 10, rideId: "x".repeat(200) })).searchParams.get("tr") || "").length <= 35);

for (const ok of ["name@okbank", "sai.driver@okaxis", "9876543210@ybl", "a-b_c.d@paytm"]) check(`a real-looking UPI ID is accepted: ${ok}`, UPI_ID_RE.test(ok));
for (const bad of ["nobank", "a@b", "has space@upi", "@upi", "name@", "na me@bank", "name@bank@x", "a@1bank", "<x>@upi", ""]) check(`a wrong UPI ID is refused: "${bad}"`, !UPI_ID_RE.test(bad));

const base = { id: "r", riderId: "u1", driverId: "d1", status: "completed" } as unknown as Ride;
check("a finished trip with a fare starts with a pending payment for the total", JSON.stringify(newPayment({ ...base, fare: { totalFare: 52 } } as unknown as Ride)) === JSON.stringify({ status: "pending", amount: 52 }));
check("a trip without a fare has no payment record", newPayment(base) === undefined);
check("a pending payment is not settled", paymentSettled({ ...base, payment: { status: "pending", amount: 52 } } as Ride) === false);
check("a collected payment is settled", paymentSettled({ ...base, payment: { status: "collected", amount: 52, method: "cash" } } as Ride) === true);
check("a trip from before payments existed (no record) counts as settled, so its reviews keep working", paymentSettled(base) === true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
