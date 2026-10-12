// Parser for extended M3U playlists as used by IPTV services (#EXTM3U / #EXTINF
// with tvg-* attributes). The parser is tolerant: unknown directives are ignored
// and malformed entries are skipped rather than aborting the whole playlist.

export interface Channel {
  id: string;
  name: string;
  url: string;
  logo?: string;
  group: string[];
  tvgId?: string;
  tvgName?: string;
  country?: string;
  language?: string;
  /** Request headers some playlists declare through #EXTVLCOPT / #EXTHTTP. */
  headers?: Record<string, string>;
  duration: number;
}

export interface Playlist {
  epgUrls: string[];
  channels: Channel[];
}

const ATTR_RE = /([A-Za-z0-9_-]+)="([^"]*)"/g;

function parseAttributes(segment: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of segment.matchAll(ATTR_RE)) {
    attrs[match[1]!.toLowerCase()] = match[2]!;
  }
  return attrs;
}

/** Split `#EXTINF:-1 a="b" c="d",Display name` into attributes and the name. */
function splitExtinf(line: string): { duration: number; attrs: Record<string, string>; name: string } {
  const body = line.slice("#EXTINF:".length);
  // The display name follows the first comma that is not inside quotes.
  let inQuotes = false;
  let comma = -1;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === "," && !inQuotes) {
      comma = i;
      break;
    }
  }
  const head = comma === -1 ? body : body.slice(0, comma);
  const name = comma === -1 ? "" : body.slice(comma + 1).trim();
  const durationMatch = /^\s*(-?\d+(?:\.\d+)?)/.exec(head);
  return {
    duration: durationMatch ? Number(durationMatch[1]) : -1,
    attrs: parseAttributes(head),
    name,
  };
}

function stableId(url: string, name: string): string {
  // FNV-1a over url+name: stable across reloads, short enough for URLs.
  let hash = 0x811c9dc5;
  const input = `${name}\u0000${url}`;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

export function parseM3U(text: string): Playlist {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  const playlist: Playlist = { epgUrls: [], channels: [] };
  let pending: ReturnType<typeof splitExtinf> | null = null;
  let pendingGroup: string | null = null;
  let pendingHeaders: Record<string, string> = {};

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#EXTM3U")) {
      const attrs = parseAttributes(line);
      const epg = attrs["x-tvg-url"] ?? attrs["url-tvg"];
      if (epg) playlist.epgUrls.push(...epg.split(",").map((s) => s.trim()).filter(Boolean));
      continue;
    }
    if (line.startsWith("#EXTINF:")) {
      pending = splitExtinf(line);
      continue;
    }
    if (line.startsWith("#EXTGRP:")) {
      pendingGroup = line.slice("#EXTGRP:".length).trim();
      continue;
    }
    if (line.startsWith("#EXTVLCOPT:")) {
      const opt = line.slice("#EXTVLCOPT:".length);
      const eq = opt.indexOf("=");
      if (eq > 0) {
        const key = opt.slice(0, eq).trim().toLowerCase();
        const value = opt.slice(eq + 1).trim();
        if (key === "http-user-agent") pendingHeaders["User-Agent"] = value;
        if (key === "http-referrer" || key === "http-referer") pendingHeaders["Referer"] = value;
      }
      continue;
    }
    if (line.startsWith("#EXTHTTP:")) {
      try {
        const parsed = JSON.parse(line.slice("#EXTHTTP:".length)) as Record<string, unknown>;
        for (const [k, v] of Object.entries(parsed)) if (typeof v === "string") pendingHeaders[k] = v;
      } catch {
        // ignore malformed header blocks
      }
      continue;
    }
    if (line.startsWith("#")) continue;

    // A URI line terminates the current entry.
    const info = pending ?? { duration: -1, attrs: {}, name: "" };
    const groupAttr = info.attrs["group-title"] ?? pendingGroup ?? "";
    const name = info.name || info.attrs["tvg-name"] || line;
    const channel: Channel = {
      id: stableId(line, name),
      name,
      url: line,
      group: groupAttr ? groupAttr.split(";").map((g) => g.trim()).filter(Boolean) : [],
      duration: info.duration,
    };
    if (info.attrs["tvg-logo"]) channel.logo = info.attrs["tvg-logo"];
    if (info.attrs["tvg-id"]) channel.tvgId = info.attrs["tvg-id"];
    if (info.attrs["tvg-name"]) channel.tvgName = info.attrs["tvg-name"];
    if (info.attrs["tvg-country"]) channel.country = info.attrs["tvg-country"];
    if (info.attrs["tvg-language"]) channel.language = info.attrs["tvg-language"];
    if (Object.keys(pendingHeaders).length) channel.headers = pendingHeaders;
    playlist.channels.push(channel);
    pending = null;
    pendingGroup = null;
    pendingHeaders = {};
  }
  return playlist;
}
