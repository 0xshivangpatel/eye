// Media helpers: CORS/header proxy with HLS rewriting, subtitle conversion,
// ffprobe-based probing and ffmpeg transcoding to fragmented MP4.
import { Router, type Request, type Response } from "express";
import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { gunzipSync } from "node:zlib";
import { isHlsPlaylist, rewritePlaylist } from "../lib/hls.js";
import { decodeSubtitleBytes, toWebVtt } from "../lib/subtitles.js";

const HOP_HEADERS = ["content-type", "content-length", "content-range", "accept-ranges", "last-modified", "etag"];

export function parseHeaderParam(value: unknown): Record<string, string> | undefined {
  if (typeof value !== "string" || !value) return undefined;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) if (typeof v === "string") out[k] = v;
    return out;
  } catch {
    return undefined;
  }
}

function targetUrl(value: unknown): URL | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

export interface ProbeResult {
  duration: number | null;
  container: string | null;
  video: { codec: string; width?: number; height?: number; pixFmt?: string } | null;
  audio: Array<{ index: number; codec: string; channels?: number; language?: string; title?: string }>;
  subtitles: Array<{ index: number; codec: string; language?: string; title?: string }>;
  browserPlayable: boolean;
}

const BROWSER_VIDEO = new Set(["h264", "vp8", "vp9", "av1"]);
const BROWSER_AUDIO = new Set(["aac", "mp3", "opus", "vorbis", "flac"]);
const BROWSER_CONTAINERS = ["mp4", "mov", "webm", "matroska"];

export function summarizeProbe(json: {
  format?: { duration?: string; format_name?: string };
  streams?: Array<Record<string, unknown>>;
}): ProbeResult {
  const streams = json.streams ?? [];
  const tags = (s: Record<string, unknown>) => (s.tags ?? {}) as Record<string, string>;
  const video = streams.find((s) => s.codec_type === "video" && (s.disposition as { attached_pic?: number } | undefined)?.attached_pic !== 1);
  const audio = streams
    .filter((s) => s.codec_type === "audio")
    .map((s, i) => ({
      index: i,
      codec: String(s.codec_name ?? "unknown"),
      ...(typeof s.channels === "number" ? { channels: s.channels } : {}),
      ...(tags(s).language ? { language: tags(s).language } : {}),
      ...(tags(s).title ? { title: tags(s).title } : {}),
    }));
  const subtitles = streams
    .filter((s) => s.codec_type === "subtitle")
    .map((s, i) => ({
      index: i,
      codec: String(s.codec_name ?? "unknown"),
      ...(tags(s).language ? { language: tags(s).language } : {}),
      ...(tags(s).title ? { title: tags(s).title } : {}),
    }));
  const container = json.format?.format_name ?? null;
  const videoCodec = video ? String(video.codec_name ?? "") : "";
  const pixFmt = video && typeof video.pix_fmt === "string" ? video.pix_fmt : undefined;
  const containerOk = container ? BROWSER_CONTAINERS.some((c) => container.split(",").includes(c)) : false;
  const isMatroska = container?.includes("matroska") ?? false;
  const browserPlayable =
    containerOk &&
    (!video || (BROWSER_VIDEO.has(videoCodec) && (!pixFmt || pixFmt === "yuv420p"))) &&
    (audio.length === 0 || BROWSER_AUDIO.has(audio[0]!.codec)) &&
    // Chromium plays Matroska only with WebM codecs.
    (!isMatroska || videoCodec !== "h264" || audio.length === 0);
  const duration = json.format?.duration ? Number(json.format.duration) : null;
  return {
    duration: Number.isFinite(duration) ? duration : null,
    container,
    video: video
      ? {
          codec: videoCodec,
          ...(typeof video.width === "number" ? { width: video.width } : {}),
          ...(typeof video.height === "number" ? { height: video.height } : {}),
          ...(pixFmt ? { pixFmt } : {}),
        }
      : null,
    audio,
    subtitles,
    browserPlayable,
  };
}

function runFfprobe(url: string, ffprobe: string): Promise<ProbeResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffprobe, ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", url], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 30_000);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(err.trim() || `ffprobe exited with ${code}`));
      try {
        resolve(summarizeProbe(JSON.parse(out)));
      } catch (e) {
        reject(e);
      }
    });
  });
}

