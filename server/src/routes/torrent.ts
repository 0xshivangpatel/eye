// Stremio-compatible torrent routes: /:infoHash/create, /:infoHash/:idx, stats.
import { Router, type Request } from "express";
import { EngineManager } from "../torrent/engines.js";
import { serveRange } from "../lib/range.js";
import { trackersFromSources } from "../lib/files.js";

function queryList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  return typeof value === "string" ? [value] : [];
}

function numberOrUndefined(value: unknown): number | undefined {
  const n = typeof value === "string" || typeof value === "number" ? Number(value) : Number.NaN;
  return Number.isFinite(n) ? n : undefined;
}

function hintFromQuery(req: Request) {
  const season = numberOrUndefined(req.query.season);
  const episode = numberOrUndefined(req.query.episode);
  const filename = typeof req.query.filename === "string" ? req.query.filename : undefined;
  return {
    ...(season !== undefined ? { season } : {}),
    ...(episode !== undefined ? { episode } : {}),
    ...(filename ? { filename } : {}),
  };
}

export function torrentRouter(engines: EngineManager): Router {
  const router = Router();

  router.param("infoHash", (req, _res, next, value: string) => {
    const hash = EngineManager.normalizeHash(value);
    if (!hash) return next("route");
    req.params.infoHash = hash;
    next();
  });

  router.get("/stats.json", (_req, res) => {
    const out: Record<string, unknown> = {};
    for (const hash of engines.list()) out[hash] = engines.stats(hash);
    res.json(out);
  });

  router.get("/removeAll", async (_req, res) => {
    await engines.removeAll();
    res.json({});
  });

  router.all("/:infoHash/create", async (req, res) => {
    const infoHash = req.params.infoHash!;
    const body = (req.body ?? {}) as {
      peerSearch?: { sources?: string[] };
      sources?: string[];
      guessFileIdx?: { season?: number; episode?: number } | boolean;
      filename?: string;
      peers?: string[];
    };
    const trackers = trackersFromSources(body.peerSearch?.sources ?? body.sources);
    const entry = engines.create(infoHash, { trackers, ...(body.peers ? { peers: body.peers } : {}) });
    try {
      await entry.ready;
    } catch (err) {
      res.status(504).json({ error: (err as Error).message });
      return;
    }
    const stats = engines.stats(infoHash) ?? {};
    if (body.guessFileIdx || body.filename) {
      const hint = typeof body.guessFileIdx === "object" ? body.guessFileIdx : {};
      stats.guessedFileIdx = engines.resolveFileIndex(entry, -1, {
        ...hint,
        ...(body.filename ? { filename: body.filename } : {}),
      });
    }
    res.json(stats);
  });

  router.get("/:infoHash/stats.json", (req, res) => {
    res.json(engines.stats(req.params.infoHash!) ?? {});
  });

  router.get("/:infoHash/remove", async (req, res) => {
    await engines.remove(req.params.infoHash!);
    res.json({});
  });

  router.get("/:infoHash/:idx/stats.json", (req, res) => {
    res.json(engines.stats(req.params.infoHash!, Number(String(req.params.idx))) ?? {});
  });

  const stream = async (req: Request, res: import("express").Response) => {
    const infoHash = String(req.params.infoHash);
    const trackers = [...queryList(req.query.tr), ...trackersFromSources(queryList(req.query.source))];
    const peers = queryList(req.query.peer);
    const entry = engines.create(infoHash, { trackers, peers });
    try {
      await entry.ready;
    } catch (err) {
      res.status(504).json({ error: (err as Error).message });
      return;
    }
    const idx = engines.resolveFileIndex(entry, Number(String(req.params.idx)), hintFromQuery(req));
    const file = entry.engine.files[idx];
    if (!file) {
      res.status(404).json({ error: "No such file in torrent" });
      return;
    }
    file.select();
    const release = engines.retain(infoHash);
    res.on("close", release);
    await serveRange(req, res, {
      size: file.length,
      name: file.name,
      createStream: ({ start, end }) => file.createReadStream({ start, end }),
    });
  };

  router.get("/:infoHash/:idx", stream);
  router.get("/:infoHash/:idx/{*rest}", stream);
  return router;
}
