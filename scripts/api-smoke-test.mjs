// End-to-end API test for InstaRide (GPL-3.0-or-later). Run against a throwaway server and Redis:
//   BASE=http://localhost:5055 ADMIN_PHONE=... ADMIN_PASSWORD=... node scripts/api-smoke-test.mjs
const BASE = process.env.BASE || "http://localhost:5055";
const ADMIN_PHONE = process.env.ADMIN_PHONE;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
let pass = 0, failN = 0;

function check(name, cond, extra = "") {
  if (cond) { pass++; console.log("  ok  ", name); }
  else { failN++; console.log("  FAIL", name, extra); }
}
async function call(method, path, { token, body, raw } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: "Bearer " + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (raw) return res;
  let data = null;
  try { data = await res.json(); } catch {}
  return { status: res.status, data };
}
// 1x1 PNG
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const KINDS = ["vehicle_front","vehicle_back","vehicle_left","vehicle_right","plate","rc","licence","insurance","selfie"];
const rnd = () => String(Math.floor(Math.random() * 1e8)).padStart(8, "0");
const phone = () => "9" + rnd() + "1".slice(0, 1);
const centre = { lat: 17.1225, lng: 81.2945 };

const CODE = process.env.OTP_TEST_CODE || "123456";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Signs in (or signs up) with a one-time code, the way the app does.
async function otpSignup(role, name, vehicle, ph = phone()) {
  const rq = await call("POST", "/api/auth/otp/request", { body: { phone: ph } });
  if (rq.status !== 200) throw new Error("otp request failed " + rq.status + " " + JSON.stringify(rq.data));
  const ver = await call("POST", "/api/auth/otp/verify", { body: { phone: ph, otp: CODE, role } });
  if (ver.data && ver.data.needsSignup) {
    const su = await call("POST", "/api/auth/signup", { body: { signupToken: ver.data.signupToken, fullName: name, vehicle } });
    return { token: su.data && su.data.token, user: su.data && su.data.user, status: su.status, phone: ph, data: su.data };
  }
  return { token: ver.data && ver.data.token, user: ver.data && ver.data.user, status: ver.status, phone: ph, existing: true, data: ver.data };
}
async function registerDriver(name, vtype, plate) {
  const r = await otpSignup("driver", name, { type: vtype, number: plate });
  return { token: r.token, user: r.user, status: r.status };
}
async function approve(adminToken, driver) {
  for (const k of KINDS) {
    const r = await call("PUT", `/api/driver/documents/${k}`, { token: driver.token, body: { data: PNG } });
    if (r.status !== 200) throw new Error("upload failed " + k + " " + JSON.stringify(r.data));
  }
  const s = await call("POST", "/api/driver/submit", { token: driver.token, body: {} });
  if (s.status !== 200) throw new Error("submit failed " + JSON.stringify(s.data));
  const a = await call("POST", `/api/admin/drivers/${driver.user.id}/verify`, { token: adminToken, body: { decision: "approve", vahanChecked: true, insuranceExpiry: "2099-01-01", fitnessExpiry: "2099-01-01" } });
  if (a.status !== 200) throw new Error("approve failed " + JSON.stringify(a.data));
}

