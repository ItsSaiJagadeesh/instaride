// Tests the Firebase phone-proof sign-in against a throwaway server (GPL-3.0-or-later).
// It makes its own signing key and a pretend copy of Google's certificate list, so nothing real is contacted.
// Start the server first with:
//   FIREBASE_PROJECT_ID=test-proj-abc FIREBASE_CERTS_URL=http://127.0.0.1:5997/certs OTP_FIXED=9876500001:123456 OTP_RESEND_SECONDS=2 ...
// Then: BASE=http://localhost:5055 node scripts/firebase-auth-test.mjs
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { createPrivateKey, sign, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = process.env.BASE || "http://localhost:5055";
const PROJECT = process.env.FIREBASE_PROJECT_ID || "test-proj-abc";
let pass = 0, failN = 0;
const check = (name, ok, extra = "") => { if (ok) { pass++; console.log("  ok  ", name); } else { failN++; console.log("  FAIL", name, extra); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- a signing key and certificate, like Google's, plus a second key that is NOT in the list (for forgeries)
const dir = mkdtempSync(join(tmpdir(), "fbtest-"));
const mk = (n) => { execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", `${dir}/${n}.key`, "-out", `${dir}/${n}.crt`, "-days", "2", "-subj", `/CN=${n}`], { stdio: "ignore" }); return { key: createPrivateKey(readFileSync(`${dir}/${n}.key`)), crt: readFileSync(`${dir}/${n}.crt`, "utf8") }; };
const good = mk("good"), other = mk("other");
const KID = "kid-" + randomUUID().slice(0, 8); // Google never reuses a key id, so neither does each run of this test
let certList = { [KID]: good.crt };
const certServer = createServer((req, res) => { res.setHeader("content-type", "application/json"); res.setHeader("cache-control", "public, max-age=3600"); res.end(JSON.stringify(certList)); }).listen(5997);

const b64u = (o) => Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64url");
const now = () => Math.floor(Date.now() / 1000);
function token(phone, over = {}, opt = {}) {
  const t = now();
  const payload = { iss: `https://securetoken.google.com/${PROJECT}`, aud: PROJECT, auth_time: t - 5, iat: t - 5, exp: t + 3000, sub: "uid-" + phone, nonce: randomUUID(), phone_number: `+91${phone}`, firebase: { identities: { phone: [`+91${phone}`] }, sign_in_provider: "phone" }, ...over };
  const header = { alg: opt.alg || "RS256", kid: opt.kid || KID, typ: "JWT" };
  const body = `${b64u(header)}.${b64u(payload)}`;
  if (opt.alg === "none") return body + ".";
  const sig = sign("RSA-SHA256", Buffer.from(body), (opt.signWith || good).key).toString("base64url");
  return `${body}.${sig}`;
}
async function call(method, path, { token: bearer, body } = {}) {
  const res = await fetch(BASE + path, { method, headers: { "content-type": "application/json", ...(bearer ? { authorization: "Bearer " + bearer } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data };
}
const phone = () => "9" + Array.from({ length: 9 }, () => Math.floor(Math.random() * 10)).join("");
const verify = (ph, idToken, role = "rider") => call("POST", "/api/auth/otp/verify", { body: { phone: ph, idToken, role } });

(async () => {
  console.log("Which way does a number prove itself?");
  const p1 = phone();
  const rq = await call("POST", "/api/auth/otp/request", { body: { phone: p1 } });
  check("an ordinary number is told to use Firebase, and the server sends no text", rq.status === 200 && rq.data.mode === "firebase" && rq.data.sent === false && rq.data.resendAfterSeconds > 0, JSON.stringify(rq));
  const again = await call("POST", "/api/auth/otp/request", { body: { phone: p1 } });
  check("asking again straight away is refused (same wait as the normal code)", again.status === 429, JSON.stringify(again));
  const fx = await call("POST", "/api/auth/otp/request", { body: { phone: "9876500001" } });
  check("a fixed test number still uses the plain code and no Firebase", fx.status === 200 && fx.data.mode === "code" && fx.data.sent === true, JSON.stringify(fx));
  const fxv = await call("POST", "/api/auth/otp/verify", { body: { phone: "9876500001", otp: "123456", role: "rider" } });
  check("and its fixed code signs in as before", fxv.status === 200 && (fxv.data.token || fxv.data.needsSignup), JSON.stringify(fxv));
  const fxTok = await verify("9876500001", token("9876500001"));
  check("a fixed test number cannot use a Firebase proof", fxTok.status === 400, JSON.stringify(fxTok));

  console.log("A good proof");
  const t1 = token(p1);
  const v1 = await verify(p1, t1);
  check("a good proof for a new number leads to sign-up", v1.status === 200 && v1.data.needsSignup === true && !!v1.data.signupToken, JSON.stringify(v1));
  const su = await call("POST", "/api/auth/signup", { body: { signupToken: v1.data.signupToken, fullName: "Firebase Rider" } });
  check("the sign-up then creates the account", su.status === 200 && su.data.user?.phone === p1 && !!su.data.token, JSON.stringify(su));
  const replay = await verify(p1, t1);
  check("the same proof cannot be used a second time", replay.status === 400 && /already used/.test(replay.data?.message || ""), JSON.stringify(replay));
  await sleep(2300);
  await call("POST", "/api/auth/otp/request", { body: { phone: p1 } });
  const v2 = await verify(p1, token(p1));
  check("a fresh proof signs the existing account in", v2.status === 200 && !!v2.data.token && v2.data.user?.id === su.data.user.id, JSON.stringify(v2));

  console.log("Proofs that must be refused");
  const p2 = phone();
  const refuse = async (name, tok, re) => { const r = await verify(p2, tok); check(name, r.status === 400 && (!re || re.test(r.data?.message || "")), JSON.stringify(r)); };
  await refuse("a proof for a different phone number", token(phone()), /different phone/);
  await refuse("a proof that has expired", token(p2, { exp: now() - 10, iat: now() - 4000, auth_time: now() - 4000 }), /expired/);
  await refuse("a sign-in that is too old (the person signed in long ago)", token(p2, { auth_time: now() - 3600 }), /too old/);
  await refuse("a proof made for another Firebase project", token(p2, { aud: "someone-elses-app", iss: "https://securetoken.google.com/someone-elses-app" }));
  await refuse("a wrong issuer", token(p2, { iss: "https://evil.example.com/" + PROJECT }));
  await refuse("a sign-in that was not by phone (for example a password)", token(p2, { firebase: { sign_in_provider: "password" } }));
  await refuse("a proof dated in the future", token(p2, { iat: now() + 4000, auth_time: now() + 4000 }));
  await refuse("a proof signed by a key that is not in Google's list (a forgery)", token(p2, {}, { signWith: other }));
  await refuse("a proof with an unknown key id", token(p2, {}, { kid: "nope" }));
  await refuse("a proof whose algorithm is 'none'", token(p2, {}, { alg: "none" }));
  const good3 = token(p2); const [h, pl, sg] = good3.split(".");
  const tampered = `${h}.${b64u({ ...JSON.parse(Buffer.from(pl, "base64url")), phone_number: "+919999999999" })}.${sg}`;
  await refuse("a proof whose contents were changed after signing", tampered);
  await refuse("rubbish instead of a proof", "x".repeat(150));
  const codeFor = await call("POST", "/api/auth/otp/verify", { body: { phone: p2, otp: "123456", role: "rider" } });
  check("a typed code is refused for a Firebase number (it must update the app)", codeFor.status === 400 && /update/i.test(codeFor.data?.message || ""), JSON.stringify(codeFor));

  console.log("Delete account with a Firebase proof");
  await sleep(2300); // the same short wait between requests applies to the delete step
  const dreq = await call("POST", "/api/me/otp", { token: v2.data.token });
  check("the delete step also uses Firebase and sends no text itself", dreq.status === 200 && dreq.data.mode === "firebase" && dreq.data.sent === false, JSON.stringify(dreq));
  const wrong = await call("DELETE", "/api/me", { token: v2.data.token, body: { idToken: token(phone()), reason: "test" } });
  check("a proof for another number cannot delete the account", wrong.status === 400, JSON.stringify(wrong));
  const del = await call("DELETE", "/api/me", { token: v2.data.token, body: { idToken: token(p1), reason: "test" } });
  check("the owner's own fresh proof deletes the account", del.status === 200, JSON.stringify(del));
  await call("POST", "/api/auth/otp/request", { body: { phone: p1 } }).catch(() => {});
  const after = await verify(p1, token(p1));
  check("afterwards the number is treated as new again", after.status === 200 && after.data.needsSignup === true, JSON.stringify(after));

  console.log(`\n${pass} passed, ${failN} failed`);
  certServer.close();
  process.exit(failN ? 1 : 0);
})().catch((e) => { console.error(e); certServer.close(); process.exit(2); });
