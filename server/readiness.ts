/*
 * InstaRide: a fork of RideFlow (GPL-3.0-or-later).
 * The go-live meter: reads the real state of this server and says what is connected, what is missing and how to fix it.
 * It never returns a secret, a password, a token or a fixed demo code.
 */
import * as fs from "fs";
import * as path from "path";
import type { Request } from "express";
import { storage, DEFAULT_CONFIG } from "./storage";
import { smsProviderName } from "./sms";

export type Status = "ok" | "warn" | "fail" | "manual";
export interface Check {
  id: string;
  group: string;
  title: string;
  status: Status;
  detail: string;
  fix?: string;
  done?: boolean; // manual steps only
}

const isProd = () => process.env.NODE_ENV === "production";
/** Something that must be right in production is only a reminder while developing on a laptop. */
const prodFail = (): Status => (isProd() ? "fail" : "warn");

/** Steps that nobody can automate: they prove who the owner is, or need a human decision. */
export const MANUAL_STEPS: { id: string; title: string; fix: string }[] = [
  { id: "domain-owner", title: "The domain name is bought in the owner's own name", fix: "Register it at a registrar with the owner's email and two-step verification. Write down who can log in." },
  { id: "dlt", title: "SMS sender and message template are registered (DLT) and approved", fix: "Your SMS provider guides this. The sign-in message text in .env.example must match the approved template exactly." },
  { id: "sms-funded", title: "The SMS account is out of trial mode and has credit", fix: "Trial accounts only text verified numbers. Add credit and send a code to a number that is not yours." },
  { id: "play-account", title: "Google Play Console account is created and verified", fix: "Needs the one-time fee and identity verification, which can take days." },
  { id: "play-testing", title: "Google's required closed test has been completed (if your account needs it)", fix: "Check the current rule for new accounts in the Play Console under testing." },
  { id: "rto", title: "RTO / transport department answer on yellow-plate taxis and licensing is in writing", fix: "Ask the Andhra Pradesh transport department or local RTO and keep the reply." },
  { id: "insurance", title: "Rider and driver insurance arrangement is decided", fix: "Ask an insurance adviser what cover your drivers and riders need." },
  { id: "legal-review", title: "A lawyer has reviewed the privacy policy and terms", fix: "Have the final pages in legal/ checked before you publish the app." },
  { id: "real-phone-test", title: "The full flow was tested on real phones, with real SMS", fix: "Sign up, upload photos, book, share a trip, press SOS, delete an account, using two real phones." },
  { id: "restore-test", title: "A backup was restored onto a clean copy and it worked", fix: "Run deploy/restore.sh on a test machine. A backup nobody has restored is only a hope." },
  { id: "sos-watch", title: "A named person watches SOS alerts during service hours", fix: "Nothing calls or texts anyone by itself. Write down who watches the console and when." },
];

function placeholdersIn(file: string): { exists: boolean; placeholders: number; draft: boolean } {
  try {
    const text = fs.readFileSync(path.resolve(process.cwd(), "legal", file), "utf8");
    const placeholders = (text.match(/\[[A-Z][A-Z0-9 /_-]{2,}\]/g) || []).length;
    return { exists: true, placeholders, draft: /class="draft"/.test(text) };
  } catch {
    return { exists: false, placeholders: 0, draft: false };
  }
}

async function newestBackupAgeHours(dir: string): Promise<number | null> {
  try {
    const names = await fs.promises.readdir(dir);
    let newest = 0;
    for (const n of names) {
      if (!/^(redis|uploads)-.*\.(rdb|tar\.gz)$/.test(n)) continue;
      const st = await fs.promises.stat(path.join(dir, n));
      newest = Math.max(newest, st.mtimeMs);
    }
    return newest ? (Date.now() - newest) / 3_600_000 : null;
  } catch {
    return null;
  }
}

