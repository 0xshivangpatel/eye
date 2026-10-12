import { Router, type RequestHandler, type Response } from "express";
import type { SettingsStore } from "../settings.js";
import type { DebridService } from "../debrid/service.js";
import { DebridApiError, DebridAuthError, type ResolveRequest } from "../debrid/types.js";
import { pollDeviceAuth, startDeviceAuth } from "../debrid/realdebrid.js";
import { EngineManager } from "../torrent/engines.js";
import { trackersFromSources } from "../lib/files.js";

function sendError(res: Response, err: unknown): void {
  if (err instanceof DebridAuthError) {
    res.status(401).json({ error: err.message, code: "debrid_auth" });
  } else if (err instanceof DebridApiError) {
    res.status(502).json({ error: err.message, code: "debrid_api", upstreamStatus: err.status, upstreamCode: err.code });
  } else {
    res.status(500).json({ error: (err as Error).message ?? "Unknown error" });
  }
}

function parseResolveRequest(input: Record<string, unknown>): ResolveRequest | null {
  const infoHash = typeof input.infoHash === "string" ? EngineManager.normalizeHash(input.infoHash) : null;
  if (!infoHash) return null;
  const num = (v: unknown) => {
    const n = typeof v === "string" || typeof v === "number" ? Number(v) : Number.NaN;
    return Number.isFinite(n) ? n : undefined;
  };
  const fileIdx = num(input.fileIdx);
  const season = num(input.season);
  const episode = num(input.episode);
  const sources = Array.isArray(input.sources) ? input.sources.filter((s): s is string => typeof s === "string") : [];
  return {
    infoHash,
    ...(fileIdx !== undefined ? { fileIdx } : {}),
    ...(season !== undefined ? { season } : {}),
    ...(episode !== undefined ? { episode } : {}),
    ...(typeof input.filename === "string" && input.filename ? { filename: input.filename } : {}),
    trackers: trackersFromSources(sources),
  };
}

export interface DebridRouterDeps {
  requireAdmin: RequestHandler;
  allowPlayback: RequestHandler;
  shareDebrid: boolean;
  fetchImpl?: typeof fetch;
}

export function debridRouter(settings: SettingsStore, debrid: DebridService, deps: DebridRouterDeps): Router {
  const { requireAdmin, allowPlayback } = deps;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const router = Router();

  // Non-sensitive: lets any client (including peers) know whether the server
  // can resolve debrid links, without revealing the account or the token.
  router.get("/available", (_req, res) => {
    const creds = settings.get().debrid;
    res.json({ configured: creds !== null, provider: creds?.provider ?? null, shared: deps.shareDebrid });
  });

  router.get("/status", requireAdmin, async (_req, res) => {
    const creds = settings.get().debrid;
    if (!creds) {
      res.json({ configured: false });
      return;
    }
    try {
      const provider = await debrid.current();
      const user = await provider!.getUser();
      res.json({ configured: true, provider: creds.provider, user, preferred: settings.get().debridPreferred });
    } catch (err) {
      if (err instanceof DebridAuthError) {
        res.json({ configured: true, provider: creds.provider, error: "Token rejected; link your account again" });
        return;
      }
      sendError(res, err);
    }
  });

  router.post("/token", requireAdmin, async (req, res) => {
    const { provider = "realdebrid", token } = (req.body ?? {}) as { provider?: string; token?: string };
    if (provider !== "realdebrid" || typeof token !== "string" || !token.trim()) {
      res.status(400).json({ error: "Expected { provider: 'realdebrid', token }" });
      return;
    }
    try {
      const user = await debrid.build(provider, token.trim()).getUser();
      settings.setDebrid({ provider: "realdebrid", token: token.trim() });
      res.json({ configured: true, provider, user });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.post("/device/start", requireAdmin, async (_req, res) => {
    try {
      const code = await startDeviceAuth(fetchImpl);
      res.json(code);
    } catch (err) {
      sendError(res, err);
    }
  });

  router.post("/device/poll", requireAdmin, async (req, res) => {
    const deviceCode = (req.body ?? {}).device_code;
    if (typeof deviceCode !== "string") {
      res.status(400).json({ error: "device_code required" });
      return;
    }
    try {
      const tokens = await pollDeviceAuth(deviceCode, fetchImpl);
      if (!tokens) {
        res.json({ status: "pending" });
        return;
      }
      settings.setDebrid({
        provider: "realdebrid",
        token: tokens.accessToken,
        oauth: {
          clientId: tokens.clientId,
          clientSecret: tokens.clientSecret,
          refreshToken: tokens.refreshToken,
          expiresAt: tokens.expiresAt,
        },
      });
      const user = await (await debrid.current())!.getUser();
      res.json({ status: "linked", user });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.delete("/", requireAdmin, (_req, res) => {
    settings.setDebrid(null);
    res.json({ configured: false });
  });

  router.post("/resolve", allowPlayback, async (req, res) => {
    const request = parseResolveRequest((req.body ?? {}) as Record<string, unknown>);
    if (!request) {
      res.status(400).json({ error: "A 40-character infoHash is required" });
      return;
    }
    try {
      const provider = await debrid.current();
      if (!provider) {
        res.status(409).json({ error: "No debrid account configured", code: "debrid_missing" });
        return;
      }
      res.json(await provider.resolve(request));
    } catch (err) {
      sendError(res, err);
    }
  });

  // Redirecting variant, convenient for external players and casting devices.
  router.get("/play/:infoHash/:fileIdx", allowPlayback, async (req, res) => {
    const request = parseResolveRequest({ ...req.query, infoHash: req.params.infoHash, fileIdx: req.params.fileIdx });
    if (!request) {
      res.status(400).json({ error: "Invalid infoHash" });
      return;
    }
    try {
      const provider = await debrid.current();
      if (!provider) {
        res.status(409).json({ error: "No debrid account configured" });
        return;
      }
      const result = await provider.resolve(request);
      if (result.status === "ready") res.redirect(302, result.url);
      else res.status(result.status === "error" ? 502 : 202).json(result);
    } catch (err) {
      sendError(res, err);
    }
  });

  router.get("/cloud", requireAdmin, async (_req, res) => {
    try {
      const provider = await debrid.current();
      res.json(provider ? await provider.listCloud() : []);
    } catch (err) {
      sendError(res, err);
    }
  });

  router.get("/cloud/:id/links", requireAdmin, async (req, res) => {
    try {
      const provider = await debrid.current();
      if (!provider) {
        res.status(409).json({ error: "No debrid account configured" });
        return;
      }
      res.json(await provider.cloudLinks(String(req.params.id)));
    } catch (err) {
      sendError(res, err);
    }
  });

  return router;
}
