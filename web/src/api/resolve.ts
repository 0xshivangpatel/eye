// Turns an add-on Stream descriptor into something the player can open.
import type { Stream } from "./types";
import { serverApi, type ResolveSeed } from "./server";

export interface PlayableSource {
  /** The URL the <video> or hls.js will load. */
  url: string;
  kind: "file" | "hls" | "external" | "youtube";
  filename?: string;
  /** True once a debrid/torrent link is fully resolved (safe to transcode). */
  direct: boolean;
}

export type ResolveProgressCb = (message: string, progress: number) => void;

export function seedFromStream(stream: Stream, hint: { season?: number; episode?: number } = {}): ResolveSeed | null {
  if (!stream.infoHash) return null;
  return {
    infoHash: stream.infoHash.toLowerCase(),
    ...(stream.fileIdx !== undefined ? { fileIdx: stream.fileIdx } : {}),
    ...(stream.behaviorHints?.filename ? { filename: stream.behaviorHints.filename } : {}),
    ...(hint.season !== undefined ? { season: hint.season } : {}),
    ...(hint.episode !== undefined ? { episode: hint.episode } : {}),
    ...(stream.sources ? { sources: stream.sources } : {}),
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Resolve a stream, preferring debrid when the server offers it. For torrents
 * not on debrid, fall back to the local torrent engine. Direct URLs and
 * YouTube pass straight through.
 */
export async function resolveStream(
  stream: Stream,
  opts: {
    hint?: { season?: number; episode?: number };
    debridAvailable: boolean;
    debridPreferred: boolean;
    onProgress?: ResolveProgressCb;
    signal?: AbortSignal;
  },
): Promise<PlayableSource> {
  if (stream.ytId) return { url: stream.ytId, kind: "youtube", direct: false };
  if (stream.url) {
    const isHls = /\.m3u8(\?|$)/i.test(stream.url);
    const headers = stream.behaviorHints?.proxyHeaders?.request;
    // Route through the proxy when the source needs headers or when it is HLS
    // (so the playlist's segments get proxied too).
    const needsProxy = Boolean(headers) || isHls || stream.behaviorHints?.notWebReady;
    const url = needsProxy ? serverApi.proxyUrl(stream.url, headers) : stream.url;
    return { url, kind: isHls ? "hls" : "file", direct: !needsProxy, ...(stream.behaviorHints?.filename ? { filename: stream.behaviorHints.filename } : {}) };
  }
  const seed = seedFromStream(stream, opts.hint);
  if (!seed) throw new Error("This stream has no playable source");

  if (opts.debridAvailable && opts.debridPreferred) {
    for (let attempt = 0; attempt < 40; attempt++) {
      if (opts.signal?.aborted) throw new Error("cancelled");
      const result = await serverApi.resolveDebrid(seed);
      if (result.status === "ready") {
        return { url: result.url, kind: "file", filename: result.filename, direct: true };
      }
      if (result.status === "error") {
        // Fall back to the local engine instead of failing outright.
        opts.onProgress?.("Debrid could not provide this; using peer-to-peer…", 0);
        break;
      }
      opts.onProgress?.(result.message, result.progress);
      await sleep(2000);
    }
  }

  // Local torrent engine streaming.
  const url = serverApi.torrentStreamUrl(seed);
  return { url, kind: "file", direct: true, ...(seed.filename ? { filename: seed.filename } : {}) };
}

/** Decide whether the browser can play a direct file, else return a transcode URL. */
export async function ensureBrowserPlayable(source: PlayableSource, maxWidth = 1920): Promise<PlayableSource> {
  if (!source.direct || source.kind !== "file") return source;
  try {
    const probe = await serverApi.probe(source.url);
    if (probe.browserPlayable) return source;
    return { ...source, url: serverApi.transcodeUrl(source.url, { maxWidth }), kind: "file", direct: false };
  } catch {
    // If probing fails, optimistically try the original; the player will fall
    // back to transcoding on a decode error.
    return source;
  }
}
