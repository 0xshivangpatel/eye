import express, { type NextFunction, type Request, type Response } from "express";
import { timingSafeEqual as cryptoTimingSafeEqual } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SettingsStore, appDir } from "./settings.js";
import { EngineManager } from "./torrent/engines.js";
import { DebridService } from "./debrid/service.js";
import { torrentRouter } from "./routes/torrent.js";
import { debridRouter } from "./routes/debrid.js";
import { mediaRouter } from "./routes/media.js";
import { iptvRouter } from "./routes/iptv.js";
import { openMoviesRouter } from "./addon/openMovies.js";
import { attachParty } from "./party/ws.js";
import { AccountStore } from "./accounts.js";
import { SessionManager } from "./auth.js";
import { authRouter } from "./routes/auth.js";
import type { RealDebridOptions } from "./debrid/realdebrid.js";

export interface AppOptions {
  settingsFile?: string;
  cacheRoot?: string;
  webRoot?: string | null;
  ffmpeg?: string;
  ffprobe?: string;
  fetchImpl?: typeof fetch;
  realDebrid?: RealDebridOptions & { oauthBase?: string };
  /** Extra allowed CORS origins in addition to localhost/LAN defaults. */
  allowedOrigins?: string[];
  engine?: { readyTimeoutMs?: number; idleTimeoutMs?: number; dht?: boolean };
  /** Shared secret that grants admin access from non-loopback clients. */
  adminToken?: string | null;
  /** Let remote peers resolve streams through the server's debrid account. */
  shareDebrid?: boolean;
  /** Where the user-accounts file lives (defaults under appDir). */
  accountsFile?: string;
}

const PRIVATE_HOST = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/;

export function isAllowedOrigin(origin: string, extra: string[]): boolean {
  if (extra.includes(origin)) return true;
  try {
    const url = new URL(origin);
    return (url.protocol === "http:" || url.protocol === "https:") && PRIVATE_HOST.test(url.hostname);
  } catch {
    return false;
  }
}

export function isLoopback(address: string | undefined): boolean {
  if (!address) return false;
  return address === "::1" || address.startsWith("127.") || address.startsWith("::ffff:127.");
}

function timingSafeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return cryptoTimingSafeEqual(ab, bb);
}

export function isAdminRequest(req: Request, adminToken: string | null): boolean {
  if (process.env.MARQUEE_TRUST_LAN === "1") return true;
  if (isLoopback(req.socket.remoteAddress)) return true;
  if (adminToken) {
    const header = req.headers["x-marquee-admin"];
    const bearer = typeof req.headers.authorization === "string" && req.headers.authorization.startsWith("Bearer ")
      ? req.headers.authorization.slice(7)
      : undefined;
    const supplied = (typeof header === "string" ? header : undefined) ?? bearer ?? (typeof req.query.admin === "string" ? req.query.admin : undefined);
    if (supplied && timingSafeEqual(supplied, adminToken)) return true;
  }
  return false;
}

export function createServer(options: AppOptions = {}) {
  const settings = new SettingsStore(options.settingsFile);
  const cacheRoot = options.cacheRoot ?? path.join(appDir(), "cache");
  fs.mkdirSync(cacheRoot, { recursive: true });
  const engines = new EngineManager(settings, cacheRoot, options.engine);
  const debrid = new DebridService(settings, {
    ...options.realDebrid,
    ...(options.fetchImpl && !options.realDebrid?.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });
  const allowed = [
    ...(options.allowedOrigins ?? []),
    ...(process.env.MARQUEE_ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  ];
  const adminToken = options.adminToken ?? process.env.MARQUEE_ADMIN_TOKEN ?? null;
  const trustLan = process.env.MARQUEE_TRUST_LAN === "1";

  // Private app: every account is created by the admin (no public sign-up). The
  // seeded admin can log in from a browser; a loopback request or the admin
  // token also act as admin for headless/VPS setup.
  const accounts = new AccountStore(options.accountsFile);
  const loopbackAdmin = process.env.MARQUEE_DISABLE_LOOPBACK_ADMIN !== "1";
  const sessions = new SessionManager(adminToken, trustLan, loopbackAdmin);
  // Any signed-in user may watch (resolve streams); admins configure the server.
  const requireAuth = sessions.requireAuth;
  const requireAdmin = sessions.requireAdmin;

  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", "loopback");

  app.use((req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    if (origin && isAllowedOrigin(origin, allowed)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, POST, DELETE, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Range");
      res.setHeader("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges");
      // Chrome's Private Network Access preflight for public pages calling localhost.
      if (req.headers["access-control-request-private-network"]) res.setHeader("Access-Control-Allow-Private-Network", "true");
    }
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  });
  app.use(express.json({ limit: "1mb" }));

  // --- public endpoints ---
  app.get("/heartbeat", (_req, res) => {
    res.json({ success: true });
  });
  app.use("/auth", authRouter(accounts, sessions));

  // Serve the built web client (public, so the login screen can load). The SPA
  // itself calls the protected APIs and shows the login page on a 401.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const webRoot = options.webRoot === undefined ? path.resolve(here, "../../web/dist") : options.webRoot;
  if (webRoot && fs.existsSync(path.join(webRoot, "index.html"))) {
    app.use("/app", express.static(webRoot, { index: "index.html", maxAge: "1h" }));
    app.get("/app/{*rest}", (_req, res) => res.sendFile(path.join(webRoot, "index.html")));
    app.get("/", (_req, res) => res.redirect(302, "/app/"));
  }

  // --- everything below requires a signed-in account ---
  app.get("/settings", requireAuth, (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({ values: settings.publicView(), serverVersion: "0.1.0", app: "marquee" });
  });
  app.post("/settings", requireAdmin, (req, res) => {
    settings.update((req.body ?? {}) as Record<string, unknown>);
    res.json({ success: true, values: settings.publicView() });
  });
  app.get("/network-info", requireAuth, (_req, res) => {
    const availableInterfaces = Object.values(os.networkInterfaces())
      .flat()
      .filter((a) => a && !a.internal && a.family === "IPv4")
      .map((a) => a!.address);
    res.setHeader("Cache-Control", "no-store");
    res.json({ availableInterfaces });
  });

  // Debrid: any signed-in user may resolve streams; only admins configure it.
  app.use("/debrid", requireAuth, debridRouter(settings, debrid, { requireAdmin, allowPlayback: requireAuth, shareDebrid: true, fetchImpl: options.fetchImpl }));
  app.use("/iptv", requireAuth, iptvRouter(options.fetchImpl));
  app.use("/addon/open-movies", requireAuth, openMoviesRouter());
  app.use(
    "/",
    requireAuth,
    mediaRouter({
      ffmpeg: options.ffmpeg ?? process.env.FFMPEG_BIN ?? "ffmpeg",
      ffprobe: options.ffprobe ?? process.env.FFPROBE_BIN ?? "ffprobe",
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    }),
  );

  // Torrent routes last: their /:infoHash patterns would shadow everything else.
  app.use("/", requireAuth, torrentRouter(engines));

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  });

  const server = http.createServer(app);
  // Watch-together requires a signed-in account (or the headless admin bypass).
  const party = attachParty(server, "/party", undefined, (req) => sessions.authorizeSocket(req));
  return {
    app,
    server,
    settings,
    engines,
    debrid,
    accounts,
    sessions,
    party,
    async close() {
      party.close();
      await engines.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
