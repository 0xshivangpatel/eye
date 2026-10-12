// Client for the Marquee streaming server (the clean-room Stremio server).
// In dev, Vite proxies these paths to :11470; in production the app is served
// by the server itself, so same-origin.

export interface DebridAvailable {
  configured: boolean;
  provider: string | null;
  shared: boolean;
}

export interface ResolveReady {
  status: "ready";
  url: string;
  filename: string;
  size: number;
  mimeType?: string;
}
export interface ResolveProgress {
  status: "queued" | "downloading" | "converting";
  progress: number;
  speed?: number;
  seeders?: number;
  message: string;
}
export interface ResolveError {
  status: "error";
  message: string;
}
export type ResolveResult = ResolveReady | ResolveProgress | ResolveError;

export interface ProbeResult {
  duration: number | null;
  container: string | null;
  video: { codec: string; width?: number; height?: number; pixFmt?: string } | null;
  audio: Array<{ index: number; codec: string; channels?: number; language?: string; title?: string }>;
  subtitles: Array<{ index: number; codec: string; language?: string; title?: string }>;
  browserPlayable: boolean;
}

export interface ResolveSeed {
  infoHash: string;
  fileIdx?: number;
  filename?: string;
  season?: number;
  episode?: number;
  sources?: string[];
}

function adminHeaders(): Record<string, string> {
  try {
    const token = localStorage.getItem("marquee.adminToken");
    return token ? { "x-marquee-admin": token } : {};
  } catch {
    return {};
  }
}

async function json<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    ...init,
    headers: { "Content-Type": "application/json", ...adminHeaders(), ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      message = ((await res.json()) as { error?: string }).error ?? message;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

export const serverApi = {
  heartbeat: () => json<{ success: boolean }>("/heartbeat"),
  settings: () => json<{ values: Record<string, unknown>; app: string }>("/settings"),
  debridAvailable: () => json<DebridAvailable>("/debrid/available"),
  debridStatus: () => json<{ configured: boolean; provider?: string; user?: { username: string; premium: boolean; expiration?: string }; error?: string }>("/debrid/status"),
  setDebridToken: (token: string) =>
    json<{ configured: boolean; user?: { username: string; premium: boolean } }>("/debrid/token", {
      method: "POST",
      body: JSON.stringify({ provider: "realdebrid", token }),
    }),
  clearDebrid: () => json<{ configured: boolean }>("/debrid/", { method: "DELETE" }),
  resolveDebrid: (seed: ResolveSeed) => json<ResolveResult>("/debrid/resolve", { method: "POST", body: JSON.stringify(seed) }),
  probe: (url: string) => json<ProbeResult>(`/probe?url=${encodeURIComponent(url)}`),

  /** Build a streaming URL for a torrent stream via the local engine. */
  torrentStreamUrl(seed: ResolveSeed): string {
    const params = new URLSearchParams();
    if (seed.fileIdx !== undefined) params.set("fileIdx", String(seed.fileIdx));
    if (seed.filename) params.set("filename", seed.filename);
    if (seed.season !== undefined) params.set("season", String(seed.season));
    if (seed.episode !== undefined) params.set("episode", String(seed.episode));
    for (const s of seed.sources ?? []) params.append("source", s);
    const idx = seed.fileIdx ?? 0;
    return `/${seed.infoHash}/${idx}?${params.toString()}`;
  },
  proxyUrl: (url: string, headers?: Record<string, string>) => {
    const params = new URLSearchParams({ url });
    if (headers && Object.keys(headers).length) params.set("headers", JSON.stringify(headers));
    return `/proxy?${params.toString()}`;
  },
  subtitleVttUrl: (from: string, offsetMs = 0) => `/subtitles.vtt?from=${encodeURIComponent(from)}&offset=${offsetMs}`,
  transcodeUrl: (url: string, opts: { t?: number; audio?: number; maxWidth?: number; copyVideo?: boolean } = {}) => {
    const params = new URLSearchParams({ url });
    if (opts.t) params.set("t", String(opts.t));
    if (opts.audio) params.set("audio", String(opts.audio));
    if (opts.maxWidth) params.set("maxWidth", String(opts.maxWidth));
    if (opts.copyVideo) params.set("copyVideo", "1");
    return `/transcode.mp4?${params.toString()}`;
  },
};

export interface IptvChannel {
  id: string;
  name: string;
  url: string;
  logo?: string;
  group: string[];
  tvgId?: string;
  headers?: Record<string, string>;
}

export const iptvApi = {
  loadM3U: (url: string) =>
    json<{ channels: IptvChannel[]; groups: Array<{ name: string; count: number }>; epgUrls: string[] }>("/iptv/m3u", {
      method: "POST",
      body: JSON.stringify({ url }),
    }),
  xtreamAccount: (creds: { server: string; username: string; password: string }) =>
    json<{ status: string | null; expires: string | null; epgUrl: string }>("/iptv/xtream/account", { method: "POST", body: JSON.stringify(creds) }),
  xtreamList: (kind: "live" | "vod" | "series", creds: { server: string; username: string; password: string }) =>
    json<{ channels?: IptvChannel[]; groups: Array<{ name: string; count?: number; id?: string }>; series?: unknown[]; epgUrls?: string[] }>(`/iptv/xtream/${kind}`, {
      method: "POST",
      body: JSON.stringify(creds),
    }),
  epg: (url: string, channels: string[], hours = 6) =>
    json<{ channels: Record<string, { name: string; icon?: string }>; programmes: Record<string, Array<{ start: number; stop: number; title: string; description?: string }>> }>("/iptv/epg", {
      method: "POST",
      body: JSON.stringify({ url, channels, hours }),
    }),
};
