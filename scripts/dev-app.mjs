// Starts the Expo dev server for one app. Works the same on Windows, Mac and Linux.
//   node scripts/dev-app.mjs rider    -> InstaRider
//   node scripts/dev-app.mjs driver   -> InstaDriver
//   node scripts/dev-app.mjs all      -> development build with both roles
// GPL-3.0-or-later
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";

const variant = process.argv[2];
if (!["rider", "driver", "all"].includes(variant)) {
  console.error("Usage: node scripts/dev-app.mjs <rider|driver|all>");
  process.exit(1);
}

// Read .env first (it never overrides values you already set in your terminal).
if (existsSync(".env")) process.loadEnvFile(".env");

const env = { ...process.env };
env.EXPO_PUBLIC_DOMAIN = env.EXPO_PUBLIC_DOMAIN || "localhost:5000";
// Expo Go carries its own Google Maps key, so the real map works there.
if (env.EXPO_PUBLIC_DEMO !== "1") env.EXPO_PUBLIC_MAPS = env.EXPO_PUBLIC_MAPS || "native";
if (variant !== "all") {
  env.APP_VARIANT = variant;
  env.EXPO_PUBLIC_APP_VARIANT = variant;
}

if (process.argv.includes("--print")) {
  console.log(JSON.stringify({
    variant,
    EXPO_PUBLIC_DOMAIN: env.EXPO_PUBLIC_DOMAIN,
    APP_VARIANT: env.APP_VARIANT ?? null,
    EXPO_PUBLIC_APP_VARIANT: env.EXPO_PUBLIC_APP_VARIANT ?? null,
  }));
  process.exit(0);
}

if (/^(localhost|127\.0\.0\.1)(:|$)/.test(env.EXPO_PUBLIC_DOMAIN)) {
  console.warn(
    "\nNote: EXPO_PUBLIC_DOMAIN is 'localhost'. A phone cannot reach your computer through 'localhost'.\n" +
    "Set EXPO_PUBLIC_DOMAIN in your .env file to your computer's Wi-Fi address, for example 192.168.1.20:5000\n",
  );
}

// Expo bakes the app variant into the code and its cache does not notice when it changes, so switching
// between the InstaRider and InstaDriver app would otherwise show the wrong app. Clear the cache when
// the variant (or the server address) differs from the last run.
const stampFile = ".expo/last-run.json";
const stamp = JSON.stringify({ variant, domain: env.EXPO_PUBLIC_DOMAIN });
let previous = "";
try { previous = readFileSync(stampFile, "utf8"); } catch { /* first run */ }
const clear = previous !== stamp;
if (clear) console.log("App or server address changed since the last run: clearing the build cache (one slower start).");
try { mkdirSync(".expo", { recursive: true }); writeFileSync(stampFile, stamp); } catch { /* not fatal */ }

const child = spawn(`npx expo start${clear ? " --clear" : ""}`, { stdio: "inherit", env, shell: true });
child.on("exit", (code) => process.exit(code ?? 0));
