// Shape of the media descriptor shared across watch-together members. Mirrors
// the server's PartyMedia; kept in the web package so the client has no server
// import.
import type { Stream } from "../api/types";

export type PartySourceKind = "addon" | "youtube" | "web";

export interface PartyMedia {
  key: string;
  title: string;
  source: PartySourceKind;
  type?: string;
  metaId?: string;
  videoId?: string;
  poster?: string;
  background?: string;
  season?: number;
  episode?: number;
  /** addon: the add-on stream descriptor each member resolves locally. */
  stream?: Stream;
  youtubeId?: string;
  url?: string;
}

const YT_PATTERNS = [
  /[?&]v=([A-Za-z0-9_-]{11})/,
  /youtu\.be\/([A-Za-z0-9_-]{11})/,
  /youtube\.com\/(?:embed|shorts|live)\/([A-Za-z0-9_-]{11})/,
];

export function parseYouTubeId(input: string): string | null {
  const trimmed = input.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(trimmed)) return trimmed;
  for (const re of YT_PATTERNS) {
    const m = re.exec(trimmed);
    if (m) return m[1]!;
  }
  return null;
}

export function mediaFromYouTube(input: string, title?: string): PartyMedia | null {
  const id = parseYouTubeId(input);
  if (!id) return null;
  return {
    key: `yt:${id}`,
    title: title?.trim() || "YouTube video",
    source: "youtube",
    youtubeId: id,
    poster: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
  };
}

export function mediaFromWebUrl(input: string, title?: string): PartyMedia | null {
  const url = input.trim();
  if (!/^https?:\/\//i.test(url)) return null;
  const name = title?.trim() || url.split("/").pop() || "Web video";
  return { key: `web:${url}`, title: name, source: "web", url };
}
