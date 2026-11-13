import "./load-env";
import express from "express";
import type { Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { storage } from "./storage";
import { assertSecurityConfig, hashPassword } from "./auth";
import { assertOtpConfig } from "./otp";
import { assertFirebaseConfig } from "./firebase";
import { describeSmsSetup } from "./sms";
import * as fs from "fs";
import * as path from "path";

const app = express();
const log = console.log;

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

function setupCors(app: express.Application) {
  // Set ALLOWED_ORIGINS to a comma-separated list of web origins (for example your admin web URL).
  // Native apps do not send an Origin header, so they are not affected.
  const allowed = new Set(
    (process.env.ALLOWED_ORIGINS || "")
      .split(",")
      .map((o: string) => o.trim())
      .filter(Boolean),
  );
  const isDev = process.env.NODE_ENV !== "production";

  app.disable("x-powered-by");
  // Behind a reverse proxy (Caddy, nginx, a load balancer) every request would otherwise appear to come from
  // the proxy, and all users would share one rate limit. TRUST_PROXY=1 means "trust one proxy in front of me".
  // Only set it when the app is reachable ONLY through that proxy.
  if (process.env.TRUST_PROXY) {
    const hops = Number(process.env.TRUST_PROXY);
    app.set("trust proxy", Number.isInteger(hops) && hops > 0 ? hops : 1);
  }
  app.use((_req, res, next) => {
    res.header("X-Content-Type-Options", "nosniff");
    res.header("Referrer-Policy", "no-referrer");
    next();
  });

  app.use((req, res, next) => {
    const origin = req.header("origin");
    const isLocalhost =
      isDev && (origin?.startsWith("http://localhost:") || origin?.startsWith("http://127.0.0.1:"));

    if (origin && (allowed.has(origin) || isLocalhost)) {
      res.header("Access-Control-Allow-Origin", origin);
      res.header("Vary", "Origin");
      res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
      res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    }

    if (req.method === "OPTIONS") {
      return res.sendStatus(204);
    }

    next();
  });
}

function setupBodyParsing(app: express.Application) {
  const json = express.json({ limit: "100kb" });
  app.use((req, res, next) => {
    // Document photos are uploaded as base64 and parsed with a larger limit in that route.
    if (req.path.startsWith("/api/driver/documents/")) return next();
    return json(req, res, next);
  });
  app.use(express.urlencoded({ extended: false, limit: "100kb" }));
}

/** Super Admin web console: static files from ./admin-web, served at /console with a strict CSP. */
function setupAdminConsole(app: express.Application) {
  const dir = path.resolve(process.cwd(), "admin-web");
  app.use(
    "/console",
    (_req: Request, res: Response, next: NextFunction) => {
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; " +
          "base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
      );
      res.setHeader("X-Frame-Options", "DENY");
      res.setHeader("Cache-Control", "no-cache");
      next();
    },
    express.static(dir, { index: "index.html" }),
  );
}

/** Public pages: the shared-trip tracking page and the privacy policy / terms. */
function setupPublicPages(app: express.Application) {
  const trackDir = path.resolve(process.cwd(), "track-web");
  const legalDir = path.resolve(process.cwd(), "legal");
  const csp = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

  const strict = (_req: Request, res: Response, next: NextFunction) => {
    res.setHeader("Content-Security-Policy", csp);
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    next();
  };

  // One page for every token: the script reads the token from the address and asks the API.
  app.get("/track/:token", strict, (_req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    res.sendFile(path.join(trackDir, "index.html"));
  });
  app.use("/track-assets", strict, express.static(trackDir, { index: false }));
  app.use("/legal", strict, express.static(legalDir, { index: false, extensions: ["html"] }));
}

