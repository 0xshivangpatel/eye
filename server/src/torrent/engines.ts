// Torrent engine manager. One torrent-stream engine per info hash, created on
// demand and destroyed after it has had no open streams for `idleTimeoutMs`.
import fs from "node:fs";
import path from "node:path";
import torrentStream from "torrent-stream";
import { DEFAULT_TRACKERS, buildMagnet, guessFileIndex } from "../lib/files.js";
import type { SettingsStore } from "../settings.js";

type Engine = torrentStream.Engine;

export interface EngineEntry {
  engine: Engine;
  ready: Promise<void>;
  isReady: boolean;
  openStreams: number;
  lastActivity: number;
  createdAt: number;
}

export interface CreateOptions {
  trackers?: string[];
  /** Additional peers ("host:port"), mostly useful for tests and LAN seeding. */
  peers?: string[];
}

export class EngineManager {
  private readonly engines = new Map<string, EngineEntry>();
  private readonly timer: NodeJS.Timeout;

  constructor(
    private readonly settings: SettingsStore,
    private readonly cacheRoot: string,
    private readonly opts: { readyTimeoutMs?: number; idleTimeoutMs?: number; dht?: boolean } = {},
  ) {
    this.timer = setInterval(() => this.reap(), 15_000);
    this.timer.unref();
  }

  static normalizeHash(hash: string): string | null {
    const h = hash.trim().toLowerCase();
    return /^[0-9a-f]{40}$/.test(h) ? h : null;
  }

  get(infoHash: string): EngineEntry | undefined {
    return this.engines.get(infoHash);
  }

  list(): string[] {
    return [...this.engines.keys()];
  }

  create(infoHash: string, options: CreateOptions = {}): EngineEntry {
    const existing = this.engines.get(infoHash);
    if (existing) {
      existing.lastActivity = Date.now();
      for (const peer of options.peers ?? []) existing.engine.connect(peer);
      return existing;
    }
    const s = this.settings.get();
    const trackers = [...new Set([...(options.trackers ?? []), ...DEFAULT_TRACKERS])].filter(
      // torrent-stream speaks UDP/HTTP trackers only.
      (t) => !t.startsWith("ws"),
    );
    const dir = path.join(this.cacheRoot, infoHash);
    fs.mkdirSync(dir, { recursive: true });
    const engine = torrentStream(buildMagnet(infoHash, trackers), {
      path: dir,
      tmp: this.cacheRoot,
      connections: s.btMaxConnections,
      dht: this.opts.dht ?? true,
      tracker: true,
      trackers,
    });
    const entry: EngineEntry = {
      engine,
      isReady: false,
      openStreams: 0,
      lastActivity: Date.now(),
      createdAt: Date.now(),
      ready: Promise.resolve(),
    };
    entry.ready = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Timed out fetching torrent metadata")),
        this.opts.readyTimeoutMs ?? 60_000,
      );
      engine.once("ready", () => {
        clearTimeout(timeout);
        entry.isReady = true;
        // Download nothing until a file is actually requested.
        for (const f of engine.files) f.deselect();
        resolve();
      });
    });
    entry.ready.catch(() => {});
    for (const peer of options.peers ?? []) engine.connect(peer);
    this.engines.set(infoHash, entry);
    return entry;
  }

  resolveFileIndex(entry: EngineEntry, requested: number, hint: { filename?: string; season?: number; episode?: number } = {}): number {
    const files = entry.engine.files.map((f) => ({ name: f.path, length: f.length }));
    if (Number.isInteger(requested) && requested >= 0 && requested < files.length) return requested;
    return guessFileIndex(files, hint);
  }

  /** Track an open HTTP stream so the engine is not reaped while in use. */
  retain(infoHash: string): () => void {
    const entry = this.engines.get(infoHash);
    if (!entry) return () => {};
    entry.openStreams++;
    entry.lastActivity = Date.now();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      entry.openStreams--;
      entry.lastActivity = Date.now();
    };
  }

  stats(infoHash: string, fileIdx?: number) {
    const entry = this.engines.get(infoHash);
    if (!entry) return null;
    const { engine } = entry;
    const wires = engine.swarm?.wires ?? [];
    const stats: Record<string, unknown> = {
      infoHash,
      name: engine.torrent?.name ?? null,
      ready: entry.isReady,
      peers: wires.length,
      unchoked: wires.filter((w) => !w.peerChoking).length,
      queued: engine.swarm?.queued ?? 0,
      downloaded: engine.swarm?.downloaded ?? 0,
      uploaded: engine.swarm?.uploaded ?? 0,
      downloadSpeed: engine.swarm?.downloadSpeed() ?? 0,
      uploadSpeed: engine.swarm?.uploadSpeed() ?? 0,
      swarmPaused: engine.swarm?.paused ?? false,
      openStreams: entry.openStreams,
      files: entry.isReady ? engine.files.map((f) => ({ name: f.name, path: f.path, length: f.length, offset: f.offset })) : [],
    };
    if (entry.isReady && fileIdx !== undefined && engine.files[fileIdx] && engine.torrent && engine.bitfield) {
      const file = engine.files[fileIdx]!;
      const pl = engine.torrent.pieceLength;
      const startPiece = Math.floor(file.offset / pl);
      const endPiece = Math.floor((file.offset + file.length - 1) / pl);
      let have = 0;
      for (let i = startPiece; i <= endPiece; i++) if (engine.bitfield.get(i)) have++;
      stats.streamName = file.name;
      stats.streamLen = file.length;
      stats.streamProgress = have / (endPiece - startPiece + 1);
    }
    return stats;
  }

  remove(infoHash: string): Promise<void> {
    const entry = this.engines.get(infoHash);
    if (!entry) return Promise.resolve();
    this.engines.delete(infoHash);
    return new Promise((resolve) => entry.engine.destroy(() => resolve()));
  }

  async removeAll(): Promise<void> {
    await Promise.all(this.list().map((h) => this.remove(h)));
  }

  private reap(): void {
    const idle = this.opts.idleTimeoutMs ?? 120_000;
    const now = Date.now();
    for (const [hash, entry] of this.engines) {
      if (entry.openStreams === 0 && now - entry.lastActivity > idle) void this.remove(hash);
    }
  }

  close(): Promise<void> {
    clearInterval(this.timer);
    return this.removeAll();
  }
}
