// Real-Debrid provider (https://api.real-debrid.com/). Turns a torrent info
// hash into a direct HTTPS download link using the user's own account.
import { buildMagnet, guessFileIndex, isVideoFile } from "../lib/files.js";
import {
  DebridApiError,
  DebridAuthError,
  type CloudItem,
  type DebridProvider,
  type DebridUser,
  type ResolveRequest,
  type ResolveResult,
} from "./types.js";

export const RD_API = "https://api.real-debrid.com/rest/1.0";
export const RD_OAUTH = "https://api.real-debrid.com/oauth/v2";
/** Real-Debrid's published client id for open-source applications. */
export const RD_OPEN_SOURCE_CLIENT_ID = "X245A4XAIBGVM";

interface RdFile {
  id: number;
  path: string;
  bytes: number;
  selected: 0 | 1;
}

interface RdTorrentInfo {
  id: string;
  filename: string;
  hash: string;
  bytes: number;
  progress: number;
  status: string;
  added: string;
  files?: RdFile[];
  links: string[];
  speed?: number;
  seeders?: number;
}

interface RdTorrentListItem {
  id: string;
  filename: string;
  hash: string;
  bytes: number;
  progress: number;
  status: string;
  added: string;
  links: string[];
}

interface RdUnrestricted {
  filename: string;
  filesize: number;
  download: string;
  mimeType?: string;
}

export interface RealDebridOptions {
  apiBase?: string;
  fetchImpl?: typeof fetch;
  /** How long resolve() waits for a cached torrent to become "downloaded". */
  settleTimeoutMs?: number;
  pollIntervalMs?: number;
}

