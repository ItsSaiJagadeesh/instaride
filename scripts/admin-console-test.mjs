// UI test for the Super Admin web console using jsdom (GPL-3.0-or-later).
//   BASE=http://localhost:5055 ADMIN_PHONE=... ADMIN_PASSWORD=... JSDOM_PATH=/path/to/node_modules/jsdom node scripts/admin-console-test.mjs
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { JSDOM } = require(process.env.JSDOM_PATH || "jsdom");
const BASE = process.env.BASE || "http://localhost:5055";
let pass = 0, failN = 0;
const check = (n, c, x = "") => { if (c) { pass++; console.log("  ok  ", n); } else { failN++; console.log("  FAIL", n, x); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(method, path, { token, body } = {}) {
  const r = await fetch(BASE + path, { method, headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await r.json(); } catch {}
  return { status: r.status, data };
}
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const KINDS = ["vehicle_front","vehicle_back","vehicle_left","vehicle_right","plate","rc","licence","insurance","selfie"];
const CODE = process.env.OTP_TEST_CODE || "123456";
// Riders and drivers sign up with a one-time code (no password).
async function signup(role, fullName, vehicle, ph = phone()) {
  await api("POST", "/api/auth/otp/request", { body: { phone: ph } });
  const v = await api("POST", "/api/auth/otp/verify", { body: { phone: ph, otp: CODE, role } });
  const su = await api("POST", "/api/auth/signup", { body: { signupToken: v.data.signupToken, fullName, vehicle } });
  return { status: su.status, data: su.data, phone: ph };
}
const phone = () => "9" + String(Math.floor(Math.random() * 1e9)).padStart(9, "0");

// --- test data: a pending driver whose name tries to inject HTML, and a rider with the same trick
const XSS = '<img src=x onerror="window.__pwned=1">Eve';
const reg = await signup("driver", XSS, { type: "bike", number: "AP37ZZ9999" });
const D = reg.data;
for (const k of KINDS) await api("PUT", `/api/driver/documents/${k}`, { token: D.token, body: { data: PNG } });
await api("POST", "/api/driver/submit", { token: D.token, body: {} });
await signup("rider", XSS + " rider");

// --- load the console in a simulated browser
const html = await (await fetch(BASE + "/console/")).text();
const csp = (await fetch(BASE + "/console/")).headers.get("content-security-policy") || "";
check("console is served with a strict CSP", csp.includes("script-src 'self'") && csp.includes("frame-ancestors 'none'") && !csp.includes("unsafe-inline"), csp);
check("page has no inline scripts", !/<script(?![^>]*\bsrc=)[^>]*>[^<]/i.test(html));

const dom = new JSDOM(html, { url: BASE + "/console/", runScripts: "outside-only", pretendToBeVisual: true });
const w = dom.window;
w.fetch = (u, o) => fetch(new URL(u, BASE).toString(), o);
w.URL.createObjectURL = () => "blob:test";
w.URL.revokeObjectURL = () => {};
w.confirm = () => true;
const js = await (await fetch(BASE + "/console/app.js")).text();
w.eval(js);
await sleep(200);
const $ = (s) => w.document.querySelector(s);
const $$ = (s) => [...w.document.querySelectorAll(s)];
const text = () => w.document.body.textContent;
async function until(fn, ms = 4000) { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return true; await sleep(50); } return false; }

check("shows the login form first", !!$("input[type=password]"));

// wrong password
$("input[type=tel]").value = process.env.ADMIN_PHONE;
$("input[type=password]").value = "wrong-password";
$("form").dispatchEvent(new w.Event("submit", { cancelable: true, bubbles: true }));
check("wrong password shows an error", await until(() => /Wrong mobile number or password/.test(text())));

// a rider cannot use the console
const riderPhone = phone();
await signup("rider", "Plain Rider", undefined, riderPhone);
$("input[type=tel]").value = riderPhone;
$("input[type=password]").value = "RiderPass123";
$("form").dispatchEvent(new w.Event("submit", { cancelable: true, bubbles: true }));
check("a rider cannot sign in to the console and no token is kept", await until(() => /Wrong mobile number or password/.test(text())) && !w.sessionStorage.getItem("ir_token"));

// admin login
$("input[type=tel]").value = process.env.ADMIN_PHONE;
$("input[type=password]").value = process.env.ADMIN_PASSWORD;
$("form").dispatchEvent(new w.Event("submit", { cancelable: true, bubbles: true }));
check("admin reaches the overview", await until(() => /Platform fees earned/.test(text())), text().slice(0, 200));
check("sidebar and fee line show rupees", /₹/.test(text()) && !!$(".side"));
check("verification badge shows pending drivers", await until(() => { const b = $("#vbadge"); return b && !b.hidden && Number(b.textContent) >= 1; }));

// verification queue
$$(".nav").find((b) => b.dataset.view === "verify").click();
check("verification queue lists the driver", await until(() => /AP37ZZ9999/.test(text())));
check("hostile name is shown as text, not run as HTML", text().includes("<img src=x") && !$("img[src=x]") && !w.__pwned);

$$("button").find((b) => b.textContent === "Review").click();
check("review page shows 9 photo slots", await until(() => $$(".doc").length === 9));

// approving without the VAHAN tick must be refused by the UI
$$("button").find((b) => b.textContent === "Approve driver").click();
check("approve is blocked until VAHAN is ticked", await until(() => /tick the box/.test(text())));

// ask for a re-upload then verify state, then re-submit and approve
$$(".chip").find((c) => c.textContent === "Number plate").click();
$("textarea").value = "white number plate";
$$("button").find((b) => b.textContent === "Ask to re-upload").click();
check("ask-to-re-upload goes back to the list", await until(() => /Asked the driver to re-upload/.test(text())));
let me = await api("GET", "/api/me", { token: D.token });
check("server shows needs_fix for the plate", me.data.verification.status === "needs_fix" && me.data.verification.fixKinds.includes("plate"));
await api("PUT", "/api/driver/documents/plate", { token: D.token, body: { data: PNG } });
await api("POST", "/api/driver/submit", { token: D.token, body: {} });

$$(".nav").find((b) => b.dataset.view === "verify").click();
await until(() => /AP37ZZ9999/.test(text()));
$$("button").find((b) => b.textContent === "Review").click();
await until(() => $$(".doc").length === 9);
$("#vahan").checked = true;
const dates = $$("input.input[placeholder='DD/MM/YYYY']");
dates[0].value = "31/12/2099";
dates[1].value = "31/12/2099";
$$("button").find((b) => b.textContent === "Approve driver").click();
check("approving shows a confirmation", await until(() => /Driver approved/.test(text())));
me = await api("GET", "/api/me", { token: D.token });
check("server shows approved with the dates entered", me.data.verification.status === "approved" && me.data.verification.insuranceExpiry === "2099-12-31");

// other views
for (const [view, needle] of [["users", "Fees due"], ["rides", "Rider → Driver"], ["settings", "Fee per completed ride"], ["audit", "driver verification approve"]]) {
  $$(".nav").find((b) => b.dataset.view === view).click();
  check(`${view} view loads`, await until(() => text().includes(needle)), text().slice(0, 120));
}
check("hostile names stay inert in the People view", !$("img[src=x]") && !w.__pwned);

// settings: change the fee through the UI, then check the server
$$(".nav").find((b) => b.dataset.view === "settings").click();
await until(() => /Fee per completed ride/.test(text()));
const feeInput = $$(".row").find((r) => /Fee per completed ride/.test(r.textContent)).querySelector("input");
feeInput.value = "7";
$$("button").find((b) => b.textContent === "Save changes").click();
check("saving settings confirms", await until(() => /Settings saved/.test(text())));
const pub = await api("GET", "/api/config/public");
check("server now charges Rs 7", pub.data.platformFeePerRide === 7);
feeInput.value = "500000";
$$("button").find((b) => b.textContent === "Save changes").click();
check("out-of-range fee is rejected with a message", await until(() => $$(".toast.err").length > 0));

// ---- SOS alert panel: a rider raises SOS on a live ride
const dD = await signup("driver", "Sos Driver", { type: "bike", number: "AP37SO0001" });
for (const k of KINDS) await api("PUT", `/api/driver/documents/${k}`, { token: dD.data.token, body: { data: PNG } });
await api("POST", "/api/driver/submit", { token: dD.data.token, body: {} });
const adminTok = (await api("POST", "/api/auth/login", { body: { phone: process.env.ADMIN_PHONE, password: process.env.ADMIN_PASSWORD } })).data.token;
await api("POST", `/api/admin/drivers/${dD.data.user.id}/verify`, { token: adminTok, body: { decision: "approve", vahanChecked: true, insuranceExpiry: "2099-01-01", fitnessExpiry: "2099-01-01" } });
await api("PUT", `/api/user/${dD.data.user.id}/online`, { token: dD.data.token, body: { isOnline: true } });
await api("PUT", `/api/user/${dD.data.user.id}/location`, { token: dD.data.token, body: { lat: 17.1226, lng: 81.2946 } });
const rp = phone();
const rr = await signup("rider", "Sos <b>Rider</b>", undefined, rp);
const ride = await api("POST", "/api/rides", { token: rr.data.token, body: { vehicleType: "bike", pickup: { lat: 17.1225, lng: 81.2945, address: "Bus stand" }, dropoff: { lat: 17.15, lng: 81.3, address: "Market" } } });
await api("PUT", `/api/rides/${ride.data.id}/accept`, { token: dD.data.token });
await api("POST", `/api/rides/${ride.data.id}/sos`, { token: rr.data.token, body: { lat: 17.124, lng: 81.296 } });

$$(".nav").find((b) => b.dataset.view === "rides").click();
await until(() => /Rider → Driver/.test(text()));
$$(".nav").find((b) => b.dataset.view === "overview").click();
check("overview shows the SOS alert with rider and driver phones", await until(() => $$(".sosalert").length === 1 && text().includes(rp) && text().includes("AP37SO0001")), text().slice(0, 200));
check("SOS rider name with HTML stays text", text().includes("Sos <b>Rider</b>") && !$(".sosalert b"));
check("SOS map link opens safely in a new tab", (() => { const a = $(".sosalert a"); return a && a.rel.includes("noopener") && a.href.startsWith("https://www.openstreetmap.org/"); })());
check("nav badge shows the open SOS count", await until(() => { const b = $("#sbadge"); return b && !b.hidden && /SOS 1/.test(b.textContent); }));
$$("button").find((b) => b.textContent === "I have handled this").click();
check("acknowledging marks it handled", await until(() => /SOS \(handled\)/.test(text())));
const stats2 = await api("GET", "/api/admin/stats", { token: adminTok });
check("server shows no open SOS after acknowledge", stats2.data.sosOpen === 0);

// ---- support details through the settings form
$$(".nav").find((b) => b.dataset.view === "settings").click();
await until(() => /Help and legal/.test(text()));
const supportRow = (label) => $$(".row").find((r) => r.textContent.startsWith(label)).querySelector("input");
supportRow("Support phone").value = "+91 98765 43210";
supportRow("Support email").value = "help@example.in";
$$("button").find((b) => b.textContent === "Save changes").click();
check("support details save", await until(() => /Settings saved/.test(text())));
let pc = await api("GET", "/api/config/public");
for (let i = 0; i < 40 && pc.data.supportPhone !== "+91 98765 43210"; i++) { await sleep(100); pc = await api("GET", "/api/config/public"); }
check("public config now has the support details", pc.data.supportPhone === "+91 98765 43210" && pc.data.supportEmail === "help@example.in");
supportRow("Support email").value = "not an email";
$$("button").find((b) => b.textContent === "Save changes").click();
check("bad support email is refused with a message", await until(() => $$(".toast.err").length > 0));

// ---- go-live meter
$$(".nav").find((b) => b.dataset.view === "golive").click();
check("the Go-live meter opens with a progress summary", await until(() => /of \d+ done/.test(text()) && /to fix now/.test(text())), text().slice(0, 200));
check("it groups checks and shows plain titles", ["Server", "Sign-in codes", "Legal pages", "Only a person can do these"].every((g) => text().includes(g)) && text().includes("Database (Redis) is connected"));
check("unfinished checks say what to do", /What to do:/.test(text()) && text().includes("[PLACEHOLDER]"));
check("no secret appears on the meter page", !text().includes(process.env.SESSION_SECRET || "no-secret-set") && !text().includes(process.env.ADMIN_PASSWORD));
const dltBox = $$(".meter-row").find((r) => r.dataset.check === "dlt").querySelector("input");
dltBox.checked = true; dltBox.dispatchEvent(new w.Event("change", { bubbles: true }));
let dltDone = false;
for (let i = 0; i < 40 && !dltDone; i++) { await sleep(100); const r = await api("GET", "/api/admin/readiness", { token: adminTok }); dltDone = r.data.checks.find((c) => c.id === "dlt").done === true; }
check("ticking a person-only step is saved on the server", dltDone);
check("after re-checking, that step shows as done", await until(() => { const row = $$(".meter-row").find((r) => r.dataset.check === "dlt"); return row && row.dataset.status === "ok" && row.querySelector("input").checked; }));
await api("PUT", "/api/admin/readiness/manual/dlt", { token: adminTok, body: { done: false } });

// sign out clears the token
$$(".nav").find((b) => /Sign out/.test(b.textContent)).click();
check("sign out clears the session", await until(() => !!$("input[type=password]")) && !w.sessionStorage.getItem("ir_token"));

console.log(`\n${pass} passed, ${failN} failed`);
process.exit(failN ? 1 : 0);
