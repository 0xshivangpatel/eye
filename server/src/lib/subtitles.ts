// Subtitle conversion helpers: SRT/WebVTT/SubViewer text into WebVTT that
// browsers accept in <track> elements, with an optional time offset.

const TIMESTAMP_RE =
  /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/;

function toMs(h: string, m: string, s: string, frac: string): number {
  const ms = Number(frac.padEnd(3, "0"));
  return ((Number(h) * 60 + Number(m)) * 60 + Number(s)) * 1000 + ms;
}

export function formatVttTime(totalMs: number): string {
  const ms = Math.max(0, Math.round(totalMs));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const frac = ms % 1000;
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(frac, 3)}`;
}

export interface Cue {
  start: number;
  end: number;
  text: string;
}

export function parseCues(input: string): Cue[] {
  const text = input.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const blocks = text.split(/\n{2,}/);
  const cues: Cue[] = [];
  for (const block of blocks) {
    const lines = block.split("\n");
    const timingIndex = lines.findIndex((l) => TIMESTAMP_RE.test(l));
    if (timingIndex === -1) continue;
    const m = TIMESTAMP_RE.exec(lines[timingIndex]!)!;
    const start = toMs(m[1]!, m[2]!, m[3]!, m[4]!);
    const end = toMs(m[5]!, m[6]!, m[7]!, m[8]!);
    const body = lines
      .slice(timingIndex + 1)
      .join("\n")
      .trim();
    if (!body) continue;
    cues.push({ start, end, text: body });
  }
  return cues;
}

export function toWebVtt(input: string, offsetMs = 0): string {
  const cues = parseCues(input);
  const out = ["WEBVTT", ""];
  for (const cue of cues) {
    const start = cue.start + offsetMs;
    const end = cue.end + offsetMs;
    if (end <= 0) continue;
    out.push(`${formatVttTime(start)} --> ${formatVttTime(end)}`);
    // Strip SSA-style override tags that sometimes leak into SRT files.
    out.push(cue.text.replace(/\{\\[^}]*\}/g, ""));
    out.push("");
  }
  return out.join("\n");
}

/** Decode subtitle bytes; most SRT files are UTF-8, older ones Windows-1252. */
export function decodeSubtitleBytes(bytes: Uint8Array): string {
  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  if (!utf8.includes("�")) return utf8;
  return new TextDecoder("windows-1252").decode(bytes);
}
