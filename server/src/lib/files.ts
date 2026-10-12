// Helpers for choosing the right file inside a multi-file torrent or debrid
// transfer. Shared by the torrent engine and every debrid provider.

const VIDEO_EXT = /\.(mkv|mp4|m4v|avi|mov|wmv|webm|ts|m2ts|mpg|mpeg|flv|ogv)$/i;
const SAMPLE_RE = /(^|[\W_])(sample|trailer|featurette|extras?)([\W_]|$)/i;

export interface FileLike {
  name: string;
  length: number;
}

export function isVideoFile(name: string): boolean {
  return VIDEO_EXT.test(name);
}

function episodeMatches(name: string, season: number, episode: number): boolean {
  const base = name.split(/[\\/]/).pop() ?? name;
  const s = String(season);
  const e = String(episode);
  const patterns = [
    new RegExp(`s0*${s}[ ._-]*e0*${e}(?!\\d)`, "i"),
    new RegExp(`(^|\\D)0*${s}x0*${e}(?!\\d)`, "i"),
    new RegExp(`season[ ._-]*0*${s}.*episode[ ._-]*0*${e}(?!\\d)`, "i"),
  ];
  if (patterns.some((p) => p.test(base))) return true;
  // Fall back to the full path, for "Season 1/Episode 02.mkv" style layouts.
  return patterns.some((p) => p.test(name));
}

/**
 * Pick a file index. Preference order: explicit filename hint, season/episode
 * match, then the largest non-sample video file.
 */
export function guessFileIndex(
  files: FileLike[],
  hint: { filename?: string; season?: number; episode?: number } = {},
): number {
  if (!files.length) return -1;
  if (hint.filename) {
    const wanted = hint.filename.toLowerCase();
    const exact = files.findIndex((f) => (f.name.split(/[\\/]/).pop() ?? f.name).toLowerCase() === wanted);
    if (exact !== -1) return exact;
  }
  const videos = files
    .map((f, idx) => ({ f, idx }))
    .filter(({ f }) => isVideoFile(f.name));
  const pool = videos.length ? videos : files.map((f, idx) => ({ f, idx }));
  if (hint.season !== undefined && hint.episode !== undefined) {
    const matches = pool.filter(({ f }) => episodeMatches(f.name, hint.season!, hint.episode!));
    if (matches.length) return matches.sort((a, b) => b.f.length - a.f.length)[0]!.idx;
  }
  const nonSample = pool.filter(({ f }) => !SAMPLE_RE.test(f.name));
  const candidates = nonSample.length ? nonSample : pool;
  return candidates.sort((a, b) => b.f.length - a.f.length)[0]!.idx;
}

export function buildMagnet(infoHash: string, trackers: string[] = [], name?: string): string {
  const params = [`xt=urn:btih:${infoHash}`];
  if (name) params.push(`dn=${encodeURIComponent(name)}`);
  for (const tr of trackers) params.push(`tr=${encodeURIComponent(tr)}`);
  return `magnet:?${params.join("&")}`;
}

/** Stremio stream `sources` use `tracker:<url>` and `dht:<hash>` prefixes. */
export function trackersFromSources(sources: string[] | undefined): string[] {
  return (sources ?? [])
    .filter((s) => s.startsWith("tracker:"))
    .map((s) => s.slice("tracker:".length));
}

export const DEFAULT_TRACKERS = [
  "udp://tracker.opentrackr.org:1337/announce",
  "udp://open.demonii.com:1337/announce",
  "udp://open.stealth.si:80/announce",
  "udp://tracker.torrent.eu.org:451/announce",
  "udp://exodus.desync.com:6969/announce",
  "udp://explodie.org:6969/announce",
  "udp://tracker.openbittorrent.com:6969/announce",
  "wss://tracker.openwebtorrent.com",
];
