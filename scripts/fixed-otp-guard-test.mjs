// Checks that fixed sign-in codes are ignored in production unless ALLOW_FIXED_OTP=yes (GPL-3.0-or-later).
// Start the server in production mode with FIREBASE_PROJECT_ID set and OTP_FIXED=9876500001:123456, then:
//   EXPECT=ignored BASE=http://localhost:5058 node scripts/fixed-otp-guard-test.mjs    (switch NOT set)
//   EXPECT=active  BASE=http://localhost:5058 node scripts/fixed-otp-guard-test.mjs    (ALLOW_FIXED_OTP=yes)
const BASE = process.env.BASE || "http://localhost:5058";
const EXPECT = process.env.EXPECT || "ignored";
let pass = 0, failN = 0;
const check = (n, ok, x = "") => { if (ok) { pass++; console.log("  ok  ", n); } else { failN++; console.log("  FAIL", n, x); } };
const post = async (path, body) => { const r = await fetch(BASE + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); let d = null; try { d = await r.json(); } catch {} return { status: r.status, data: d }; };
const FIXED = "9876500001", CODE = "123456", OTHER = "9" + Array.from({ length: 9 }, () => Math.floor(Math.random() * 10)).join("");

(async () => {
  console.log(`Production, fixed codes expected to be: ${EXPECT}`);
  const rq = await post("/api/auth/otp/request", { phone: FIXED });
  const vf = await post("/api/auth/otp/verify", { phone: FIXED, otp: CODE, role: "rider" });
  if (EXPECT === "active") {
    check("the listed number uses the plain code route (no Firebase)", rq.status === 200 && rq.data.mode === "code", JSON.stringify(rq));
    check("its fixed code signs in", vf.status === 200 && (vf.data.needsSignup || vf.data.token), JSON.stringify(vf));
  } else {
    check("the listed number is told to use Firebase, exactly like everyone else", rq.status === 200 && rq.data.mode === "firebase" && rq.data.sent === false, JSON.stringify(rq));
    check("its old fixed code is REFUSED", vf.status === 400 && !vf.data?.token && !vf.data?.needsSignup, JSON.stringify(vf));
  }
  const o = await post("/api/auth/otp/request", { phone: OTHER });
  check("any other number goes the Firebase way", o.status === 200 && o.data.mode === "firebase", JSON.stringify(o));
  const guess = await post("/api/auth/otp/verify", { phone: OTHER, otp: CODE, role: "rider" });
  check("the fixed code does not work for any other number", guess.status === 400 && !guess.data?.token, JSON.stringify(guess));
  console.log(`\n${pass} passed, ${failN} failed`); process.exit(failN ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