function setupRequestLogging(app: express.Application) {
  app.use((req, res, next) => {
    const start = Date.now();
    const path = req.path;
    let capturedJsonResponse: Record<string, unknown> | undefined = undefined;

    const originalResJson = res.json;
    res.json = function (bodyJson, ...args) {
      capturedJsonResponse = bodyJson;
      return originalResJson.apply(res, [bodyJson, ...args]);
    };

    res.on("finish", () => {
      if (!path.startsWith("/api")) return;

      const duration = Date.now() - start;

      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      // Response bodies are deliberately not logged: they can contain personal data.
      void capturedJsonResponse;

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    });

    next();
  });
}

function getAppName(): string {
  try {
    const appJsonPath = path.resolve(process.cwd(), "app.json");
    const appJsonContent = fs.readFileSync(appJsonPath, "utf-8");
    const appJson = JSON.parse(appJsonContent);
    return appJson.expo?.name || "App Landing Page";
  } catch {
    return "App Landing Page";
  }
}

function serveExpoManifest(platform: string, res: Response) {
  const manifestPath = path.resolve(
    process.cwd(),
    "static-build",
    platform,
    "manifest.json",
  );

  if (!fs.existsSync(manifestPath)) {
    return res
      .status(404)
      .json({ error: `Manifest not found for platform: ${platform}` });
  }

  res.setHeader("expo-protocol-version", "1");
  res.setHeader("expo-sfv-version", "0");
  res.setHeader("content-type", "application/json");

  const manifest = fs.readFileSync(manifestPath, "utf-8");
  res.send(manifest);
}

function serveLandingPage({
  req,
  res,
  landingPageTemplate,
  appName,
}: {
  req: Request;
  res: Response;
  landingPageTemplate: string;
  appName: string;
}) {
  const forwardedProto = req.header("x-forwarded-proto");
  const protocol = forwardedProto || req.protocol || "https";
  const forwardedHost = req.header("x-forwarded-host");
  const host = forwardedHost || req.get("host");
  const baseUrl = `${protocol}://${host}`;
  const expsUrl = `${host}`;

  log(`baseUrl`, baseUrl);
  log(`expsUrl`, expsUrl);

  const html = landingPageTemplate
    .replace(/BASE_URL_PLACEHOLDER/g, baseUrl)
    .replace(/EXPS_URL_PLACEHOLDER/g, expsUrl)
    .replace(/APP_NAME_PLACEHOLDER/g, appName);

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(html);
}

function configureExpoAndLanding(app: express.Application) {
  const templatePath = path.resolve(
    process.cwd(),
    "server",
    "templates",
    "landing-page.html",
  );
  const landingPageTemplate = fs.readFileSync(templatePath, "utf-8");
  const appName = getAppName();

  log("Serving static Expo files with dynamic manifest routing");

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith("/api")) {
      return next();
    }

    if (req.path !== "/" && req.path !== "/manifest") {
      return next();
    }

    const platform = req.header("expo-platform");
    if (platform && (platform === "ios" || platform === "android")) {
      return serveExpoManifest(platform, res);
    }

    if (req.path === "/") {
      return serveLandingPage({
        req,
        res,
        landingPageTemplate,
        appName,
      });
    }

    next();
  });

  app.use("/assets", express.static(path.resolve(process.cwd(), "assets")));
  app.use(express.static(path.resolve(process.cwd(), "static-build")));

  log("Expo routing: Checking expo-platform header on / and /manifest");
}

function setupErrorHandler(app: express.Application) {
  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    const error = err as {
      status?: number;
      statusCode?: number;
      message?: string;
    };

    const status = error.status || error.statusCode || 500;
    const message = error.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });
}

(async () => {
  assertSecurityConfig();
  assertOtpConfig();
  assertFirebaseConfig();
  console.log(describeSmsSetup());
  await storage.initialize(hashPassword);

  setupCors(app);
  setupBodyParsing(app);
  setupRequestLogging(app);

  setupAdminConsole(app);
  setupPublicPages(app);
  configureExpoAndLanding(app);

  const server = await registerRoutes(app);

  setupErrorHandler(app);

  const port = parseInt(process.env.PORT || "5000", 10);
  server.listen(
    {
      port,
      host: "0.0.0.0",
    },
    () => {
      log(`express server serving on port ${port}`);
    },
  );
})();