export function mediaRouter(opts: { ffmpeg: string; ffprobe: string; fetchImpl?: typeof fetch }): Router {
  const router = Router();
  const fetchImpl = opts.fetchImpl ?? fetch;

  router.get("/proxy", async (req: Request, res: Response) => {
    const target = targetUrl(req.query.url);
    if (!target) {
      res.status(400).json({ error: "url must be http(s)" });
      return;
    }
    const headers = parseHeaderParam(req.query.headers) ?? {};
    const forward: Record<string, string> = { ...headers };
    if (req.headers.range) forward.Range = req.headers.range;
    let upstream: globalThis.Response;
    try {
      upstream = await fetchImpl(target, { headers: forward, redirect: "follow" });
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
      return;
    }
    const contentType = upstream.headers.get("content-type");
    const finalUrl = upstream.url || target.toString();
    const looksLikePlaylist = /mpegurl/i.test(contentType ?? "") || /\.m3u8?(\?|$)/i.test(finalUrl);
    if (looksLikePlaylist && upstream.ok) {
      const body = await upstream.text();
      if (isHlsPlaylist(contentType, finalUrl, body.slice(0, 64))) {
        const proxyBase = `${req.protocol}://${req.get("host")}${req.baseUrl}/proxy`;
        res.status(200).type("application/vnd.apple.mpegurl").send(rewritePlaylist(body, finalUrl, proxyBase, headers));
        return;
      }
      res.status(upstream.status).type(contentType ?? "text/plain").send(body);
      return;
    }
    res.status(upstream.status);
    for (const h of HOP_HEADERS) {
      const v = upstream.headers.get(h);
      if (v) res.setHeader(h, v);
    }
    if (!upstream.body) {
      res.end();
      return;
    }
    const body = Readable.fromWeb(upstream.body as import("node:stream/web").ReadableStream);
    res.on("close", () => body.destroy());
    try {
      await pipeline(body, res);
    } catch {
      // client disconnected
    }
  });

  router.get("/subtitles.vtt", async (req, res) => {
    const target = targetUrl(req.query.from ?? req.query.url);
    if (!target) {
      res.status(400).json({ error: "from must be http(s)" });
      return;
    }
    const offset = Number(req.query.offset ?? 0) || 0;
    try {
      const upstream = await fetchImpl(target);
      if (!upstream.ok) throw new Error(`Subtitle fetch failed: HTTP ${upstream.status}`);
      let bytes: Uint8Array = new Uint8Array(await upstream.arrayBuffer());
      if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = gunzipSync(bytes);
      res.type("text/vtt").send(toWebVtt(decodeSubtitleBytes(bytes), offset));
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  router.get("/probe", async (req, res) => {
    const target = targetUrl(req.query.url);
    if (!target) {
      res.status(400).json({ error: "url must be http(s)" });
      return;
    }
    try {
      res.json(await runFfprobe(target.toString(), opts.ffprobe));
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  // Embedded subtitle track -> WebVTT.
  router.get("/subtitles/embedded.vtt", (req, res) => {
    const target = targetUrl(req.query.url);
    const track = Number(req.query.track ?? 0);
    if (!target || !Number.isInteger(track) || track < 0) {
      res.status(400).json({ error: "url and track are required" });
      return;
    }
    const child = spawn(
      opts.ffmpeg,
      ["-v", "error", "-i", target.toString(), "-map", `0:s:${track}`, "-f", "webvtt", "pipe:1"],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    res.type("text/vtt");
    child.stdout.pipe(res);
    res.on("close", () => child.kill("SIGKILL"));
  });

  // On-the-fly transcode/remux to fragmented MP4. Seeking restarts ffmpeg with
  // ?t=<seconds>; the player adds that offset to its own currentTime.
  router.get("/transcode.mp4", (req, res) => {
    const target = targetUrl(req.query.url);
    if (!target) {
      res.status(400).json({ error: "url must be http(s)" });
      return;
    }
    const start = Math.max(0, Number(req.query.t ?? 0) || 0);
    const audio = Math.max(0, Number(req.query.audio ?? 0) || 0);
    const copyVideo = req.query.copyVideo === "1";
    const maxWidth = Math.max(320, Number(req.query.maxWidth ?? 1920) || 1920);
    const args = [
      "-v", "error",
      "-ss", String(start),
      "-i", target.toString(),
      "-map", "0:v:0?",
      "-map", `0:a:${audio}?`,
      ...(copyVideo
        ? ["-c:v", "copy"]
        : ["-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-pix_fmt", "yuv420p",
           "-vf", `scale='min(${maxWidth},iw)':-2`]),
      "-c:a", "aac", "-ac", "2", "-b:a", "160k",
      "-movflags", "frag_keyframe+empty_moov+default_base_moof",
      "-f", "mp4", "pipe:1",
    ];
    const child = spawn(opts.ffmpeg, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (d) => {
      if (stderr.length < 4000) stderr += d;
    });
    child.on("error", (err) => {
      if (!res.headersSent) res.status(500).json({ error: err.message });
    });
    child.on("close", (code) => {
      if (code && code !== 255 && !res.headersSent) res.status(502).json({ error: stderr.trim() });
    });
    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Cache-Control", "no-store");
    child.stdout.pipe(res);
    res.on("close", () => child.kill("SIGKILL"));
  });

  return router;
}