const FAILED = new Set(["magnet_error", "error", "virus", "dead"]);
const IN_PROGRESS = new Set(["queued", "downloading", "compressing", "uploading"]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class RealDebrid implements DebridProvider {
  readonly id = "realdebrid";
  readonly name = "Real-Debrid";
  private readonly apiBase: string;
  private readonly fetchImpl: typeof fetch;
  private readonly settleTimeoutMs: number;
  private readonly pollIntervalMs: number;
  /** infoHash -> RD torrent id, so repeat plays reuse the same transfer. */
  private readonly torrentIds = new Map<string, string>();
  /** `${hash}:${fileId}` -> resolved link with expiry. */
  private readonly linkCache = new Map<string, { result: ResolveResult & { status: "ready" }; expires: number }>();

  constructor(
    private readonly token: string,
    options: RealDebridOptions = {},
  ) {
    this.apiBase = options.apiBase ?? RD_API;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.settleTimeoutMs = options.settleTimeoutMs ?? 8_000;
    this.pollIntervalMs = options.pollIntervalMs ?? 1_000;
  }

  private async call<T>(method: string, path: string, form?: Record<string, string>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const res = await this.fetchImpl(`${this.apiBase}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
        },
        body: form ? new URLSearchParams(form).toString() : undefined,
      });
      if (res.status === 429 && attempt < 2) {
        await sleep(1_000 * (attempt + 1));
        continue;
      }
      if (res.status === 204) return undefined as T;
      const text = await res.text();
      let body: unknown = undefined;
      try {
        body = text ? JSON.parse(text) : undefined;
      } catch {
        body = undefined;
      }
      if (res.status === 401 || res.status === 403) {
        const code = (body as { error_code?: number } | undefined)?.error_code;
        // 403 with error_code 9/8 means a bad/expired token; other 403s are account limits.
        if (res.status === 401 || code === 8 || code === 9) throw new DebridAuthError();
      }
      if (!res.ok) {
        const err = body as { error?: string; error_code?: number } | undefined;
        throw new DebridApiError(err?.error ?? `Real-Debrid HTTP ${res.status}`, res.status, err?.error_code);
      }
      return body as T;
    }
  }

  async getUser(): Promise<DebridUser> {
    const user = await this.call<{ username: string; type: string; expiration?: string }>("GET", "/user");
    return { username: user.username, premium: user.type === "premium", ...(user.expiration ? { expiration: user.expiration } : {}) };
  }

  private async findExisting(hash: string): Promise<string | undefined> {
    const cached = this.torrentIds.get(hash);
    if (cached) return cached;
    const list = await this.call<RdTorrentListItem[]>("GET", "/torrents?limit=200");
    const match = (list ?? []).find((t) => t.hash.toLowerCase() === hash && !FAILED.has(t.status));
    if (match) this.torrentIds.set(hash, match.id);
    return match?.id;
  }

  private async addMagnet(request: ResolveRequest): Promise<string> {
    const magnet = buildMagnet(request.infoHash, request.trackers ?? []);
    const added = await this.call<{ id: string }>("POST", "/torrents/addMagnet", { magnet });
    this.torrentIds.set(request.infoHash, added.id);
    return added.id;
  }

  private info(id: string): Promise<RdTorrentInfo> {
    return this.call<RdTorrentInfo>("GET", `/torrents/info/${encodeURIComponent(id)}`);
  }

  /** Map the add-on's file choice onto Real-Debrid's file list (torrent order, ids from 1). */
  private chooseFile(files: RdFile[], request: ResolveRequest): RdFile | undefined {
    if (!files.length) return undefined;
    const byIdx =
      request.fileIdx !== undefined && request.fileIdx >= 0 ? files.find((f) => f.id === request.fileIdx! + 1) : undefined;
    if (byIdx && (!request.filename || byIdx.path.toLowerCase().endsWith(request.filename.toLowerCase()))) return byIdx;
    const idx = guessFileIndex(
      files.map((f) => ({ name: f.path, length: f.bytes })),
      {
        ...(request.filename ? { filename: request.filename } : {}),
        ...(request.season !== undefined ? { season: request.season } : {}),
        ...(request.episode !== undefined ? { episode: request.episode } : {}),
      },
    );
    return files[idx];
  }

  private async waitWhile(id: string, statuses: Set<string>): Promise<RdTorrentInfo> {
    const deadline = Date.now() + this.settleTimeoutMs;
    let info = await this.info(id);
    while (statuses.has(info.status) && Date.now() < deadline) {
      await sleep(this.pollIntervalMs);
      info = await this.info(id);
    }
    return info;
  }

  private progressResult(info: RdTorrentInfo): ResolveResult {
    const status = info.status === "queued" ? "queued" : "downloading";
    return {
      status,
      progress: Math.max(0, Math.min(100, info.progress ?? 0)),
      ...(info.speed !== undefined ? { speed: info.speed } : {}),
      ...(info.seeders !== undefined ? { seeders: info.seeders } : {}),
      message:
        status === "queued"
          ? "Queued on Real-Debrid"
          : `Real-Debrid is caching this torrent (${Math.round(info.progress ?? 0)}%)`,
    };
  }

  async resolve(request: ResolveRequest): Promise<ResolveResult> {
    const hash = request.infoHash.toLowerCase();
    let id = (await this.findExisting(hash)) ?? (await this.addMagnet({ ...request, infoHash: hash }));
    let info = await this.waitWhile(id, new Set(["magnet_conversion"]));
    if (info.status === "magnet_conversion") {
      return { status: "converting", progress: 0, message: "Real-Debrid is fetching torrent metadata" };
    }
    if (FAILED.has(info.status)) {
      this.torrentIds.delete(hash);
      await this.call("DELETE", `/torrents/delete/${encodeURIComponent(id)}`).catch(() => {});
      return { status: "error", message: `Real-Debrid reported "${info.status}" for this torrent` };
    }

    const files = info.files ?? [];
    const chosen = this.chooseFile(files, request);
    if (!chosen) return { status: "error", message: "The torrent has no files" };
    if (!isVideoFile(chosen.path)) {
      return { status: "error", message: `Selected file is not a video: ${chosen.path}` };
    }

    const cacheKey = `${hash}:${chosen.id}`;
    const cachedLink = this.linkCache.get(cacheKey);
    if (cachedLink && cachedLink.expires > Date.now()) return cachedLink.result;

    if (info.status === "waiting_files_selection") {
      await this.call("POST", `/torrents/selectFiles/${encodeURIComponent(id)}`, { files: String(chosen.id) });
      info = await this.waitWhile(id, new Set(["waiting_files_selection", "magnet_conversion", "queued"]));
    } else if (!files.find((f) => f.id === chosen.id)?.selected) {
      // The existing transfer was started for a different file (e.g. another
      // episode of a season pack). Start a second transfer for this file.
      this.torrentIds.delete(hash);
      id = await this.addMagnet({ ...request, infoHash: hash });
      await this.waitWhile(id, new Set(["magnet_conversion"]));
      await this.call("POST", `/torrents/selectFiles/${encodeURIComponent(id)}`, { files: String(chosen.id) });
      info = await this.waitWhile(id, new Set(["waiting_files_selection", "magnet_conversion", "queued"]));
    }

    if (info.status === "downloaded") {
      const selected = (info.files ?? []).filter((f) => f.selected);
      const position = selected.findIndex((f) => f.id === chosen.id);
      const link = info.links[position] ?? (info.links.length === 1 ? info.links[0] : undefined);
      if (!link) return { status: "error", message: "Real-Debrid did not return a link for the selected file" };
      const unrestricted = await this.call<RdUnrestricted>("POST", "/unrestrict/link", { link });
      const result = {
        status: "ready" as const,
        url: unrestricted.download,
        filename: unrestricted.filename,
        size: unrestricted.filesize,
        ...(unrestricted.mimeType ? { mimeType: unrestricted.mimeType } : {}),
      };
      this.linkCache.set(cacheKey, { result, expires: Date.now() + 30 * 60_000 });
      return result;
    }
    if (IN_PROGRESS.has(info.status) || info.status === "waiting_files_selection") return this.progressResult(info);
    if (FAILED.has(info.status)) return { status: "error", message: `Real-Debrid reported "${info.status}"` };
    return { status: "error", message: `Unexpected Real-Debrid status "${info.status}"` };
  }

  async listCloud(): Promise<CloudItem[]> {
    const list = await this.call<RdTorrentListItem[]>("GET", "/torrents?limit=100");
    return (list ?? []).map((t) => ({
      id: t.id,
      filename: t.filename,
      bytes: t.bytes,
      status: t.status,
      progress: t.progress,
      added: t.added,
      hash: t.hash.toLowerCase(),
    }));
  }

  async cloudLinks(id: string) {
    const info = await this.info(id);
    const out: Array<{ filename: string; size: number; url: string }> = [];
    for (const link of info.links) {
      const u = await this.call<RdUnrestricted>("POST", "/unrestrict/link", { link });
      if (isVideoFile(u.filename)) out.push({ filename: u.filename, size: u.filesize, url: u.download });
    }
    return out;
  }
}

// --- Device-code OAuth (lets users link an account without pasting a token) ---

export interface DeviceCode {
  device_code: string;
  user_code: string;
  interval: number;
  expires_in: number;
  verification_url: string;
  direct_verification_url?: string;
}

export interface OAuthTokens {
  clientId: string;
  clientSecret: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export async function startDeviceAuth(fetchImpl: typeof fetch = fetch, oauthBase = RD_OAUTH): Promise<DeviceCode> {
  const res = await fetchImpl(`${oauthBase}/device/code?client_id=${RD_OPEN_SOURCE_CLIENT_ID}&new_credentials=yes`);
  if (!res.ok) throw new DebridApiError("Could not start Real-Debrid device login", res.status);
  return (await res.json()) as DeviceCode;
}

/** Returns null while the user has not yet approved the device. */
export async function pollDeviceAuth(
  deviceCode: string,
  fetchImpl: typeof fetch = fetch,
  oauthBase = RD_OAUTH,
): Promise<OAuthTokens | null> {
  const credRes = await fetchImpl(
    `${oauthBase}/device/credentials?client_id=${RD_OPEN_SOURCE_CLIENT_ID}&code=${encodeURIComponent(deviceCode)}`,
  );
  if (!credRes.ok) return null;
  const creds = (await credRes.json()) as { client_id?: string; client_secret?: string };
  if (!creds.client_id || !creds.client_secret) return null;
  return exchangeToken(creds.client_id, creds.client_secret, deviceCode, fetchImpl, oauthBase);
}

export async function exchangeToken(
  clientId: string,
  clientSecret: string,
  code: string,
  fetchImpl: typeof fetch = fetch,
  oauthBase = RD_OAUTH,
): Promise<OAuthTokens> {
  const res = await fetchImpl(`${oauthBase}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: "http://oauth.net/grant_type/device/1.0",
    }).toString(),
  });
  if (!res.ok) throw new DebridApiError("Real-Debrid token exchange failed", res.status);
  const body = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number };
  return {
    clientId,
    clientSecret,
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: Date.now() + body.expires_in * 1000,
  };
}
