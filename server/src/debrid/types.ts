export interface ResolveRequest {
  infoHash: string;
  /** Index into the torrent's file list as declared by the add-on stream. */
  fileIdx?: number;
  /** behaviorHints.filename from the add-on, when present. */
  filename?: string;
  season?: number;
  episode?: number;
  trackers?: string[];
}

export type ResolveResult =
  | { status: "ready"; url: string; filename: string; size: number; mimeType?: string }
  | {
      status: "queued" | "downloading" | "converting";
      progress: number;
      speed?: number;
      seeders?: number;
      message: string;
    }
  | { status: "error"; message: string };

export interface DebridUser {
  username: string;
  premium: boolean;
  expiration?: string;
}

export interface CloudItem {
  id: string;
  filename: string;
  bytes: number;
  status: string;
  progress: number;
  added: string;
  hash?: string;
}

export interface DebridProvider {
  readonly id: string;
  readonly name: string;
  getUser(): Promise<DebridUser>;
  resolve(request: ResolveRequest): Promise<ResolveResult>;
  listCloud(): Promise<CloudItem[]>;
  /** Unrestricted links for one finished cloud item. */
  cloudLinks(id: string): Promise<Array<{ filename: string; size: number; url: string }>>;
}

export class DebridAuthError extends Error {
  constructor(message = "The debrid token was rejected") {
    super(message);
    this.name = "DebridAuthError";
  }
}

export class DebridApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: number,
  ) {
    super(message);
    this.name = "DebridApiError";
  }
}
