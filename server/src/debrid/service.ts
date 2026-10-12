// Owns the configured debrid provider: builds it from settings, refreshes OAuth
// access tokens before they expire, and clears nothing silently.
import type { SettingsStore } from "../settings.js";
import { exchangeToken, RealDebrid, type RealDebridOptions } from "./realdebrid.js";
import type { DebridProvider } from "./types.js";

export class DebridService {
  private provider: DebridProvider | null = null;
  private providerToken: string | null = null;

  constructor(
    private readonly settings: SettingsStore,
    private readonly rdOptions: RealDebridOptions & { oauthBase?: string } = {},
  ) {}

  get configured(): boolean {
    return this.settings.get().debrid !== null;
  }

  async current(): Promise<DebridProvider | null> {
    const creds = this.settings.get().debrid;
    if (!creds) {
      this.provider = null;
      this.providerToken = null;
      return null;
    }
    let token = creds.token;
    if (creds.oauth && creds.oauth.expiresAt - Date.now() < 5 * 60_000) {
      const refreshed = await exchangeToken(
        creds.oauth.clientId,
        creds.oauth.clientSecret,
        creds.oauth.refreshToken,
        this.rdOptions.fetchImpl,
        this.rdOptions.oauthBase,
      );
      token = refreshed.accessToken;
      this.settings.setDebrid({
        provider: creds.provider,
        token,
        oauth: {
          clientId: refreshed.clientId,
          clientSecret: refreshed.clientSecret,
          refreshToken: refreshed.refreshToken,
          expiresAt: refreshed.expiresAt,
        },
      });
    }
    if (this.provider && this.providerToken === token) return this.provider;
    this.provider = this.build(creds.provider, token);
    this.providerToken = token;
    return this.provider;
  }

  build(provider: string, token: string): DebridProvider {
    switch (provider) {
      case "realdebrid":
        return new RealDebrid(token, this.rdOptions);
      default:
        throw new Error(`Unsupported debrid provider: ${provider}`);
    }
  }
}
