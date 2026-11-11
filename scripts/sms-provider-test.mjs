// Checks sending codes through the (fake) Twilio API and the fixed review numbers (GPL-3.0-or-later).
// Needs: scripts/mock-sms.mjs running, and a server started with SMS_PROVIDER=twilio, TWILIO_ACCOUNT_SID=ACtest,
// TWILIO_AUTH_TOKEN=secret, TWILIO_FROM=+15550001111, TWILIO_API_BASE=http://127.0.0.1:5998,
// OTP_FIXED=9876500001:654321 and NO OTP_TEST_CODE.   BASE=http://localhost:5060 SERVER_LOG=/tmp/server_sms.log
import fs from "node:fs";
const BASE = process.env.BASE, MOCK = "http://127.0.0.1:5998";
let pass = 0, failN = 0;
const check = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { failN++; console.log("  FAIL", n, x); } };
const call = async (path, body) => { const r = await fetch(BASE + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); let d = null; try { d = await r.json(); } catch {} return { status: r.status, data: d }; };
const sent = async () => (await fetch(MOCK + "/__log")).json();

const A = "9" + String(Math.floor(Math.random() * 1e9)).padStart(9, "0");
const before = (await sent()).length;
const rq = await call("/api/auth/otp/request", { phone: A });
check("request succeeds", rq.status === 200, JSON.stringify(rq.data));
const log = await sent();
const msg = log[log.length - 1];
check("exactly one SMS was sent", log.length === before + 1);
check("sent to the Twilio messages endpoint with basic auth", msg.path === "/2010-04-01/Accounts/ACtest/Messages.json" && msg.auth === "Basic " + Buffer.from("ACtest:secret").toString("base64"));
check("recipient is +91 plus the number and sender is the configured one", msg.form.To === "+91" + A && msg.form.From === "+15550001111");
const m = /^(\d{6}) is your InstaRide verification code/.exec(msg.form.Body || "");
check("message contains a 6-digit code and says not to share it", !!m && /Do not share/.test(msg.form.Body), msg.form.Body);
const code = m ? m[1] : "000000";
const wrong = await call("/api/auth/otp/verify", { phone: A, otp: code === "111111" ? "222222" : "111111", role: "rider" });
check("a wrong code is refused", wrong.status === 400);
const ok = await call("/api/auth/otp/verify", { phone: A, otp: code, role: "rider" });
check("the code from the SMS works", ok.status === 200 && ok.data.needsSignup === true);
const su = await call("/api/auth/signup", { signupToken: ok.data.signupToken, fullName: "Sms Person" });
check("sign-up completes", su.status === 200 && su.data.user.phone === A);
const serverLog = process.env.SERVER_LOG ? fs.readFileSync(process.env.SERVER_LOG, "utf8") : "";
check("the code never appears in the server log", !serverLog.includes(code) || code.length < 6);

// fixed review number: no SMS, fixed code
const n1 = (await sent()).length;
const fx = await call("/api/auth/otp/request", { phone: "9876500001" });
check("a fixed review number gets a code without any SMS", fx.status === 200 && (await sent()).length === n1);
const fxv = await call("/api/auth/otp/verify", { phone: "9876500001", otp: "654321", role: "driver" });
check("the fixed code works for that number", fxv.status === 200 && (fxv.data.needsSignup || fxv.data.token));
const B = "9" + String(Math.floor(Math.random() * 1e9)).padStart(9, "0");
await call("/api/auth/otp/request", { phone: B });
const nf = await call("/api/auth/otp/verify", { phone: B, otp: "654321", role: "rider" });
check("the fixed code does NOT work for other numbers", nf.status === 400);

// provider failure
const bad = "9000009999";
const f1 = await call("/api/auth/otp/request", { phone: bad });
check("when the SMS provider fails the app gets a clear 502", f1.status === 502 && /could not send/i.test(f1.data.message), JSON.stringify(f1.data));
const f2 = await call("/api/auth/otp/request", { phone: bad });
check("a failed send does not lock the person out (no cooldown)", f2.status === 502);
const f3 = await call("/api/auth/otp/verify", { phone: bad, otp: "123456", role: "rider" });
check("no usable code is left behind after a failed send", f3.status === 400);

console.log(`\n${pass} passed, ${failN} failed`);
process.exit(failN ? 1 : 0);
