import type { Request, Response } from "express";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import rangeParser from "range-parser";
import mime from "mime-types";

export interface RangeSource {
  size: number;
  name: string;
  createStream(range: { start: number; end: number }): Readable;
}

/** Serve a seekable byte source with HTTP Range semantics (RFC 9110 §14). */
export async function serveRange(req: Request, res: Response, source: RangeSource): Promise<void> {
  const type = mime.lookup(source.name) || "application/octet-stream";
  // Browsers refuse video/x-matroska; advertising video/webm lets Chromium try.
  const contentType = type === "video/x-matroska" ? "video/webm" : type;
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Content-Type", contentType);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("transferMode.dlna.org", "Streaming");
  res.setHeader("contentFeatures.dlna.org", "DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000");

  let start = 0;
  let end = source.size - 1;
  const header = req.headers.range;
  if (header) {
    const parsed = rangeParser(source.size, header, { combine: true });
    if (parsed === -1) {
      res.status(416).setHeader("Content-Range", `bytes */${source.size}`).end();
      return;
    }
    if (parsed !== -2 && parsed.length > 0) {
      start = parsed[0]!.start;
      end = parsed[0]!.end;
      res.status(206).setHeader("Content-Range", `bytes ${start}-${end}/${source.size}`);
    }
  }
  res.setHeader("Content-Length", String(end - start + 1));
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  const stream = source.createStream({ start, end });
  res.on("close", () => stream.destroy());
  try {
    await pipeline(stream, res);
  } catch {
    // client went away mid-stream; nothing to report
  }
}
