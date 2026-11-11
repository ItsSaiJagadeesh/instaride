/*
 * InstaRide: a fork of RideFlow (GPL-3.0-or-later).
 * Loads values from a `.env` file in the folder you start the server from, if there is one.
 * Values already set in the environment (for example by your hosting provider) win over the file.
 * This must be the first import in server/index.ts so the other modules see the values.
 */
import * as fs from "fs";

const file = ".env";
if (fs.existsSync(file)) {
  // process.loadEnvFile exists in Node 20.12+ and never overrides variables that are already set.
  (process as any).loadEnvFile(file);
}