export async function buildReadiness(req: Request): Promise<{ generatedAt: string; summary: Record<Status, number>; checks: Check[] }> {
  const checks: Check[] = [];
  const add = (c: Check) => checks.push(c);
  const config = await storage.getConfig();
  const uploads = path.resolve(process.env.UPLOADS_DIR || path.join(process.cwd(), "data", "uploads"));

  // ------------------------------------------------------------------ server
  add({
    id: "prod-mode", group: "Server", title: "Running in production mode",
    status: isProd() ? "ok" : "warn",
    detail: isProd() ? "NODE_ENV is production." : "Running in development mode: fine on your laptop, not for real users.",
    fix: isProd() ? undefined : "Start the server with the deploy pack (docker compose), or set NODE_ENV=production.",
  });

  const forwardedProto = req.header("x-forwarded-proto");
  const secure = req.secure || forwardedProto === "https";
  add({
    id: "https", group: "Server", title: "Connections use https",
    status: secure ? "ok" : prodFail(),
    detail: secure ? "This page was opened over https." : "This page was opened over plain http, so passwords and codes are not encrypted on the way.",
    fix: secure ? undefined : "Put the server behind https (the deploy pack does this with Caddy) and open the console through your https domain.",
  });

  const behindProxy = !!req.header("x-forwarded-for");
  const proxyTrusted = !!process.env.TRUST_PROXY;
  add({
    id: "trust-proxy", group: "Server", title: "Each user is counted separately (proxy address handling)",
    status: behindProxy && !proxyTrusted ? "warn" : "ok",
    detail: behindProxy && !proxyTrusted
      ? "Requests arrive through a proxy but TRUST_PROXY is not set, so every user shares one rate limit and sign-in codes run out for everybody."
      : "Rate limits use the real visitor address.",
    fix: behindProxy && !proxyTrusted ? "Set TRUST_PROXY=1 in .env (only when the app is reachable only through your proxy) and restart." : undefined,
  });

  const secret = process.env.SESSION_SECRET || "";
  add({
    id: "session-secret", group: "Server", title: "Login signing secret is set",
    status: secret.length >= 32 ? "ok" : prodFail(),
    detail: secret.length >= 32 ? "A long SESSION_SECRET is set." : "No long SESSION_SECRET: everyone is logged out whenever the server restarts.",
    fix: secret.length >= 32 ? undefined : "Add SESSION_SECRET (48+ random characters) to .env. The setup script does this for you.",
  });

  let redisOk = false;
  try { redisOk = await storage.ping(); } catch { /* reported below */ }
  add({
    id: "redis", group: "Server", title: "Database (Redis) is connected",
    status: redisOk ? "ok" : "fail",
    detail: redisOk ? "Redis answered." : "Redis did not answer.",
    fix: redisOk ? undefined : "Check that the redis container is running: docker compose ps",
  });

  let writable = false;
  try { await fs.promises.mkdir(uploads, { recursive: true }); await fs.promises.access(uploads, fs.constants.W_OK); writable = true; } catch { /* reported below */ }
  add({
    id: "uploads", group: "Server", title: "Driver documents can be stored",
    status: writable ? "ok" : "fail",
    detail: writable ? "The uploads folder is writable." : "The uploads folder is missing or not writable, so drivers cannot upload photos.",
    fix: writable ? undefined : "Check UPLOADS_DIR and the folder's permissions (in Docker it is the app_data volume).",
  });

  try {
    const st = await fs.promises.statfs(uploads);
    const freePct = Math.round((st.bavail / st.blocks) * 100);
    add({
      id: "disk", group: "Server", title: "Disk space",
      status: freePct < 5 ? "fail" : freePct < 15 ? "warn" : "ok",
      detail: `${freePct}% of the disk is free.`,
      fix: freePct < 15 ? "Free space or enlarge the disk. Driver photos and backups keep growing." : undefined,
    });
  } catch { /* some systems cannot report this */ }

  const backupDir = process.env.BACKUP_DIR;
  if (!backupDir) {
    add({ id: "backups", group: "Server", title: "Nightly backups", status: prodFail(), detail: "No backup folder is configured, so nothing is being backed up.", fix: "Use the deploy pack: it runs a backup container and sets BACKUP_DIR." });
  } else {
    const age = await newestBackupAgeHours(backupDir);
    add({
      id: "backups", group: "Server", title: "Nightly backups",
      status: age === null ? "fail" : age > 36 ? "warn" : "ok",
      detail: age === null ? "The backup folder has no backup yet." : `Newest backup is ${Math.round(age)} hours old.`,
      fix: age === null || age > 36 ? "Check the backup container's logs: docker compose logs backup. Also copy backups off this server regularly." : undefined,
    });
  }

  // ------------------------------------------------------------- sign-in codes
  const provider = smsProviderName();
  const fixedCount = (process.env.OTP_FIXED || "").split(",").filter((s: string) => s.trim()).length;
  const twilioReady = !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && (process.env.TWILIO_FROM || process.env.TWILIO_MESSAGING_SERVICE_SID));
  const smsOk = provider === "twilio" && twilioReady;
  add({
    id: "sms", group: "Sign-in codes", title: "Sign-in codes can be sent by SMS",
    status: smsOk ? "ok" : provider === "console" && !isProd() ? "warn" : "fail",
    detail: smsOk ? "Twilio is configured." : provider === "console" && !isProd()
      ? "Codes are only printed in the server window (development)." : "No SMS provider is configured, so real people cannot sign in.",
    fix: smsOk ? undefined : "Set SMS_PROVIDER=twilio and the three TWILIO_ values in .env (or ask for another provider to be added), then restart.",
  });
  add({
    id: "review-numbers", group: "Sign-in codes", title: "Demo numbers for Google's reviewers",
    status: fixedCount > 0 ? "ok" : "warn",
    detail: fixedCount > 0 ? `${fixedCount} demo number(s) configured.` : "No demo numbers: Google's reviewers cannot receive your SMS and will not be able to sign in.",
    fix: fixedCount > 0 ? undefined : "Set OTP_FIXED=YOURNUMBER:YOURCODE in .env, using a number you own that holds no real data. Remove it after approval.",
  });

  // ----------------------------------------------------------- business settings
  const sa = config.serviceArea, d = DEFAULT_CONFIG.serviceArea;
  add({
    id: "service-area", group: "Your business", title: "Service area is checked",
    status: sa.lat === d.lat && sa.lng === d.lng && sa.radiusKm === d.radiusKm ? "warn" : "ok",
    detail: sa.lat === d.lat && sa.lng === d.lng ? "Still the approximate default centre." : `Centre set for ${sa.name}, radius ${sa.radiusKm} km.`,
    fix: sa.lat === d.lat && sa.lng === d.lng ? "Settings, Service area: right-click your town centre in a map to copy its coordinates, then save." : undefined,
  });
  const defaultRates = JSON.stringify(config.rates) === JSON.stringify(DEFAULT_CONFIG.rates);
  add({
    id: "rates", group: "Your business", title: "Fares are your own",
    status: defaultRates ? "warn" : "ok",
    detail: defaultRates ? "The fares are still the placeholder rates." : "Fares have been changed from the placeholders.",
    fix: defaultRates ? "Settings: set base, per-km, per-minute and minimum fare for each vehicle type after checking local fares." : undefined,
  });
  add({
    id: "support", group: "Your business", title: "Support contact is set",
    status: config.supportPhone || config.supportEmail ? "ok" : "warn",
    detail: config.supportPhone || config.supportEmail ? "Riders and drivers can see how to reach you." : "The Help screen has no phone or email.",
    fix: config.supportPhone || config.supportEmail ? undefined : "Settings, Help and legal: add a support phone and email.",
  });
  add({
    id: "source-link", group: "Your business", title: "Source code link is set (GPL)",
    status: config.sourceCodeUrl ? "ok" : "warn",
    detail: config.sourceCodeUrl ? "The About screen links to the source." : "The licence requires you to offer the source code to users.",
    fix: config.sourceCodeUrl ? undefined : "Publish the code (without .env or any driver data) and add the https link in Settings, Help and legal.",
  });

  // ------------------------------------------------------------------ legal pages
  for (const [file, title] of [["privacy.html", "Privacy policy"], ["terms.html", "Terms and conditions"], ["delete-account.html", "Account deletion page"]] as const) {
    const r = placeholdersIn(file);
    const finished = r.exists && r.placeholders === 0 && !r.draft;
    add({
      id: `legal-${file.replace(".html", "")}`, group: "Legal pages", title: `${title} is finished`,
      status: !r.exists ? "fail" : finished ? "ok" : prodFail(),
      detail: !r.exists ? "The page is missing." : finished ? "No placeholders and no DRAFT banner." : `${r.placeholders} [PLACEHOLDER] left${r.draft ? " and the DRAFT banner is still on" : ""}.`,
      fix: finished ? undefined : `Edit legal/${file}: replace every [PLACEHOLDER], remove the red DRAFT box, and have a lawyer review it. Google needs these pages at public https links.`,
    });
  }

  // ------------------------------------------------------------------- operations
  const drivers = await storage.getUsersByRole("driver");
  const approved = drivers.filter((d2) => d2.verification?.status === "approved").length;
  const pending = drivers.filter((d2) => d2.verification?.status === "pending").length;
  add({
    id: "drivers", group: "Operations", title: "There is at least one approved driver",
    status: approved > 0 ? "ok" : "warn",
    detail: approved > 0 ? `${approved} approved driver(s)${pending ? `, ${pending} waiting for review` : ""}.` : "No approved drivers yet, so nobody can be matched.",
    fix: approved > 0 ? undefined : "Have drivers sign up, then review their photos under Verification.",
  });

  // --------------------------------------------------------------------- manual
  const done = await storage.getManualChecks();
  for (const m of MANUAL_STEPS) {
    add({ id: m.id, group: "Only a person can do these", title: m.title, status: done[m.id] ? "ok" : "manual", detail: done[m.id] ? "Marked as done." : "Not marked as done yet.", fix: m.fix, done: !!done[m.id] });
  }

  const summary: Record<Status, number> = { ok: 0, warn: 0, fail: 0, manual: 0 };
  for (const c of checks) summary[c.status]++;
  return { generatedAt: new Date().toISOString(), summary, checks };
}
