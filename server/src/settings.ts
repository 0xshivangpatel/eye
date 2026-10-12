// Persistent server settings. Secrets (debrid tokens) live here so the browser
// never has to hold them; they are written with owner-only permissions and are
// never echoed back by the HTTP API.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type DebridProviderId = "realdebrid";

export interface DebridCredentials {
  provider: DebridProviderId;
  /** Private API token or OAuth access token. */
  token: string;
  /** Present when the token came from the device-code OAuth flow. */
  oauth?: { clientId: string; clientSecret: string; refreshToken: string; expiresAt: number };
}

export interface Settings {
  cacheSize: number;
  btMaxConnections: number;
  btHandshakeTimeout: number;
  btRequestTimeout: number;
  btDownloadSpeedSoftLimit: number;
  btMinPeersForStable: number;
  transcodeHardwareAccel: boolean;
  transcodeMaxWidth: number;
  /** When true, torrent streams are resolved through the debrid service first. */
  debridPreferred: boolean;
  debrid: DebridCredentials | null;
}

export const DEFAULT_SETTINGS: Settings = {
  cacheSize: 2 * 1024 ** 3,
  btMaxConnections: 55,
  btHandshakeTimeout: 20_000,
  btRequestTimeout: 4_000,
  btDownloadSpeedSoftLimit: 2_621_440,
  btMinPeersForStable: 5,
  transcodeHardwareAccel: false,
  transcodeMaxWidth: 1920,
  debridPreferred: true,
  debrid: null,
};

/** Settings fields the HTTP API may change directly. */
const PUBLIC_KEYS = [
  "cacheSize",
  "btMaxConnections",
  "btHandshakeTimeout",
  "btRequestTimeout",
  "btDownloadSpeedSoftLimit",
  "btMinPeersForStable",
  "transcodeHardwareAccel",
  "transcodeMaxWidth",
  "debridPreferred",
] as const satisfies readonly (keyof Settings)[];

export function appDir(): string {
  return process.env.MARQUEE_HOME ?? path.join(os.homedir(), ".marquee");
}

export class SettingsStore {
  private value: Settings;

  constructor(private readonly file = path.join(appDir(), "server-settings.json")) {
    this.value = { ...DEFAULT_SETTINGS };
    try {
      const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<Settings>;
      this.value = { ...DEFAULT_SETTINGS, ...raw };
    } catch {
      // first run, or unreadable file: keep defaults
    }
  }

  get(): Settings {
    return this.value;
  }

  /** Public view: everything except secrets. */
  publicView() {
    const { debrid, ...rest } = this.value;
    return {
      ...rest,
      debrid: debrid ? { provider: debrid.provider, configured: true, oauth: Boolean(debrid.oauth) } : null,
    };
  }

  update(patch: Record<string, unknown>): void {
    const next: Settings = { ...this.value };
    for (const key of PUBLIC_KEYS) {
      if (!(key in patch)) continue;
      const incoming = patch[key];
      const current = DEFAULT_SETTINGS[key];
      if (typeof current === "number" && typeof incoming === "number" && Number.isFinite(incoming) && incoming >= 0) {
        (next as unknown as Record<string, unknown>)[key] = incoming;
      } else if (typeof current === "boolean" && typeof incoming === "boolean") {
        (next as unknown as Record<string, unknown>)[key] = incoming;
      }
    }
    this.value = next;
    this.save();
  }

  setDebrid(credentials: DebridCredentials | null): void {
    this.value = { ...this.value, debrid: credentials };
    this.save();
  }

  private save(): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.value, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }
}
