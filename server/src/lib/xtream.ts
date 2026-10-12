// Client for the Xtream Codes "player_api.php" protocol used by most IPTV
// panels. The user supplies their own server URL and credentials; nothing here
// is tied to a particular provider.

export interface XtreamCredentials {
  server: string;
  username: string;
  password: string;
}

export interface XtreamCategory {
  category_id: string;
  category_name: string;
}

export interface XtreamLiveStream {
  stream_id: number;
  name: string;
  stream_icon?: string;
  epg_channel_id?: string | null;
  category_id?: string;
  tv_archive?: number;
}

export interface XtreamVodStream {
  stream_id: number;
  name: string;
  stream_icon?: string;
  category_id?: string;
  container_extension?: string;
  rating?: string | number;
}

export type XtreamAction =
  | "get_live_categories"
  | "get_live_streams"
  | "get_vod_categories"
  | "get_vod_streams"
  | "get_series_categories"
  | "get_series"
  | "get_series_info"
  | "get_vod_info"
  | "get_short_epg";

export function normalizeServer(server: string): string {
  let base = server.trim();
  if (!/^https?:\/\//i.test(base)) base = `http://${base}`;
  const url = new URL(base);
  // Users often paste the full player_api.php or get.php URL.
  url.pathname = url.pathname.replace(/\/(player_api|get|xmltv)\.php$/i, "/");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/+$/, "");
}

export function apiUrl(creds: XtreamCredentials, action?: XtreamAction, params: Record<string, string> = {}): string {
  const url = new URL(`${normalizeServer(creds.server)}/player_api.php`);
  url.searchParams.set("username", creds.username);
  url.searchParams.set("password", creds.password);
  if (action) url.searchParams.set("action", action);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

export function liveUrl(creds: XtreamCredentials, streamId: number | string, ext: "m3u8" | "ts" = "m3u8"): string {
  return `${normalizeServer(creds.server)}/live/${encodeURIComponent(creds.username)}/${encodeURIComponent(creds.password)}/${streamId}.${ext}`;
}

export function vodUrl(creds: XtreamCredentials, streamId: number | string, ext = "mp4"): string {
  return `${normalizeServer(creds.server)}/movie/${encodeURIComponent(creds.username)}/${encodeURIComponent(creds.password)}/${streamId}.${ext}`;
}

export function seriesEpisodeUrl(creds: XtreamCredentials, episodeId: number | string, ext = "mp4"): string {
  return `${normalizeServer(creds.server)}/series/${encodeURIComponent(creds.username)}/${encodeURIComponent(creds.password)}/${episodeId}.${ext}`;
}

export function xmltvUrl(creds: XtreamCredentials): string {
  const url = new URL(`${normalizeServer(creds.server)}/xmltv.php`);
  url.searchParams.set("username", creds.username);
  url.searchParams.set("password", creds.password);
  return url.toString();
}

/** Replace credentials embedded in a URL so they never reach logs. */
export function redactCredentials(text: string, creds: Pick<XtreamCredentials, "username" | "password">): string {
  let out = text;
  for (const secret of [creds.password, creds.username]) {
    if (!secret) continue;
    out = out.split(secret).join("***").split(encodeURIComponent(secret)).join("***");
  }
  return out;
}
