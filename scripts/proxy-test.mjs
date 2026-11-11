// Checks that rate limits count the real visitor behind a reverse proxy (GPL-3.0-or-later).
// Run it twice against two servers: one started with TRUST_PROXY=1 (EXPECT_TRUST=1) and one without (EXPECT_TRUST=0).
//   BASE=http://localhost:5081 EXPECT_TRUST=1 ADMIN_PHONE=... ADMIN_PASSWORD=... node scripts/proxy-test.mjs
const BASE = process.env.BASE, TRUST = process.env.EXPECT_TRUST === "1";
let pass = 0, failN = 0;
const check = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { failN++; console.log("  FAIL", n, x); } };
const post = async (path, body, headers = {}) => { const r = await fetch(BASE + path, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) }); return r.status; };
const phone = "9" + String(Math.floor(Math.random() * 1e9)).padStart(9, "0");

// 10 wrong password attempts per address and number are allowed, the 11th is refused
let last;
for (let i = 0; i < 11; i++) last = await post("/api/auth/login", { phone, password: "wrong" + i }, { "X-Forwarded-For": "203.0.113.5" });
check("the 11th attempt from one address is refused", last === 429, String(last));
const other = await post("/api/auth/login", { phone, password: "wrong" }, { "X-Forwarded-For": "203.0.113.9" });
if (TRUST) check("TRUST_PROXY=1: a different visitor behind the proxy is NOT blocked", other === 401, String(other));
else check("no TRUST_PROXY: the forwarded header is ignored, everyone shares the proxy's limit", other === 429, String(other));

// the meter explains the situation
const login = await fetch(BASE + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json", "X-Forwarded-For": "198.51.100.77" }, body: JSON.stringify({ phone: process.env.ADMIN_PHONE, password: process.env.ADMIN_PASSWORD }) });
const token = (await login.json()).token;
const m = await (await fetch(BASE + "/api/admin/readiness", { headers: { Authorization: "Bearer " + token, "X-Forwarded-For": "198.51.100.77" } })).json();
const tp = (m.checks || []).find((c) => c.id === "trust-proxy") || {};
if (TRUST) check("meter: proxy handling is ok", tp.status === "ok", JSON.stringify(tp));
else check("meter warns that requests arrive through a proxy but TRUST_PROXY is not set", tp.status === "warn" && /TRUST_PROXY/.test(tp.fix || ""), JSON.stringify(tp));
console.log(`\n${pass} passed, ${failN} failed`);
process.exit(failN ? 1 : 0);
