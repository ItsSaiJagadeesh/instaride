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
  const rev = await call("PUT", `/api/rides/${ride.data.id}/review`, { token: RT, body: { rating: 5, comment: "Good" } });
  check("rider reviews the driver", rev.status === 200);
  check("driver cannot see review comment", (await call("GET", `/api/rides/driver/${winner.user.id}`, { token: winner.token })).data.every((r) => !r.review || r.review.comment === undefined));

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
