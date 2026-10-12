// IPTV routes: M3U playlists, Xtream Codes accounts and XMLTV guides. The user
// supplies their own playlist URL or account; credentials arrive in POST bodies
// so they never end up in URLs, access logs or browser history.
import { Router, type Response } from "express";
import { Readable } from "node:stream";
import { parseM3U, type Channel } from "../lib/m3u.js";
import { maybeGunzip, parseXmltv, type Guide } from "../lib/xmltv.js";
import {
  apiUrl,
  liveUrl,
  redactCredentials,
  seriesEpisodeUrl,
  vodUrl,
  xmltvUrl,
  type XtreamCategory,
  type XtreamCredentials,
  type XtreamLiveStream,
  type XtreamVodStream,
} from "../lib/xtream.js";

interface CacheEntry<T> {
  value: T;
  expires: number;
}

class TtlCache<T> {
  private readonly map = new Map<string, CacheEntry<T>>();
  constructor(private readonly ttlMs: number, private readonly max = 32) {}
  get(key: string): T | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (hit.expires < Date.now()) {
      this.map.delete(key);
      return undefined;
    }
    return hit.value;
  }
  set(key: string, value: T): void {
    if (this.map.size >= this.max) this.map.delete(this.map.keys().next().value!);
    this.map.set(key, { value, expires: Date.now() + this.ttlMs });
  }
}

const UA = "Marquee/0.1 (+https://github.com/)";

function parseCreds(body: unknown): XtreamCredentials | null {
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b.server !== "string" || typeof b.username !== "string" || typeof b.password !== "string") return null;
  if (!b.server.trim() || !b.username) return null;
  return { server: b.server, username: b.username, password: b.password };
}

function groupsOf(channels: Channel[]): Array<{ name: string; count: number }> {
  const counts = new Map<string, number>();
  for (const c of channels) for (const g of c.group.length ? c.group : ["Uncategorized"]) counts.set(g, (counts.get(g) ?? 0) + 1);
  return [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name));
}