(async () => {
  console.log("Auth and validation");
  const admin = await call("POST", "/api/auth/login", { body: { phone: ADMIN_PHONE, password: ADMIN_PASSWORD } });
  check("admin can log in", admin.status === 200 && admin.data.token);
  const AT = admin.data.token;
  check("wrong password rejected", (await call("POST", "/api/auth/login", { body: { phone: ADMIN_PHONE, password: "nope" } })).status === 401);
  check("no token -> 401", (await call("GET", "/api/admin/stats")).status === 401);
  check("forged token -> 401", (await call("GET", "/api/admin/stats", { token: "abc.def" })).status === 401);

  const rp = phone();
  check("password login is for the Super Admin only", (await call("POST", "/api/auth/login", { body: { phone: rp, password: "RiderPass123" } })).status === 401);
  check("old register route is gone", [404, 405].includes((await call("POST", "/api/auth/register", { body: { phone: rp, password: "RiderPass123", fullName: "X", role: "rider" } })).status));
  check("invalid phone number rejected", (await call("POST", "/api/auth/otp/request", { body: { phone: "12345" } })).status === 400);
  check("cannot ask to sign in as admin", (await call("POST", "/api/auth/otp/verify", { body: { phone: rp, otp: CODE, role: "admin" } })).status === 400);
  check("a code that was never requested is refused", (await call("POST", "/api/auth/otp/verify", { body: { phone: phone(), otp: "123456", role: "rider" } })).status === 400);
  check("code must be 6 digits", (await call("POST", "/api/auth/otp/verify", { body: { phone: rp, otp: "12", role: "rider" } })).status === 400);

  console.log("One-time codes");
  const rq1 = await call("POST", "/api/auth/otp/request", { body: { phone: rp } });
  check("a code can be requested", rq1.status === 200 && rq1.data.sent === true && rq1.data.resendAfterSeconds > 0);
  const rq2 = await call("POST", "/api/auth/otp/request", { body: { phone: rp } });
  check("asking again straight away is refused (cooldown)", rq2.status === 429 && /wait/.test(rq2.data.message), JSON.stringify(rq2.data));
  const wrong1 = await call("POST", "/api/auth/otp/verify", { body: { phone: rp, otp: CODE === "000000" ? "111111" : "000000", role: "rider" } });
  check("wrong code rejected and tries counted", wrong1.status === 400 && /4 tries left/.test(wrong1.data.message), JSON.stringify(wrong1.data));
  const ver1 = await call("POST", "/api/auth/otp/verify", { body: { phone: rp, otp: CODE, role: "rider" } });
  check("right code on a new number asks for sign-up details", ver1.status === 200 && ver1.data.needsSignup === true && !!ver1.data.signupToken);
  check("a code can be used only once", (await call("POST", "/api/auth/otp/verify", { body: { phone: rp, otp: CODE, role: "rider" } })).status === 400);
  check("a forged sign-up token is refused", (await call("POST", "/api/auth/signup", { body: { signupToken: "x".repeat(60) + "." + "y".repeat(40), fullName: "Eve" } })).status === 400);
  const adminTokenAsSignup = await call("POST", "/api/auth/signup", { body: { signupToken: admin.data.token, fullName: "Eve" } });
  check("a login token cannot be used as a sign-up token", adminTokenAsSignup.status === 400);
  const rider = await call("POST", "/api/auth/signup", { body: { signupToken: ver1.data.signupToken, fullName: "Test Rider" } });
  check("rider signs up with name only", rider.status === 200 && rider.data.token && rider.data.user.role === "rider" && rider.data.user.phone === rp);
  check("no password or hash anywhere in the response", !JSON.stringify(rider.data).toLowerCase().includes("password"));
  check("the sign-up token cannot create a second account", (await call("POST", "/api/auth/signup", { body: { signupToken: ver1.data.signupToken, fullName: "Dup" } })).status === 409);
  await sleep(2200);
  const again = await otpSignup("rider", "ignored", undefined, rp);
  check("signing in again with a new code returns the same account", again.existing && again.user.id === rider.data.user.id);

  // same phone number, driver role: a separate account
  await sleep(2200);
  const asDriver = await otpSignup("driver", "Same Person Driver", { type: "bike", number: "AP37XY0001" }, rp);
  check("the same number can also have a driver account", asDriver.status === 200 && asDriver.user.role === "driver" && asDriver.user.id !== rider.data.user.id);
  check("driver and rider accounts stay separate", asDriver.user.verification.status === "not_submitted" && rider.data.user.verification === undefined);

  // attempt lock
  const lockPhone = phone();
  await call("POST", "/api/auth/otp/request", { body: { phone: lockPhone } });
  let last;
  for (let i = 0; i < 5; i++) last = await call("POST", "/api/auth/otp/verify", { body: { phone: lockPhone, otp: CODE === "000000" ? "111111" : "000000", role: "rider" } });
  const afterLock = await call("POST", "/api/auth/otp/verify", { body: { phone: lockPhone, otp: CODE, role: "rider" } });
  check("5 wrong tries lock the code, even the right one then fails", /Ask for a new/.test(last.data.message) && afterLock.status >= 400, JSON.stringify(afterLock.data));

  // expiry
  const expPhone = phone();
  await call("POST", "/api/auth/otp/request", { body: { phone: expPhone } });
  await sleep(Number(process.env.OTP_TTL_SECONDS || 4) * 1000 + 1200);
  const expired = await call("POST", "/api/auth/otp/verify", { body: { phone: expPhone, otp: CODE, role: "rider" } });
  check("a code expires", expired.status === 400 && /expired/.test(expired.data.message), JSON.stringify(expired.data));

  // per-hour cap on one number
  const capPhone = phone();
  const caps = [];
  for (let i = 0; i < 6; i++) {
    caps.push((await call("POST", "/api/auth/otp/request", { body: { phone: capPhone } })).status);
    await sleep(2100);
  }
  check("one number cannot request unlimited codes in an hour", caps.slice(0, 4).every((c) => c === 200) && caps[5] === 429, JSON.stringify(caps));
  const RT = rider.data.token, RID = rider.data.user.id;

  const pub = await call("GET", "/api/config/public");
  check("public config works without login and shows no secrets", pub.status === 200 && pub.data.platformFeePerRide === 5 && !("rates" in pub.data) && !("serviceArea" in pub.data), JSON.stringify(pub.data));

  console.log("Permissions");
  check("rider cannot read admin stats", (await call("GET", "/api/admin/stats", { token: RT })).status === 403);
  check("rider cannot change config", (await call("PUT", "/api/admin/config", { token: RT, body: { platformFeePerRide: 0 } })).status === 403);
  check("rider cannot go online as driver", (await call("PUT", `/api/user/${RID}/online`, { token: RT, body: { isOnline: true } })).status === 403);

  console.log("Driver verification");
  const d1 = await registerDriver("Driver One", "bike", "AP37AB1234");
  check("driver registers", d1.status === 200 && d1.user.verification.status === "not_submitted");
  const nv = phone();
  await call("POST", "/api/auth/otp/request", { body: { phone: nv } });
  const nvv = await call("POST", "/api/auth/otp/verify", { body: { phone: nv, otp: CODE, role: "driver" } });
  const bad4 = await call("POST", "/api/auth/signup", { body: { signupToken: nvv.data.signupToken, fullName: "No Vehicle" } });
  check("driver without vehicle rejected", bad4.status === 400);
  const on0 = await call("PUT", `/api/user/${d1.user.id}/online`, { token: d1.token, body: { isOnline: true } });
  check("unapproved driver cannot go online", on0.status === 403, JSON.stringify(on0.data));
  const txt = await call("PUT", "/api/driver/documents/plate", { token: d1.token, body: { data: Buffer.from("not an image").toString("base64") } });
  check("non-image upload rejected", txt.status === 400);
  const early = await call("POST", "/api/driver/submit", { token: d1.token, body: {} });
  check("submit before all documents rejected", early.status === 400);
  const badKind = await call("PUT", "/api/driver/documents/../../etc", { token: d1.token, body: { data: PNG } });
  check("bad document kind rejected", badKind.status === 400 || badKind.status === 404);
  for (const k of KINDS) await call("PUT", `/api/driver/documents/${k}`, { token: d1.token, body: { data: PNG } });
  const sub = await call("POST", "/api/driver/submit", { token: d1.token, body: {} });
  check("submit with all documents -> pending", sub.status === 200 && sub.data.verification.status === "pending");
  check("API shows uploaded kinds but not file names", sub.data.verification.uploaded.length === 9 && !JSON.stringify(sub.data).includes(".png"));
  const pend = await call("GET", "/api/admin/verifications?status=pending", { token: AT });
  check("admin sees driver in pending queue", pend.data.some((u) => u.id === d1.user.id));
  const docRes = await call("GET", `/api/admin/documents/${d1.user.id}/plate`, { token: AT, raw: true });
  check("admin can view a document", docRes.status === 200 && (docRes.headers.get("content-type") || "").includes("image/png"));
  const docDriver = await call("GET", `/api/admin/documents/${d1.user.id}/plate`, { token: d1.token });
  check("driver cannot use admin document route", docDriver.status === 403);
  const noVahan = await call("POST", `/api/admin/drivers/${d1.user.id}/verify`, { token: AT, body: { decision: "approve", insuranceExpiry: "2099-01-01", fitnessExpiry: "2099-01-01" } });
  check("approve without VAHAN confirmation rejected", noVahan.status === 400);
  const fix = await call("POST", `/api/admin/drivers/${d1.user.id}/verify`, { token: AT, body: { decision: "needs_fix", kinds: ["plate"], reason: "White plate" } });
  check("admin can ask for a re-upload", fix.status === 200 && fix.data.verification.status === "needs_fix");
  const blockedKind = await call("PUT", "/api/driver/documents/rc", { token: d1.token, body: { data: PNG } });
  check("driver can only re-upload the asked item", blockedKind.status === 400);
  const reup = await call("PUT", "/api/driver/documents/plate", { token: d1.token, body: { data: PNG } });
  check("driver re-uploads asked item", reup.status === 200);
  const resub = await call("POST", "/api/driver/submit", { token: d1.token, body: {} });
  check("driver resubmits", resub.status === 200 && resub.data.verification.status === "pending");
  const ok1 = await call("POST", `/api/admin/drivers/${d1.user.id}/verify`, { token: AT, body: { decision: "approve", vahanChecked: true, insuranceExpiry: "2099-01-01", fitnessExpiry: "2099-01-01" } });
  check("admin approves", ok1.status === 200 && ok1.data.verification.status === "approved");
  const on1 = await call("PUT", `/api/user/${d1.user.id}/online`, { token: d1.token, body: { isOnline: true } });
  check("approved driver can go online", on1.status === 200 && on1.data.isOnline === true);

  console.log("Rides");
  await call("PUT", `/api/user/${d1.user.id}/location`, { token: d1.token, body: { lat: centre.lat + 0.002, lng: centre.lng } });
  const pickup = { ...centre, address: "Bus stand" };
  const drop = { lat: centre.lat + 0.03, lng: centre.lng + 0.01, address: "Market" };
  const far = await call("POST", "/api/rides", { token: RT, body: { vehicleType: "bike", pickup: { lat: 17.38, lng: 78.48, address: "Hyderabad" }, dropoff: drop } });
  check("ride outside service area rejected", far.status === 400, JSON.stringify(far.data));
  const disabled = await call("POST", "/api/rides", { token: RT, body: { vehicleType: "car", pickup, dropoff: drop } });
  check("disabled vehicle type rejected", disabled.status === 400);
  const est = await call("GET", `/api/fare/estimate?pLat=${pickup.lat}&pLng=${pickup.lng}&dLat=${drop.lat}&dLng=${drop.lng}&vehicleType=bike`, { token: RT });
  check("fare estimate in whole rupees", est.status === 200 && Number.isInteger(est.data.totalFare), JSON.stringify(est.data));
  const tooClose = await call("GET", `/api/fare/estimate?pLat=${pickup.lat}&pLng=${pickup.lng}&dLat=${pickup.lat + 0.0003}&dLng=${pickup.lng}`, { token: RT });
  check("fare estimate refuses a trip that is too short", tooClose.status === 400 && /too close/.test(tooClose.data.message), JSON.stringify(tooClose.data));
  const farEst = await call("GET", `/api/fare/estimate?pLat=17.38&pLng=78.48&dLat=17.39&dLng=78.49`, { token: RT });
  check("fare estimate refuses places outside the service area", farEst.status === 400 && /only serve/.test(farEst.data.message));
  const ride = await call("POST", "/api/rides", { token: RT, body: { vehicleType: "bike", pickup, dropoff: drop } });
  check("rider books a ride", ride.status === 200 && ride.data.status === "requested");
  check("platform fee is flat 5 and driver gets the rest", ride.data.fare.platformFee === 5 && ride.data.fare.driverEarnings === ride.data.fare.totalFare - 5, JSON.stringify(ride.data.fare));
  const second = await call("POST", "/api/rides", { token: RT, body: { vehicleType: "bike", pickup, dropoff: drop } });
  check("second active ride rejected", second.status === 409);
  const avail = await call("GET", "/api/rides/available", { token: d1.token });
  check("driver sees the ride", avail.status === 200 && avail.data.some((r) => r.id === ride.data.id));
  check("start OTP not exposed to driver in list", avail.data.every((r) => !r.startOtp));

  // race: two approved bike drivers accept at once
  const d2 = await registerDriver("Driver Two", "bike", "AP37CD5678");
  await approve(AT, d2);
  await call("PUT", `/api/user/${d2.user.id}/online`, { token: d2.token, body: { isOnline: true } });
  await call("PUT", `/api/user/${d2.user.id}/location`, { token: d2.token, body: { lat: centre.lat, lng: centre.lng + 0.002 } });
  const [a, b] = await Promise.all([
    call("PUT", `/api/rides/${ride.data.id}/accept`, { token: d1.token }),
    call("PUT", `/api/rides/${ride.data.id}/accept`, { token: d2.token }),
  ]);
  const winners = [a, b].filter((x) => x.status === 200);
  check("exactly one driver wins a simultaneous accept", winners.length === 1, `${a.status}/${b.status}`);
  const winner = a.status === 200 ? d1 : d2;
  check("driver response hides start OTP", winners[0].data.startOtp === undefined);
  const riderView = await call("GET", `/api/rides/${ride.data.id}`, { token: RT });
  check("rider sees start OTP and driver vehicle", /^\d{4}$/.test(riderView.data.startOtp) && riderView.data.driverVehicle?.number);
  const meRider = await call("GET", "/api/me", { token: RT });
  check("the start code is the last 4 digits of the rider's mobile number", riderView.data.startOtp === String(meRider.data.phone).slice(-4), `${riderView.data.startOtp} vs ${meRider.data.phone}`);

  console.log("Rider contact for the assigned driver");
  const loser = winner === d1 ? d2 : d1;
  const contactUrl = `/api/rides/${ride.data.id}/rider-contact`;
  const c1 = await call("GET", contactUrl, { token: winner.token });
  check("the driver who accepted sees the rider's name, number and pickup", c1.status === 200 && c1.data.name === meRider.data.fullName && c1.data.phone === meRider.data.phone && !!c1.data.pickupAddress, JSON.stringify(c1.data));
  check("the greeting is plain Namaste when the rider has not set a gender", c1.data.greeting === "Namaste", JSON.stringify(c1.data));
  check("the driver never receives the gender itself", !("gender" in c1.data));
  for (const [g, want] of [["female", "Namaste Madam"], ["male", "Namaste Sir"], ["other", "Namaste"]]) {
    const set = await call("PUT", "/api/me", { token: RT, body: { fullName: meRider.data.fullName, gender: g } });
    const r = await call("GET", contactUrl, { token: winner.token });
    check(`rider gender "${g}" gives the greeting "${want}"`, set.status === 200 && set.data.gender === g && r.data.greeting === want, JSON.stringify([set.data, r.data]));
  }
  const cleared = await call("PUT", "/api/me", { token: RT, body: { fullName: meRider.data.fullName, gender: null } });
  check("clearing the gender goes back to plain Namaste", cleared.status === 200 && cleared.data.gender === undefined && (await call("GET", contactUrl, { token: winner.token })).data.greeting === "Namaste", JSON.stringify(cleared.data));
  check("an invalid gender is refused", (await call("PUT", "/api/me", { token: RT, body: { fullName: meRider.data.fullName, gender: "robot" } })).status === 400);
  check("the other driver cannot read the rider's number", (await call("GET", contactUrl, { token: loser.token })).status === 403);
  check("the rider cannot use this route", (await call("GET", contactUrl, { token: RT })).status === 403);
  check("the admin cannot use this route", (await call("GET", contactUrl, { token: AT })).status === 403);
  check("a signed-out visitor cannot", (await call("GET", contactUrl)).status === 401);
  check("a ride that does not exist gives nothing", (await call("GET", "/api/rides/nope/rider-contact", { token: winner.token })).status === 403);
  const stored = await fetch(BASE + contactUrl, { headers: { Authorization: "Bearer " + winner.token } });
  check("the answer is marked do-not-store", (stored.headers.get("cache-control") || "").includes("no-store"));
  const elsewhere = JSON.stringify([(await call("GET", "/api/rides/available", { token: loser.token })).data, (await call("GET", `/api/rides/${ride.data.id}`, { token: winner.token })).data]);
  check("the rider's number is not in the ride record or in the request list", !elsewhere.includes(meRider.data.phone));
  const other = await otpSignup("rider", "Other Rider");
  check("another rider cannot read this ride", (await call("GET", `/api/rides/${ride.data.id}`, { token: other.token })).status === 404);
  check("another rider cannot read my ride list", (await call("GET", `/api/rides/rider/${RID}`, { token: other.token })).status === 403);
  check("rider cannot drive the ride forward", (await call("PUT", `/api/rides/${ride.data.id}/status`, { token: RT, body: { status: "arrived" } })).status === 403);
  const skip = await call("PUT", `/api/rides/${ride.data.id}/status`, { token: winner.token, body: { status: "completed" } });
  check("cannot skip steps", skip.status === 400);
  await call("PUT", `/api/rides/${ride.data.id}/status`, { token: winner.token, body: { status: "arrived" } });
  const wrongOtp = await call("PUT", `/api/rides/${ride.data.id}/status`, { token: winner.token, body: { status: "in_progress", otp: "0000" === riderView.data.startOtp ? "1111" : "0000" } });
  check("wrong start code rejected", wrongOtp.status === 400);
  check("the driver can still reach the rider while the pickup is under way", (await call("GET", contactUrl, { token: winner.token })).status === 200);
  const start = await call("PUT", `/api/rides/${ride.data.id}/status`, { token: winner.token, body: { status: "in_progress", otp: riderView.data.startOtp } });
  check("correct start code starts the trip", start.status === 200 && start.data.status === "in_progress");
  const lateCancel = await call("PUT", `/api/rides/${ride.data.id}/status`, { token: RT, body: { status: "cancelled" } });
  check("cannot cancel after the trip starts", lateCancel.status === 400);
  const done = await call("PUT", `/api/rides/${ride.data.id}/status`, { token: winner.token, body: { status: "completed" } });
  check("trip completes", done.status === 200 && done.data.status === "completed");
  check("once the trip is finished the driver can no longer read the rider's number", (await call("GET", contactUrl, { token: winner.token })).status === 403);
  const me = await call("GET", "/api/me", { token: winner.token });
  check("driver fee ledger is Rs 5 and earnings are fare - 5", me.data.feesDue === 5 && me.data.totalEarnings === ride.data.fare.totalFare - 5, JSON.stringify(me.data));
  console.log("Payment for the finished trip");
  const FARE = ride.data.fare.totalFare;
  const PAY = `/api/rides/${ride.data.id}/payment`;
  check("the finished trip has a pending payment for exactly the fare", done.data.payment?.status === "pending" && done.data.payment?.amount === FARE, JSON.stringify(done.data.payment));
  const reviewTooEarly = await call("PUT", `/api/rides/${ride.data.id}/review`, { token: RT, body: { rating: 5 } });
  check("the rider cannot review before the payment is collected", reviewTooEarly.status === 400 && /payment/i.test(reviewTooEarly.data?.message || ""), JSON.stringify(reviewTooEarly));
  check("the driver cannot review the rider before the payment is collected", (await call("PUT", `/api/rides/${ride.data.id}/rider-review`, { token: winner.token, body: { rating: 5 } })).status === 400);
  check("a UPI ID with spaces, or without a bank, is refused", (await call("PUT", "/api/me", { token: winner.token, body: { fullName: me.data.fullName, upiId: "not a upi id" } })).status === 400 && (await call("PUT", "/api/me", { token: winner.token, body: { fullName: me.data.fullName, upiId: "nobank" } })).status === 400);
  check("a rider cannot set a UPI ID", (await call("PUT", "/api/me", { token: RT, body: { fullName: meRider.data.fullName, upiId: "rider@upi" } })).status === 400);
  const payNoUpi = await call("GET", PAY, { token: winner.token });
  check("without a UPI ID there is an amount but no QR link", payNoUpi.status === 200 && payNoUpi.data.amount === FARE && payNoUpi.data.hasUpiId === false && payNoUpi.data.upiUrl === undefined, JSON.stringify(payNoUpi.data));
  const setUpi = await call("PUT", "/api/me", { token: winner.token, body: { fullName: me.data.fullName, upiId: "sai.driver@okbank" } });
  check("the driver saves a UPI ID", setUpi.status === 200 && setUpi.data.upiId === "sai.driver@okbank", JSON.stringify(setUpi.data));
  const payR = await call("GET", PAY, { token: RT });
  const payD = await call("GET", PAY, { token: winner.token });
  const upi = new URL(payR.data.upiUrl || "x:");
  check("the rider gets a UPI link with the driver's ID and the exact fare filled in", upi.protocol === "upi:" && upi.searchParams.get("pa") === "sai.driver@okbank" && upi.searchParams.get("am") === FARE.toFixed(2) && upi.searchParams.get("cu") === "INR" && /^[A-Za-z0-9]{1,35}$/.test(upi.searchParams.get("tr") || ""), payR.data.upiUrl);
  check("the driver gets the very same link for the QR code", payD.data.upiUrl === payR.data.upiUrl && payD.data.hasUpiId === true);
  console.log("Tips");
  const TIP = `/api/rides/${ride.data.id}/payment/tip`;
  for (const bad of [-1, 501, 12.5, "20", null, undefined]) {
    check(`a tip of ${JSON.stringify(bad)} is refused (whole rupees, 0 to 500)`, (await call("PUT", TIP, { token: RT, body: { amount: bad } })).status === 400);
  }
  check("a driver cannot add a tip", (await call("PUT", TIP, { token: winner.token, body: { amount: 20 } })).status === 403);
  check("another rider cannot tip on this trip", (await call("PUT", TIP, { token: other.token, body: { amount: 20 } })).status === 404);
  check("a signed-out visitor cannot tip", (await call("PUT", TIP, { body: { amount: 20 } })).status === 401);
  const tipped = await call("PUT", TIP, { token: RT, body: { amount: 20 } });
  check("the rider adds a Rs 20 tip: the fare stays, the total grows", tipped.status === 200 && tipped.data.amount === FARE && tipped.data.tip === 20 && tipped.data.total === FARE + 20, JSON.stringify(tipped.data));
  const tippedD = await call("GET", PAY, { token: winner.token });
  check("the driver's QR link now asks for fare + tip", new URL(tippedD.data.upiUrl).searchParams.get("am") === (FARE + 20).toFixed(2) && tippedD.data.tip === 20 && tippedD.data.total === FARE + 20, JSON.stringify(tippedD.data));
  check("the rider's own link asks for the same total", new URL((await call("GET", PAY, { token: RT })).data.upiUrl).searchParams.get("am") === (FARE + 20).toFixed(2));
  check("the tip can be changed", (await call("PUT", TIP, { token: RT, body: { amount: 50 } })).data.total === FARE + 50);
  const noTip = await call("PUT", TIP, { token: RT, body: { amount: 0 } });
  check("and removed with 0, which puts the link back to the plain fare", noTip.data.tip === 0 && noTip.data.total === FARE && new URL(noTip.data.upiUrl).searchParams.get("am") === FARE.toFixed(2), JSON.stringify(noTip.data));
  await call("PUT", TIP, { token: RT, body: { amount: 20 } }); // leave a Rs 20 tip in place for the payment steps below
  check("the payment answer is marked do-not-store", ((await fetch(BASE + PAY, { headers: { Authorization: "Bearer " + RT } })).headers.get("cache-control") || "").includes("no-store"));
  check("another rider cannot see the payment", (await call("GET", PAY, { token: other.token })).status === 404);
  check("another driver cannot see the payment", (await call("GET", PAY, { token: loser.token })).status === 404);
  check("a signed-out visitor cannot see it", (await call("GET", PAY)).status === 401);
  const leak = JSON.stringify([(await call("GET", `/api/rides/${ride.data.id}`, { token: RT })).data, (await call("GET", `/api/drivers/nearby?lat=${pickup.lat}&lng=${pickup.lng}`, { token: RT })).data, (await call("GET", "/api/rides/available", { token: loser.token })).data]);
  check("the driver's UPI ID is not in the ride record, the nearby list or the request list", !leak.includes("sai.driver"));
  check("a driver cannot claim payment as a rider", (await call("PUT", PAY + "/claim", { token: winner.token })).status === 403);
  const claim = await call("PUT", PAY + "/claim", { token: RT });
  check("the rider can tell the driver they have paid", claim.status === 200 && !!claim.data.riderClaimedAt, JSON.stringify(claim.data));
  check("the driver sees that the rider says they paid", !!(await call("GET", PAY, { token: winner.token })).data.riderClaimedAt);
  check("after the rider says they paid, the tip can no longer change", (await call("PUT", TIP, { token: RT, body: { amount: 100 } })).status === 400);
  check("a rider cannot mark the money as collected", (await call("PUT", PAY + "/collect", { token: RT, body: { method: "cash" } })).status === 403);
  check("another driver cannot mark it collected", (await call("PUT", PAY + "/collect", { token: loser.token, body: { method: "cash" } })).status === 404);
  check("collecting needs cash or UPI", (await call("PUT", PAY + "/collect", { token: winner.token, body: { method: "card" } })).status === 400);
  const earnBefore = (await call("GET", "/api/me", { token: winner.token })).data;
  const collected = await call("PUT", PAY + "/collect", { token: winner.token, body: { method: "upi" } });
  check("the driver confirms the payment was collected by UPI", collected.status === 200 && collected.data.status === "collected" && collected.data.method === "upi" && !!collected.data.collectedAt && collected.data.upiUrl === undefined, JSON.stringify(collected.data));
  check("it cannot be collected twice", (await call("PUT", PAY + "/collect", { token: winner.token, body: { method: "cash" } })).status === 400);
  const earnAfter = (await call("GET", "/api/me", { token: winner.token })).data;
  check("the Rs 20 tip joined the driver's earnings, with no platform fee on it", earnAfter.totalEarnings === (earnBefore.totalEarnings || 0) + 20 && earnAfter.totalTips === (earnBefore.totalTips || 0) + 20 && earnAfter.feesDue === earnBefore.feesDue, JSON.stringify([earnBefore.totalEarnings, earnAfter.totalEarnings, earnAfter.totalTips]));
  check("once collected, the tip can no longer change", (await call("PUT", TIP, { token: RT, body: { amount: 100 } })).status === 400);
  check("the collected payment keeps the tip on record", (await call("GET", `/api/rides/${ride.data.id}`, { token: RT })).data.payment?.tip === 20);
  check("once collected, the rider can no longer say 'I paid'", (await call("PUT", PAY + "/claim", { token: RT })).status === 400);
  const paidPage = await call("GET", PAY, { token: RT });
  check("once collected, the page shows it as paid and the QR link is gone", paidPage.data.status === "collected" && paidPage.data.method === "upi" && paidPage.data.upiUrl === undefined);
  check("the trip record now says collected", (await call("GET", `/api/rides/${ride.data.id}`, { token: RT })).data.payment?.status === "collected");
  console.log("Peer review: tags and a written review the driver can read");
  const REVIEW_URL = `/api/rides/${ride.data.id}/review`;
  check("a tag that is not on the list is refused", (await call("PUT", REVIEW_URL, { token: RT, body: { rating: 5, tags: ["Polite", "Rude"] } })).status === 400);
  check("tags must be sent as a list", (await call("PUT", REVIEW_URL, { token: RT, body: { rating: 5, tags: "Polite" } })).status === 400);
  const rev = await call("PUT", REVIEW_URL, { token: RT, body: { rating: 5, comment: "PRIVATE-NOTE-FOR-ADMIN", tags: ["Polite", "On time", "Polite"], peerReview: "  Very   polite and on time. " } });
  check("rider reviews the driver", rev.status === 200);
  check("tags are kept once each and the written review is tidied", JSON.stringify(rev.data.review?.tags) === JSON.stringify(["Polite", "On time"]) && rev.data.review?.peerReview === "Very polite and on time.", JSON.stringify(rev.data.review));
  check("the rider's own copy does not carry the private note to admins", rev.data.review?.comment === undefined);
  check("a second review of the same ride is refused", (await call("PUT", REVIEW_URL, { token: RT, body: { rating: 1 } })).status === 400);
  check("driver cannot see review comment", (await call("GET", `/api/rides/driver/${winner.user.id}`, { token: winner.token })).data.every((r) => !r.review || r.review.comment === undefined));
  const dr = await call("GET", "/api/driver/reviews", { token: winner.token });
  check("the driver can read the written review and the tags", dr.status === 200 && dr.data.count >= 1 && dr.data.items[0].text === "Very polite and on time." && dr.data.items[0].tags.includes("Polite") && dr.data.tagCounts["Polite"] >= 1, JSON.stringify(dr.data));
  const drText = JSON.stringify(dr.data);
  check("the driver's list has no rider name, number, ride id or private note", !drText.includes(meRider.data.phone) && !drText.includes(meRider.data.fullName) && !drText.includes(ride.data.id) && !drText.includes("PRIVATE-NOTE") && !drText.includes('"comment"'), drText);
  check("the driver's list shows only the month, not the day or the time", /^\d{4}-\d{2}$/.test(dr.data.items[0].month) && dr.data.items[0].createdAt === undefined && dr.data.items[0].date === undefined);
  const noReviews = await call("GET", "/api/driver/reviews", { token: loser.token });
  check("another driver sees none of it", noReviews.status === 200 && noReviews.data.count === 0 && noReviews.data.items.length === 0 && noReviews.data.average === null, JSON.stringify(noReviews.data));
  check("a rider cannot open the drivers' review list", (await call("GET", "/api/driver/reviews", { token: RT })).status === 403);
  check("a signed-out visitor cannot either", (await call("GET", "/api/driver/reviews")).status === 401);
  const dv = (await call("GET", `/api/rides/${ride.data.id}`, { token: winner.token })).data;
  check("the driver's copy of the trip does not carry the rider's review of them (that stays anonymous)", dv.review === undefined, JSON.stringify(dv.review));
  const adminCopy = (await call("GET", "/api/admin/rides", { token: AT })).data.find((r) => r.id === ride.data.id);
  check("the admin sees everything, including the private note", adminCopy?.review?.comment === "PRIVATE-NOTE-FOR-ADMIN" && adminCopy?.review?.peerReview === "Very polite and on time.", JSON.stringify(adminCopy?.review));
  const HIDE_URL = `/api/admin/rides/${ride.data.id}/review/hide`;
  check("a rider cannot hide a review", (await call("PUT", HIDE_URL, { token: RT, body: {} })).status === 403);
  check("a driver cannot hide a review", (await call("PUT", HIDE_URL, { token: winner.token, body: {} })).status === 403);
  check("an admin can hide the written review from the driver", (await call("PUT", HIDE_URL, { token: AT, body: { hidden: true } })).status === 200);
  const dr2 = await call("GET", "/api/driver/reviews", { token: winner.token });
  check("hidden: the text is gone for the driver, but the stars and tags still count", dr2.data.items[0].text === undefined && dr2.data.items[0].rating === 5 && dr2.data.items[0].tags.includes("Polite") && dr2.data.count === dr.data.count && dr2.data.average === dr.data.average, JSON.stringify(dr2.data));


  check("hidden: the rider still sees what they wrote", (await call("GET", `/api/rides/${ride.data.id}`, { token: RT })).data.review?.peerReview === "Very polite and on time.");
  await call("PUT", HIDE_URL, { token: AT, body: { hidden: false } });
  check("the admin can show it again", (await call("GET", "/api/driver/reviews", { token: winner.token })).data.items[0].text === "Very polite and on time.");

  console.log("The driver's review of the rider, and who sees what");
  const RR = `/api/rides/${ride.data.id}/rider-review`;
  check("the driver's review needs real tags", (await call("PUT", RR, { token: winner.token, body: { rating: 4, tags: ["Rude"] } })).status === 400);
  check("only the trip's own driver can review the rider", (await call("PUT", RR, { token: loser.token, body: { rating: 5 } })).status === 404);
  check("a rider cannot use the driver's review route", (await call("PUT", RR, { token: RT, body: { rating: 5 } })).status === 403);
  const rr = await call("PUT", RR, { token: winner.token, body: { rating: 4, comment: "DRIVER-PRIVATE-NOTE", tags: ["Polite", "Easy payment", "Polite"], peerReview: "  Ready   on time, paid quickly. " } });
  check("the driver reviews the rider", rr.status === 200 && JSON.stringify(rr.data.riderReview?.tags) === JSON.stringify(["Polite", "Easy payment"]) && rr.data.riderReview?.peerReview === "Ready on time, paid quickly." && rr.data.riderReview?.comment === undefined, JSON.stringify(rr.data.riderReview));
  check("a trip's rider can only be reviewed once", (await call("PUT", RR, { token: winner.token, body: { rating: 1 } })).status === 400);
  const rl = await call("GET", "/api/rider/reviews", { token: RT });
  check("the rider can read what drivers said, anonymously", rl.status === 200 && rl.data.count === 1 && rl.data.average === 4 && rl.data.items[0].text === "Ready on time, paid quickly." && rl.data.items[0].tags.includes("Easy payment") && /^\d{4}-\d{2}$/.test(rl.data.items[0].month), JSON.stringify(rl.data));
  const rlText = JSON.stringify(rl.data);
  check("that list has no driver name, ride id or private note", !rlText.includes(winner.user.fullName) && !rlText.includes(ride.data.id) && !rlText.includes("DRIVER-PRIVATE-NOTE") && !rlText.includes('"comment"'), rlText);
  check("a driver cannot open the riders' review list", (await call("GET", "/api/rider/reviews", { token: winner.token })).status === 403);
  check("a signed-out visitor cannot either", (await call("GET", "/api/rider/reviews")).status === 401);
  check("another rider sees none of it", (await call("GET", "/api/rider/reviews", { token: other.token })).data.count === 0);
  const forRider = (await call("GET", `/api/rides/${ride.data.id}`, { token: RT })).data;
  const forDriver = (await call("GET", `/api/rides/${ride.data.id}`, { token: winner.token })).data;
  check("the rider's copy of the trip has their own review, but not the driver's review of them", forRider.review?.peerReview === "Very polite and on time." && forRider.riderReview === undefined, JSON.stringify([forRider.review, forRider.riderReview]));
  check("the driver's copy of the trip has their own review of the rider, but not the rider's review of them", forDriver.riderReview?.peerReview === "Ready on time, paid quickly." && forDriver.review === undefined, JSON.stringify([forDriver.review, forDriver.riderReview]));
  check("the author's own copy never carries the private note", forRider.review?.comment === undefined && forDriver.riderReview?.comment === undefined);
  const riderList = (await call("GET", `/api/rides/rider/${RID}`, { token: RT })).data;
  const driverList = (await call("GET", `/api/rides/driver/${winner.user.id}`, { token: winner.token })).data;
  check("trip lists follow the same rule", riderList.every((r) => r.riderReview === undefined) && driverList.every((r) => r.review === undefined));
  const adminCopy2 = (await call("GET", "/api/admin/rides", { token: AT })).data.find((r) => r.id === ride.data.id);
  check("the admin sees both reviews and both private notes", adminCopy2?.review?.comment === "PRIVATE-NOTE-FOR-ADMIN" && adminCopy2?.riderReview?.comment === "DRIVER-PRIVATE-NOTE", JSON.stringify([adminCopy2?.review, adminCopy2?.riderReview]));
  check("an admin can hide the driver's written review from the rider", (await call("PUT", HIDE_URL, { token: AT, body: { hidden: true, which: "rider" } })).status === 200);
  const rl2 = await call("GET", "/api/rider/reviews", { token: RT });
  check("hidden: the rider no longer sees that text, but the stars and tags still count", rl2.data.items[0].text === undefined && rl2.data.items[0].rating === 4 && rl2.data.items[0].tags.includes("Polite") && rl2.data.average === 4, JSON.stringify(rl2.data));
  check("hiding the driver's review of the rider leaves the rider's review of the driver alone", (await call("GET", "/api/driver/reviews", { token: winner.token })).data.items[0].text === "Very polite and on time.");
  await call("PUT", HIDE_URL, { token: AT, body: { hidden: false, which: "rider" } });
  check("the admin can show it again", (await call("GET", "/api/rider/reviews", { token: RT })).data.items[0].text === "Ready on time, paid quickly.");

  console.log("Profile: email, payout details, and changing the mobile number");
  const emailOk = await call("PUT", "/api/me", { token: RT, body: { fullName: meRider.data.fullName, email: "  Rider@Example.COM " } });
  check("a rider saves an email (tidied to lower case)", emailOk.status === 200 && emailOk.data.email === "rider@example.com", JSON.stringify(emailOk.data));
  check("a wrong email is refused", (await call("PUT", "/api/me", { token: RT, body: { fullName: meRider.data.fullName, email: "not-an-email" } })).status === 400);
  check("the email can be cleared", (await call("PUT", "/api/me", { token: RT, body: { fullName: meRider.data.fullName, email: null } })).data.email === undefined);
  check("another rider cannot read someone else's profile", (await call("GET", `/api/user/${RID}`, { token: other.token })).status === 403);

  for (const bad of [{ holder: "A", account: "123456789", ifsc: "SBIN0001234" }, { holder: "Sai Kumar", account: "12345", ifsc: "SBIN0001234" }, { holder: "Sai Kumar", account: "123456789012", ifsc: "SBIN1001234" }, { holder: "Sai Kumar", account: "12345678901x", ifsc: "SBIN0001234" }]) {
    check(`bad bank details are refused: ${JSON.stringify(bad)}`, (await call("PUT", "/api/me/bank", { token: winner.token, body: bad })).status === 400);
  }
  check("a rider cannot save bank details", (await call("PUT", "/api/me/bank", { token: RT, body: { holder: "Sai Kumar", account: "123456789012", ifsc: "SBIN0001234" } })).status === 403);
  const bank = await call("PUT", "/api/me/bank", { token: winner.token, body: { holder: "Sai Kumar", account: "123456789012", ifsc: "sbin0001234" } });
  check("a driver saves bank details, and the IFSC is tidied to capitals", bank.status === 200 && bank.data.bank?.ifsc === "SBIN0001234" && bank.data.bank?.last4 === "9012", JSON.stringify(bank.data.bank));
  check("the full account number and the encrypted copy are never sent back", !JSON.stringify(bank.data).includes("123456789012") && !JSON.stringify(bank.data).includes("accountEnc"));
  const meBank = await call("GET", "/api/me", { token: winner.token });
  check("the driver's profile shows only the last 4 digits", meBank.data.bank?.last4 === "9012" && meBank.data.bank?.accountEnc === undefined && !JSON.stringify(meBank.data).includes("123456789012"));
  const adminPeople = JSON.stringify((await call("GET", "/api/admin/users", { token: AT })).data);
  check("the admin's people list does not carry the account number either", !adminPeople.includes("123456789012") && !adminPeople.includes("accountEnc"));
  check("a rider cannot open the admin payout view", (await call("GET", `/api/admin/users/${winner.user.id}/payout`, { token: RT })).status === 403);
  check("a driver cannot open it either", (await call("GET", `/api/admin/users/${winner.user.id}/payout`, { token: winner.token })).status === 403);
  const payout = await call("GET", `/api/admin/users/${winner.user.id}/payout`, { token: AT });
  check("the admin can read the full payout details", payout.status === 200 && payout.data.bank?.account === "123456789012" && payout.data.bank?.holder === "Sai Kumar" && payout.data.upiId === "sai.driver@okbank", JSON.stringify(payout.data));
  check("the payout answer is marked do-not-store", ((await fetch(BASE + `/api/admin/users/${winner.user.id}/payout`, { headers: { Authorization: "Bearer " + AT } })).headers.get("cache-control") || "").includes("no-store"));
  const auditList = (await call("GET", "/api/admin/audit", { token: AT })).data;
  const auditArr = Array.isArray(auditList) ? auditList : auditList?.entries || [];
  check("that look at payout details is written to the audit log", auditArr.some((a) => a.action === "view_payout_details" && a.entity === `user:${winner.user.id}`), JSON.stringify(auditArr.slice(0, 2)));
  check("a driver can remove their bank details", (await call("DELETE", "/api/me/bank", { token: winner.token })).data.bank === undefined);

  const mover = await otpSignup("rider", "Phone Changer");
  const NEWP = phone();
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  check("a signed-out visitor cannot ask to change a number", (await call("POST", "/api/me/phone/request", { body: { phone: NEWP } })).status === 401);
  check("the admin cannot change a number here", (await call("POST", "/api/me/phone/request", { token: AT, body: { phone: NEWP } })).status === 403);
  check("asking for the number you already have is refused", (await call("POST", "/api/me/phone/request", { token: mover.token, body: { phone: mover.user.phone } })).status === 400);
  check("a number that already has a rider account is refused", (await call("POST", "/api/me/phone/request", { token: mover.token, body: { phone: meRider.data.phone } })).status === 409);
  const reqCode = await call("POST", "/api/me/phone/request", { token: mover.token, body: { phone: NEWP } });
  check("a code is requested for the NEW number", reqCode.status === 200 && reqCode.data.mode === "code", JSON.stringify(reqCode));
  check("a wrong code is refused", (await call("POST", "/api/me/phone/verify", { token: mover.token, body: { phone: NEWP, otp: "000000" } })).status === 400);
  check("after a wrong code the account still has its old number", (await call("GET", "/api/me", { token: mover.token })).data.phone === mover.user.phone);
  const changed = await call("POST", "/api/me/phone/verify", { token: mover.token, body: { phone: NEWP, otp: "123456" } });
  check("with the right code the account moves to the new number", changed.status === 200 && changed.data.phone === NEWP && changed.data.id === mover.user.id, JSON.stringify(changed.data));
  check("the same session keeps working", (await call("GET", "/api/me", { token: mover.token })).data.phone === NEWP);
  await wait(1300);
  await call("POST", "/api/auth/otp/request", { body: { phone: NEWP } });
  const viaNew = await call("POST", "/api/auth/otp/verify", { body: { phone: NEWP, otp: "123456", role: "rider" } });
  check("signing in with the new number reaches the same account", viaNew.status === 200 && viaNew.data.user?.id === mover.user.id, JSON.stringify(viaNew.data));
  await call("POST", "/api/auth/otp/request", { body: { phone: mover.user.phone } });
  const viaOld = await call("POST", "/api/auth/otp/verify", { body: { phone: mover.user.phone, otp: "123456", role: "rider" } });
  check("the old number no longer reaches it (it would start a new account)", viaOld.status === 200 && viaOld.data.needsSignup === true, JSON.stringify(viaOld.data));
  check("the new number is now taken", (await call("POST", "/api/me/phone/request", { token: other.token, body: { phone: NEWP } })).status === 409);
  const audit2 = (await call("GET", "/api/admin/audit", { token: AT })).data;
  const audit2Arr = Array.isArray(audit2) ? audit2 : audit2?.entries || [];
  check("the change is in the audit log, with the numbers hidden", audit2Arr.some((a) => a.action === "change_phone" && a.entity === `user:${mover.user.id}` && !JSON.stringify(a).includes(NEWP) && !JSON.stringify(a).includes(mover.user.phone)));

  console.log("Driver cancel returns ride to searching");
  const ride2 = await call("POST", "/api/rides", { token: RT, body: { vehicleType: "bike", pickup, dropoff: drop } });
  const acc2 = await call("PUT", `/api/rides/${ride2.data.id}/accept`, { token: d2.token });
  check("second ride accepted", acc2.status === 200);
  const dc = await call("PUT", `/api/rides/${ride2.data.id}/status`, { token: d2.token, body: { status: "cancelled" } });
  check("driver cancel reopens the ride", dc.status === 200 && dc.data.status === "requested" && !dc.data.driverId);
  const rc = await call("PUT", `/api/rides/${ride2.data.id}/status`, { token: RT, body: { status: "cancelled" } });
  check("rider can cancel before pickup", rc.status === 200 && rc.data.status === "cancelled");

  console.log("Reject, and cancel with a reason");
  const ride3 = await call("POST", "/api/rides", { token: RT, body: { vehicleType: "bike", pickup, dropoff: drop } });
  check("a fresh ride is booked", ride3.status === 200 && ride3.data.status === "requested", JSON.stringify(ride3.data));
  const seenBy = async (d) => (await call("GET", "/api/rides/available", { token: d.token })).data.some((r) => r.id === ride3.data.id);
  check("both drivers see the new request", (await seenBy(d1)) && (await seenBy(d2)));
  const rej = await call("PUT", `/api/rides/${ride3.data.id}/decline`, { token: d2.token });
  check("a driver can reject a request", rej.status === 200 && rej.data.ok === true, JSON.stringify(rej.data));
  check("a rejected request disappears for that driver", !(await seenBy(d2)));
  check("but other drivers still see it", await seenBy(d1));
  check("rejecting twice is harmless", (await call("PUT", `/api/rides/${ride3.data.id}/decline`, { token: d2.token })).status === 200);
  const accRej = await call("PUT", `/api/rides/${ride3.data.id}/accept`, { token: d2.token });
  check("a driver who rejected cannot accept it by mistake", accRej.status === 403, JSON.stringify(accRej.data));
  check("a rider cannot use the reject action", (await call("PUT", `/api/rides/${ride3.data.id}/decline`, { token: RT })).status === 403);
  check("rejecting a ride that does not exist is a 404", (await call("PUT", "/api/rides/nope/decline", { token: d1.token })).status === 404);
  const riderSeesRide = await call("GET", `/api/rides/${ride3.data.id}`, { token: RT });
  check("the rider cannot see which drivers rejected", riderSeesRide.status === 200 && riderSeesRide.data.declinedBy === undefined && riderSeesRide.data.cancelLog === undefined, JSON.stringify(riderSeesRide.data));
  const acc3 = await call("PUT", `/api/rides/${ride3.data.id}/accept`, { token: d1.token });
  check("another driver accepts", acc3.status === 200 && acc3.data.status === "accepted");
  const rejLate = await call("PUT", `/api/rides/${ride3.data.id}/decline`, { token: d2.token });
  check("rejecting a ride that was already taken changes nothing", rejLate.status === 200 && (await call("GET", `/api/rides/${ride3.data.id}`, { token: RT })).data.status === "accepted");
  const dc3 = await call("PUT", `/api/rides/${ride3.data.id}/status`, { token: d1.token, body: { status: "cancelled", reason: "Vehicle problem" } });
  check("driver cancels with a reason and the ride goes back to searching", dc3.status === 200 && dc3.data.status === "requested" && !dc3.data.driverId, JSON.stringify(dc3.data));
  check("after backing out, that driver can no longer read the rider's number", (await call("GET", `/api/rides/${ride3.data.id}/rider-contact`, { token: d1.token })).status === 403);
  check("the driver who backed out does not get the same ride again", !(await seenBy(d1)) && (await call("PUT", `/api/rides/${ride3.data.id}/accept`, { token: d1.token })).status === 403);
  const adminSeesRide = await call("GET", `/api/rides/${ride3.data.id}`, { token: AT });
  const backedOut = adminSeesRide.data.cancelLog || [];
  check("the admin sees who backed out and why", backedOut.length === 1 && backedOut[0].by === "driver" && backedOut[0].reason === "Vehicle problem" && (adminSeesRide.data.declinedBy || []).includes(d1.user.id) && (adminSeesRide.data.declinedBy || []).includes(d2.user.id), JSON.stringify(adminSeesRide.data));
  const rc3 = await call("PUT", `/api/rides/${ride3.data.id}/status`, { token: RT, body: { status: "cancelled", reason: "Changed my plans" } });
  check("the rider cancels with a reason", rc3.status === 200 && rc3.data.status === "cancelled" && rc3.data.cancelReason === "Changed my plans" && rc3.data.cancelledBy === "rider", JSON.stringify(rc3.data));
  const ride4 = await call("POST", "/api/rides", { token: RT, body: { vehicleType: "bike", pickup, dropoff: drop } });
  const rc4 = await call("PUT", `/api/rides/${ride4.data.id}/status`, { token: RT, body: { status: "cancelled", reason: "<img src=x onerror=alert(1)>" } });
  check("an invented reason is stored as 'Other', never as typed", rc4.status === 200 && rc4.data.cancelReason === "Other", JSON.stringify(rc4.data));
  const ride6 = await call("POST", "/api/rides", { token: RT, body: { vehicleType: "bike", pickup, dropoff: drop } });
  const acc6 = await call("PUT", `/api/rides/${ride6.data.id}/accept`, { token: d1.token });
  check("a driver accepts another ride and can read the rider's number", acc6.status === 200 && (await call("GET", `/api/rides/${ride6.data.id}/rider-contact`, { token: d1.token })).status === 200, JSON.stringify(acc6.data));
  await call("PUT", `/api/rides/${ride6.data.id}/status`, { token: RT, body: { status: "cancelled", reason: "Changed my plans" } });
  check("when the rider cancels, the driver loses access to the number", (await call("GET", `/api/rides/${ride6.data.id}/rider-contact`, { token: d1.token })).status === 403);
  const ride5 = await call("POST", "/api/rides", { token: RT, body: { vehicleType: "bike", pickup, dropoff: drop } });
  const rc5 = await call("PUT", `/api/rides/${ride5.data.id}/status`, { token: RT, body: { status: "cancelled" } });
  check("cancelling without a reason still works", rc5.status === 200 && rc5.data.status === "cancelled" && rc5.data.cancelReason === undefined, JSON.stringify(rc5.data));

  console.log("Admin controls");
  const stats = await call("GET", "/api/admin/stats", { token: AT });
  check("stats show fees earned", stats.status === 200 && stats.data.platformFeesEarned === 5 && stats.data.feesDueTotal === 5, JSON.stringify(stats.data));
  const badCfg = await call("PUT", "/api/admin/config", { token: AT, body: { surgeMultiplier: 9 } });
  check("surge above 2x rejected", badCfg.status === 400);
  const cfg = await call("PUT", "/api/admin/config", { token: AT, body: { platformFeePerRide: 8, maxFeesDue: 5 } });
  check("admin changes fee to Rs 8", cfg.status === 200 && cfg.data.platformFeePerRide === 8);
  const lim = await call("PUT", `/api/user/${winner.user.id}/online`, { token: winner.token, body: { isOnline: true } });
  check("driver over the fee limit cannot go online", lim.status === 403, JSON.stringify(lim.data));
  const settle = await call("POST", `/api/admin/drivers/${winner.user.id}/settle`, { token: AT, body: { amount: 5 } });
  check("admin settles dues", settle.status === 200 && settle.data.feesDue === 0);
  const back = await call("PUT", `/api/user/${winner.user.id}/online`, { token: winner.token, body: { isOnline: true } });
  check("driver can go online again after paying", back.status === 200);
  const audit = await call("GET", "/api/admin/audit", { token: AT });
  check("audit log records admin actions", audit.data.length >= 4 && audit.data.some((e) => e.action === "update_config"));
  const sus = await call("PUT", `/api/admin/users/${winner.user.id}/suspend`, { token: AT });
  check("admin suspends driver", sus.status === 200 && sus.data.suspended === true);
  check("suspended driver's token stops working", (await call("GET", "/api/me", { token: winner.token })).status === 403);

  console.log("Account, safety and extras");
  await call("PUT", "/api/admin/config", { token: AT, body: { platformFeePerRide: 5, maxFeesDue: 100 } });
  const acct = await otpSignup("rider", "Acct Person");
  const AC = acct.token, ACID = acct.user.id, ACPHONE = acct.phone;
  check("profile name can be changed", (await call("PUT", "/api/me", { token: AC, body: { fullName: "New Name" } })).data.fullName === "New Name");
  check("one-letter name rejected", (await call("PUT", "/api/me", { token: AC, body: { fullName: "N" } })).status === 400);
  check("there is no password change route any more", [404, 405].includes((await call("PUT", "/api/me/password", { token: AC, body: { currentPassword: "a", newPassword: "bbbbbbbbb" } })).status));

  check("bad emergency contact rejected", (await call("PUT", "/api/me/emergency-contact", { token: AC, body: { name: "Mum", phone: "123" } })).status === 400);
  const ec = await call("PUT", "/api/me/emergency-contact", { token: AC, body: { name: "Mum", phone: "9876543210" } });
  check("emergency contact saved", ec.status === 200 && ec.data.emergencyContact.phone === "9876543210");
  check("emergency contact can be removed", (await call("DELETE", "/api/me/emergency-contact", { token: AC })).data.emergencyContact === undefined);

  let fav;
  for (let i = 0; i < 10; i++) fav = await call("POST", "/api/me/favourites", { token: AC, body: { label: "Place " + i, address: "Somewhere " + i, lat: 17.12, lng: 81.29 } });
  check("up to 10 favourites saved", fav.status === 200 && fav.data.favourites.length === 10);
  check("11th favourite rejected", (await call("POST", "/api/me/favourites", { token: AC, body: { label: "Extra", address: "x", lat: 17.12, lng: 81.29 } })).status === 400);
  const rmFav = await call("DELETE", "/api/me/favourites/" + fav.data.favourites[0].id, { token: AC });
  check("favourite can be deleted", rmFav.data.favourites.length === 9);
  check("drivers cannot save favourites", (await call("POST", "/api/me/favourites", { token: d2.token, body: { label: "x", address: "y", lat: 17.12, lng: 81.29 } })).status === 403);

  // a fresh approved driver and a ride for the share / SOS / delete tests
  const d3 = await registerDriver("Driver Three", "bike", "AP37EF0001");
  await approve(AT, d3);
  await call("PUT", `/api/user/${d3.user.id}/online`, { token: d3.token, body: { isOnline: true } });
  await call("PUT", `/api/user/${d3.user.id}/location`, { token: d3.token, body: { lat: centre.lat + 0.001, lng: centre.lng } });
  const sRide = await call("POST", "/api/rides", { token: AC, body: { vehicleType: "bike", pickup, dropoff: drop } });
  check("account user can book", sRide.status === 200);
  check("cannot share a trip before a driver accepts", (await call("POST", `/api/rides/${sRide.data.id}/share`, { token: AC })).status === 400);
  check("SOS before accept is allowed only for the ride's people", (await call("POST", `/api/rides/${sRide.data.id}/sos`, { token: RT, body: {} })).status === 404);
  const delBusy = await call("DELETE", "/api/me", { token: AC, body: { otp: CODE } });
  check("cannot delete account during a ride", delBusy.status === 409);
  await call("PUT", `/api/rides/${sRide.data.id}/accept`, { token: d3.token });
  const share = await call("POST", `/api/rides/${sRide.data.id}/share`, { token: AC });
  check("rider can create a share link", share.status === 200 && /^\/track\/[A-Za-z0-9_-]{20,}$/.test(share.data.path));
  check("other riders cannot share this ride", (await call("POST", `/api/rides/${sRide.data.id}/share`, { token: RT })).status === 404);
  const tk = share.data.token;
  const trk = await call("GET", `/api/track/${tk}`);
  check("share link works without logging in", trk.status === 200 && trk.data.status === "accepted" && trk.data.driver.firstName === "Driver");
  check("share link shows vehicle number and driver position", trk.data.driver.vehicle.number === "AP37EF0001" && typeof trk.data.driver.location.lat === "number");
  const raw = JSON.stringify(trk.data);
  check("share link exposes no phone numbers, ids or start code", !raw.includes(ACPHONE) && !raw.includes(d3.user.phone) && !raw.includes("startOtp") && !raw.includes(sRide.data.id) && !/"id"/.test(raw));
  check("garbage share token -> 404", (await call("GET", "/api/track/not-a-real-token-at-all-0000")).status === 404);

  console.log("SOS");
  const sos = await call("POST", `/api/rides/${sRide.data.id}/sos`, { token: AC, body: { lat: 17.124, lng: 81.296 } });
  check("rider can raise SOS during a ride", sos.status === 200);
  check("SOS needs the right person", (await call("POST", `/api/rides/${sRide.data.id}/sos`, { token: RT, body: {} })).status === 404);
  check("share page tells viewers an alert was raised", (await call("GET", `/api/track/${tk}`)).data.sos === true);
  const sosList = await call("GET", "/api/admin/sos", { token: AT });
  const mine = sosList.data.find((x) => x.rideId === sRide.data.id);
  check("admin sees the SOS with rider phone and driver vehicle", sosList.status === 200 && mine && mine.rider.phone === ACPHONE && mine.driver.vehicle.number === "AP37EF0001" && !mine.sos.ackAt);
  check("admin stats count open SOS", (await call("GET", "/api/admin/stats", { token: AT })).data.sosOpen >= 1);
  check("non-admin cannot read SOS list", (await call("GET", "/api/admin/sos", { token: AC })).status === 403);
  check("admin acknowledges SOS", (await call("POST", `/api/admin/sos/${sRide.data.id}/ack`, { token: AT })).status === 200);
  check("acknowledged SOS no longer counted as open", (await call("GET", "/api/admin/stats", { token: AT })).data.sosOpen === 0);

  console.log("Finish the ride, then delete the account");
  await call("PUT", `/api/rides/${sRide.data.id}/status`, { token: d3.token, body: { status: "arrived" } });
  const otp3 = (await call("GET", `/api/rides/${sRide.data.id}`, { token: AC })).data.startOtp;
  await call("PUT", `/api/rides/${sRide.data.id}/status`, { token: d3.token, body: { status: "in_progress", otp: otp3 } });
  await call("PUT", `/api/rides/${sRide.data.id}/status`, { token: d3.token, body: { status: "completed" } });
  check("SOS not possible after the ride ended", (await call("POST", `/api/rides/${sRide.data.id}/sos`, { token: AC, body: {} })).status === 400);
  check("share link still works shortly after the trip ends", (await call("GET", `/api/track/${tk}`)).data.status === "completed");
  check("deleting needs a code first", (await call("DELETE", "/api/me", { token: AC, body: { otp: CODE } })).status === 400);
  check("a code for deleting is sent to your own number", (await call("POST", "/api/me/otp", { token: AC })).status === 200);
  check("a wrong code blocks account deletion", (await call("DELETE", "/api/me", { token: AC, body: { otp: CODE === "000000" ? "111111" : "000000" } })).status === 400);
  check("the Super Admin cannot ask for a delete code", (await call("POST", "/api/me/otp", { token: AT })).status === 403);
  check("admin account cannot be deleted through this route", (await call("DELETE", "/api/me", { token: AT, body: { otp: CODE } })).status === 403);
  const del = await call("DELETE", "/api/me", { token: AC, body: { otp: CODE, reason: "Moved away" } });
  check("account deletion works", del.status === 200);
  await sleep(2200);
  const gone = await otpSignup("rider", "Back Again", undefined, ACPHONE);
  check("after deletion the number has no account, it can sign up again", gone.status === 200 && gone.user.id !== ACID && gone.user.fullName === "Back Again");
  check("old token stops working", (await call("GET", "/api/me", { token: AC })).status === 401);
  const allRides = await call("GET", "/api/admin/rides", { token: AT });
  const kept = allRides.data.find((r) => r.id === sRide.data.id);
  check("trip record kept but rider name removed", kept && kept.riderName === "Deleted user");
  const aud2 = await call("GET", "/api/admin/audit", { token: AT });
  check("deletion is logged without the person's name", aud2.data.some((e) => e.action === "delete_own_account" && e.actorName === "Deleted user"));
  check("the new account starts empty (no saved places)", !(gone.user.favourites || []).length);

  console.log("Support settings and public pages");
  check("bad support phone rejected", (await call("PUT", "/api/admin/config", { token: AT, body: { supportPhone: "call me maybe" } })).status === 400);
  check("bad support email rejected", (await call("PUT", "/api/admin/config", { token: AT, body: { supportEmail: "nope" } })).status === 400);
  check("source link must be https", (await call("PUT", "/api/admin/config", { token: AT, body: { sourceCodeUrl: "http://example.com" } })).status === 400);
  await call("PUT", "/api/admin/config", { token: AT, body: { supportPhone: "+91 98765 43210", supportEmail: "help@example.in", sourceCodeUrl: "https://github.com/example/instaride" } });
  const pc = await call("GET", "/api/config/public");
  check("support details appear in the public config", pc.data.supportPhone === "+91 98765 43210" && pc.data.supportEmail === "help@example.in" && pc.data.sourceCodeUrl.startsWith("https://"));
  await call("PUT", "/api/admin/config", { token: AT, body: { supportPhone: "", supportEmail: "", sourceCodeUrl: "" } });
  check("support details can be cleared", (await call("GET", "/api/config/public")).data.supportPhone === "");
  const priv = await call("GET", "/legal/privacy", { raw: true });
  const privText = await priv.text();
  check("privacy page is served, marked as a draft, with a strict CSP", priv.status === 200 && privText.includes("DRAFT TEMPLATE") && (priv.headers.get("content-security-policy") || "").includes("default-src 'none'"));
  check("terms page is served", (await call("GET", "/legal/terms", { raw: true })).status === 200);
  const tp = await call("GET", "/track/anything-here", { raw: true });
  const tpText = await tp.text();
  check("tracking page is served with no inline script", tp.status === 200 && tpText.includes("track.js") && !/<script(?![^>]*\bsrc=)[^>]*>[^<]/i.test(tpText) && tp.headers.get("referrer-policy") === "no-referrer");
  check("tracking script is served", (await call("GET", "/track-assets/track.js", { raw: true })).status === 200);

  console.log("Health check and the go-live meter");
  const health = await call("GET", "/api/health");
  check("health check answers without login and reveals nothing else", health.status === 200 && JSON.stringify(health.data) === '{"ok":true}', JSON.stringify(health.data));
  check("meter needs a login", (await call("GET", "/api/admin/readiness")).status === 401);
  check("a rider cannot read the meter", (await call("GET", "/api/admin/readiness", { token: RT })).status === 403);
  const meter = await call("GET", "/api/admin/readiness", { token: AT });
  const checks = (meter.data && meter.data.checks) || [];
  const by = (id) => checks.find((c) => c.id === id) || {};
  check("meter returns grouped checks and a summary that adds up", meter.status === 200 && checks.length >= 20 && Object.values(meter.data.summary).reduce((a, b) => a + b, 0) === checks.length);
  check("every check has an id, group, title, status and plain detail", checks.every((c) => c.id && c.group && c.title && ["ok", "warn", "fail", "manual"].includes(c.status) && c.detail));
  check("anything not ok explains how to fix it", checks.filter((c) => c.status !== "ok").every((c) => c.fix && c.fix.length > 10));
  const dump = JSON.stringify(meter.data);
  const secrets = [process.env.SESSION_SECRET, process.env.ADMIN_PASSWORD, process.env.TWILIO_AUTH_TOKEN, process.env.TWILIO_ACCOUNT_SID].filter((v) => v && v.length >= 8);
  check("the meter never contains a secret, password or token", secrets.length > 0 && secrets.every((v) => !dump.includes(v)), `checked ${secrets.length} values`);
  check("redis and uploads are reported healthy", by("redis").status === "ok" && by("uploads").status === "ok");
  check("development mode and plain http are only warnings here", by("prod-mode").status === "warn" && by("https").status === "warn");
  check("unfinished legal pages are flagged with how many placeholders are left", ["legal-privacy", "legal-terms", "legal-delete-account"].every((id) => by(id).status === "warn" && /\d+ \[PLACEHOLDER\]/.test(by(id).detail)), JSON.stringify(by("legal-privacy")));
  check("placeholder fares and default service area are flagged", by("rates").status === "warn" && by("service-area").status === "warn");
  check("all manual steps start as not done", checks.filter((c) => c.status === "manual").length === 12 && checks.filter((c) => c.status === "manual").every((c) => c.done === false));
  check("a rider cannot tick a manual step", (await call("PUT", "/api/admin/readiness/manual/dlt", { token: RT, body: { done: true } })).status === 403);
  check("an unknown step is refused", (await call("PUT", "/api/admin/readiness/manual/not-a-step", { token: AT, body: { done: true } })).status === 404);
  check("the Super Admin can tick a manual step", (await call("PUT", "/api/admin/readiness/manual/dlt", { token: AT, body: { done: true } })).status === 200);
  const after = await call("GET", "/api/admin/readiness", { token: AT });
  check("the ticked step shows as ok and done", after.data.checks.find((c) => c.id === "dlt").status === "ok" && after.data.checks.find((c) => c.id === "dlt").done === true);
  await call("PUT", "/api/admin/readiness/manual/dlt", { token: AT, body: { done: false } });
  check("the tick can be undone", (await call("GET", "/api/admin/readiness", { token: AT })).data.checks.find((c) => c.id === "dlt").status === "manual");
  const aud3 = await call("GET", "/api/admin/audit", { token: AT });
  check("ticking steps is written to the audit log", aud3.data.some((e) => e.action === "meter_mark_done") && aud3.data.some((e) => e.action === "meter_mark_undone"));

  if (process.env.GEOCODE_MOCK) {
    console.log("Address search proxy (against a fake service)");
    const MOCK = process.env.GEOCODE_MOCK;
    const mockInfo = async () => (await fetch(MOCK + "/__last")).json();
    check("search needs a login", (await call("GET", "/api/geocode/search?q=bus+stand")).status === 401);
    check("too-short search returns nothing without calling out", (await call("GET", "/api/geocode/search?q=ab", { token: RT })).data.length === 0);
    const before = (await mockInfo()).calls;
    const s1 = await call("GET", "/api/geocode/search?q=Bus%20Stand", { token: RT });
    check("search returns clean places and drops broken rows", s1.status === 200 && s1.data.length === 2 && s1.data[0].label.startsWith("Bus Stand") && typeof s1.data[0].lat === "number");
    const info1 = await mockInfo();
    check("server identifies itself politely and limits results to the service area", /^InstaRide\/1\.0/.test(info1.last.ua) && info1.last.query.bounded === "1" && info1.last.query.countrycodes === "in" && !!info1.last.query.viewbox);
    await call("GET", "/api/geocode/search?q=bus%20stand", { token: RT });
    check("the same search is answered from the cache", (await mockInfo()).calls === info1.calls && info1.calls === before + 1);
    const rv = await call("GET", "/api/geocode/reverse?lat=17.1225&lng=81.2945", { token: RT });
    check("reverse lookup works", rv.status === 200 && rv.data.label.includes("Eluru Road"));
    check("bad coordinates rejected", (await call("GET", "/api/geocode/reverse?lat=abc&lng=1", { token: RT })).status === 400);
  }

  console.log(`\n${pass} passed, ${failN} failed`);
  process.exit(failN ? 1 : 0);
})().catch((e) => { console.error("Test crashed:", e); process.exit(2); });