export function iptvRouter(fetchImpl: typeof fetch = fetch): Router {
  const router = Router();
  const playlists = new TtlCache<{ epgUrls: string[]; channels: Channel[] }>(10 * 60_000);
  const guides = new TtlCache<Guide>(30 * 60_000, 8);

  async function fetchText(url: string, headers: Record<string, string> = {}): Promise<string> {
    const res = await fetchImpl(url, { headers: { "User-Agent": UA, ...headers } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  }

  async function loadPlaylist(url: string) {
    const cached = playlists.get(url);
    if (cached) return cached;
    const parsed = parseM3U(await fetchText(url));
    playlists.set(url, parsed);
    return parsed;
  }

  async function loadGuide(url: string, channelIds: Set<string> | undefined, hours: number): Promise<Guide> {
    const key = `${url}#${hours}#${channelIds ? [...channelIds].sort().join(",") : "*"}`;
    const cached = guides.get(key);
    if (cached) return cached;
    const res = await fetchImpl(url, { headers: { "User-Agent": UA } });
    if (!res.ok || !res.body) throw new Error(`EPG HTTP ${res.status}`);
    const stream = await maybeGunzip(Readable.fromWeb(res.body as import("node:stream/web").ReadableStream));
    const now = Date.now();
    const guide = await parseXmltv(stream, {
      from: now - 60 * 60_000,
      to: now + hours * 60 * 60_000,
      ...(channelIds ? { channelIds } : {}),
    });
    guides.set(key, guide);
    return guide;
  }

  const fail = (res: Response, err: unknown, creds?: XtreamCredentials) => {
    const message = (err as Error).message ?? "Request failed";
    res.status(502).json({ error: creds ? redactCredentials(message, creds) : message });
  };

  router.post("/m3u", async (req, res) => {
    const url = (req.body ?? {}).url;
    if (typeof url !== "string" || !/^https?:\/\//i.test(url)) {
      res.status(400).json({ error: "A playlist http(s) URL is required" });
      return;
    }
    try {
      const playlist = await loadPlaylist(url);
      res.json({ ...playlist, groups: groupsOf(playlist.channels) });
    } catch (err) {
      fail(res, err);
    }
  });

  router.post("/epg", async (req, res) => {
    const body = (req.body ?? {}) as { url?: string; channels?: string[]; hours?: number };
    if (typeof body.url !== "string" || !/^https?:\/\//i.test(body.url)) {
      res.status(400).json({ error: "An XMLTV http(s) URL is required" });
      return;
    }
    const ids = Array.isArray(body.channels) ? new Set(body.channels.filter((c) => typeof c === "string")) : undefined;
    try {
      res.json(await loadGuide(body.url, ids?.size ? ids : undefined, Math.min(Math.max(body.hours ?? 6, 1), 48)));
    } catch (err) {
      fail(res, err);
    }
  });

  router.post("/xtream/account", async (req, res) => {
    const creds = parseCreds(req.body);
    if (!creds) {
      res.status(400).json({ error: "server, username and password are required" });
      return;
    }
    try {
      const info = JSON.parse(await fetchText(apiUrl(creds))) as {
        user_info?: { auth?: number; status?: string; exp_date?: string | null; max_connections?: string; active_cons?: string };
        server_info?: { url?: string; timezone?: string };
      };
      if (!info.user_info || info.user_info.auth === 0) {
        res.status(401).json({ error: "The IPTV server rejected these credentials" });
        return;
      }
      res.json({
        status: info.user_info.status ?? null,
        expires: info.user_info.exp_date ? new Date(Number(info.user_info.exp_date) * 1000).toISOString() : null,
        maxConnections: Number(info.user_info.max_connections ?? 0) || null,
        activeConnections: Number(info.user_info.active_cons ?? 0),
        timezone: info.server_info?.timezone ?? null,
        epgUrl: xmltvUrl(creds),
      });
    } catch (err) {
      fail(res, err, creds);
    }
  });

  router.post("/xtream/:kind", async (req, res) => {
    const creds = parseCreds(req.body);
    const kind = req.params.kind;
    if (!creds || !["live", "vod", "series"].includes(kind)) {
      res.status(400).json({ error: "Expected kind live|vod|series and credentials" });
      return;
    }
    try {
      const catAction = kind === "live" ? "get_live_categories" : kind === "vod" ? "get_vod_categories" : "get_series_categories";
      const listAction = kind === "live" ? "get_live_streams" : kind === "vod" ? "get_vod_streams" : "get_series";
      const [categories, items] = await Promise.all([
        fetchText(apiUrl(creds, catAction)).then((t) => JSON.parse(t) as XtreamCategory[]),
        fetchText(apiUrl(creds, listAction)).then((t) => JSON.parse(t) as Array<Record<string, unknown>>),
      ]);
      const catName = new Map((categories ?? []).map((c) => [String(c.category_id), c.category_name]));
      if (kind === "series") {
        res.json({
          groups: (categories ?? []).map((c) => ({ name: c.category_name, id: String(c.category_id) })),
          series: (items ?? []).map((s) => ({
            id: String(s.series_id),
            name: String(s.name ?? ""),
            poster: typeof s.cover === "string" ? s.cover : undefined,
            plot: typeof s.plot === "string" ? s.plot : undefined,
            rating: s.rating ?? undefined,
            group: catName.get(String(s.category_id)) ?? "Uncategorized",
          })),
        });
        return;
      }
      const channels: Channel[] = (items ?? []).map((raw) => {
        const s = raw as unknown as XtreamLiveStream & XtreamVodStream;
        const url =
          kind === "live" ? liveUrl(creds, s.stream_id) : vodUrl(creds, s.stream_id, s.container_extension || "mp4");
        return {
          id: `xt-${kind}-${s.stream_id}`,
          name: s.name,
          url,
          ...(s.stream_icon ? { logo: s.stream_icon } : {}),
          ...(s.epg_channel_id ? { tvgId: s.epg_channel_id } : {}),
          group: [catName.get(String(s.category_id)) ?? "Uncategorized"],
          duration: -1,
        };
      });
      res.json({ channels, groups: groupsOf(channels), epgUrls: kind === "live" ? [xmltvUrl(creds)] : [] });
    } catch (err) {
      fail(res, err, creds);
    }
  });

  router.post("/xtream/series/:id", async (req, res) => {
    const creds = parseCreds(req.body);
    if (!creds) {
      res.status(400).json({ error: "credentials required" });
      return;
    }
    try {
      const info = JSON.parse(await fetchText(apiUrl(creds, "get_series_info", { series_id: req.params.id }))) as {
        info?: Record<string, unknown>;
        episodes?: Record<string, Array<{ id: string; title: string; episode_num: number; container_extension?: string; info?: { plot?: string; movie_image?: string; duration_secs?: number } }>>;
      };
      const episodes = Object.entries(info.episodes ?? {}).flatMap(([season, list]) =>
        list.map((ep) => ({
          id: ep.id,
          season: Number(season),
          episode: Number(ep.episode_num),
          title: ep.title,
          plot: ep.info?.plot,
          thumbnail: ep.info?.movie_image,
          url: seriesEpisodeUrl(creds, ep.id, ep.container_extension || "mp4"),
        })),
      );
      res.json({ info: info.info ?? {}, episodes });
    } catch (err) {
      fail(res, err, creds);
    }
  });

  return router;
}
