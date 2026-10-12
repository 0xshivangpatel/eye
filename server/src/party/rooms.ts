// Watch-together room state machine. Pure logic: no sockets, no timers, so it
// can be tested deterministically. The WebSocket layer feeds it messages and
// broadcasts whatever it returns.

/**
 * What a room is watching.
 * - `addon`  : a Stremio add-on stream; each member resolves it locally through
 *              their own streaming server / debrid account (only the descriptor
 *              travels, never anyone's links or keys).
 * - `youtube`: a shared YouTube video id, rendered through the IFrame API.
 * - `web`    : a direct media URL (mp4/webm/hls) everyone loads the same way.
 */
export type PartySourceKind = "addon" | "youtube" | "web";

export interface PartyMedia {
  /** Stable key so clients can tell whether they already have it loaded. */
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
  /** addon: the add-on stream object to resolve locally. */
  stream?: Record<string, unknown>;
  /** youtube: the 11-char video id. */
  youtubeId?: string;
  /** web: a direct http(s) media URL shared by all members. */
  url?: string;
}

const YT_ID_RE = /^[A-Za-z0-9_-]{11}$/;

/** Validate a load payload per source kind; returns a clean copy or null. */
export function normalizeMedia(input: unknown): PartyMedia | null {
  if (!input || typeof input !== "object") return null;
  const m = input as Record<string, unknown>;
  if (typeof m.key !== "string" || typeof m.title !== "string") return null;
  const source: PartySourceKind = m.source === "youtube" || m.source === "web" ? m.source : "addon";
  const base: PartyMedia = {
    key: m.key.slice(0, 256),
    title: m.title.slice(0, 200),
    source,
    ...(typeof m.type === "string" ? { type: m.type } : {}),
    ...(typeof m.metaId === "string" ? { metaId: m.metaId } : {}),
    ...(typeof m.videoId === "string" ? { videoId: m.videoId } : {}),
    ...(typeof m.poster === "string" ? { poster: m.poster } : {}),
    ...(typeof m.background === "string" ? { background: m.background } : {}),
    ...(typeof m.season === "number" ? { season: m.season } : {}),
    ...(typeof m.episode === "number" ? { episode: m.episode } : {}),
  };
  if (source === "addon") {
    if (!m.stream || typeof m.stream !== "object") return null;
    base.stream = m.stream as Record<string, unknown>;
  } else if (source === "youtube") {
    if (typeof m.youtubeId !== "string" || !YT_ID_RE.test(m.youtubeId)) return null;
    base.youtubeId = m.youtubeId;
  } else {
    if (typeof m.url !== "string" || !/^https?:\/\//i.test(m.url)) return null;
    base.url = m.url.slice(0, 2048);
  }
  return base;
}

export interface Playback {
  paused: boolean;
  /** Media position (seconds) at `updatedAt`. */
  position: number;
  rate: number;
  /** Server clock (ms) when `position` was observed. */
  updatedAt: number;
}

export interface Member {
  id: string;
  name: string;
  color: string;
  joinedAt: number;
  buffering: boolean;
  ready: boolean;
}

export interface ChatMessage {
  id: string;
  memberId: string;
  name: string;
  color: string;
  text: string;
  at: number;
  kind: "chat" | "system";
}

export interface RoomSettings {
  /** Anyone can control playback (otherwise host only). */
  everyoneControls: boolean;
  /** Pause everyone while any member is buffering. */
  waitForAll: boolean;
}

export interface RoomSnapshot {
  code: string;
  hostId: string;
  members: Member[];
  media: PartyMedia | null;
  playback: Playback;
  holding: string[];
  settings: RoomSettings;
  chat: ChatMessage[];
}

export type ClientMessage =
  | { type: "load"; media: PartyMedia }
  | { type: "play"; position: number }
  | { type: "pause"; position: number }
  | { type: "seek"; position: number }
  | { type: "rate"; rate: number }
  | { type: "buffering"; buffering: boolean }
  | { type: "ready"; ready: boolean }
  | { type: "chat"; text: string }
  | { type: "reaction"; emoji: string }
  | { type: "settings"; settings: Partial<RoomSettings> }
  | { type: "transfer-host"; memberId: string }
  | { type: "kick"; memberId: string }
  | { type: "rename"; name: string };

export type ServerEvent =
  | { type: "playback"; playback: Playback; holding: string[]; by: string | null; action: string }
  | { type: "media"; media: PartyMedia | null; playback: Playback; by: string }
  | { type: "members"; members: Member[]; hostId: string }
  | { type: "chat"; message: ChatMessage }
  | { type: "reaction"; memberId: string; name: string; emoji: string; at: number }
  | { type: "settings"; settings: RoomSettings; by: string }
  | { type: "kicked"; memberId: string }
  | { type: "error"; message: string; to: string };

const COLORS = ["#e50914", "#46d369", "#f5c518", "#00a8e1", "#b26cf5", "#ff7a00", "#1ce783", "#ff4f8b"];
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MAX_CHAT = 200;
const REACTIONS = new Set(["😂", "😮", "😍", "👏", "🔥", "😢", "👀", "🎉", "💀", "❤️"]);

export function randomCode(random: () => number = Math.random, length = 6): string {
  let out = "";
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  return out;
}

export function currentPosition(playback: Playback, now: number): number {
  if (playback.paused) return playback.position;
  return playback.position + ((now - playback.updatedAt) / 1000) * playback.rate;
}

function sanitizePosition(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value < 1e7 ? value : null;
}

export class Room {
  readonly members = new Map<string, Member>();
  hostId = "";
  media: PartyMedia | null = null;
  playback: Playback;
  settings: RoomSettings = { everyoneControls: true, waitForAll: true };
  chat: ChatMessage[] = [];
  /** Playback intent while holding for buffering members. */
  private wantPlaying = false;
  private seq = 0;
  lastActivity: number;

  constructor(
    readonly code: string,
    private readonly now: () => number = Date.now,
  ) {
    this.playback = { paused: true, position: 0, rate: 1, updatedAt: now() };
    this.lastActivity = now();
  }

  get holding(): string[] {
    if (!this.settings.waitForAll || !this.media) return [];
    return [...this.members.values()].filter((m) => m.buffering || !m.ready).map((m) => m.name);
  }

  snapshot(): RoomSnapshot {
    return {
      code: this.code,
      hostId: this.hostId,
      members: [...this.members.values()],
      media: this.media,
      playback: { ...this.playback },
      holding: this.holding,
      settings: { ...this.settings },
      chat: this.chat.slice(-50),
    };
  }

  private system(text: string): ServerEvent {
    const message: ChatMessage = {
      id: `${this.code}-${++this.seq}`,
      memberId: "",
      name: "",
      color: "#999",
      text,
      at: this.now(),
      kind: "system",
    };
    this.pushChat(message);
    return { type: "chat", message };
  }

  private pushChat(message: ChatMessage): void {
    this.chat.push(message);
    if (this.chat.length > MAX_CHAT) this.chat.splice(0, this.chat.length - MAX_CHAT);
  }

  private membersEvent(): ServerEvent {
    return { type: "members", members: [...this.members.values()], hostId: this.hostId };
  }

  private setPlayback(paused: boolean, position: number, rate = this.playback.rate): void {
    this.playback = { paused, position, rate, updatedAt: this.now() };
  }

  private playbackEvent(by: string | null, action: string): ServerEvent {
    return { type: "playback", playback: { ...this.playback }, holding: this.holding, by, action };
  }

  /** Re-evaluate the buffering hold after any member state change. */
  private reconcileHold(by: string | null): ServerEvent[] {
    const holding = this.holding;
    const now = this.now();
    if (holding.length && !this.playback.paused) {
      this.setPlayback(true, currentPosition(this.playback, now));
      return [this.playbackEvent(by, "hold")];
    }
    if (!holding.length && this.wantPlaying && this.playback.paused) {
      this.setPlayback(false, this.playback.position);
      return [this.playbackEvent(by, "resume")];
    }
    return [];
  }

  join(id: string, name: string): ServerEvent[] {
    const color = COLORS[this.members.size % COLORS.length]!;
    const member: Member = {
      id,
      name: name.trim().slice(0, 32) || "Guest",
      color,
      joinedAt: this.now(),
      buffering: false,
      // A newcomer must load the media before the room resumes.
      ready: this.media === null,
    };
    this.members.set(id, member);
    if (!this.hostId) this.hostId = id;
    this.lastActivity = this.now();
    return [this.membersEvent(), this.system(`${member.name} joined`), ...this.reconcileHold(null)];
  }

  leave(id: string): ServerEvent[] {
    const member = this.members.get(id);
    if (!member) return [];
    this.members.delete(id);
    if (this.hostId === id) this.hostId = this.members.keys().next().value ?? "";
    this.lastActivity = this.now();
    return [this.membersEvent(), this.system(`${member.name} left`), ...this.reconcileHold(null)];
  }

  private canControl(id: string): boolean {
    return this.settings.everyoneControls || id === this.hostId;
  }

  handle(id: string, msg: ClientMessage): ServerEvent[] {
    const member = this.members.get(id);
    if (!member) return [];
    this.lastActivity = this.now();
    const deny = (message: string): ServerEvent[] => [{ type: "error", message, to: id }];
    const controlTypes = new Set(["load", "play", "pause", "seek", "rate"]);
    if (controlTypes.has(msg.type) && !this.canControl(id)) return deny("Only the host can control playback");

    switch (msg.type) {
      case "load": {
        const media = normalizeMedia(msg.media);
        if (!media) return deny("Invalid media");
        this.media = media;
        this.wantPlaying = false;
        this.setPlayback(true, 0, 1);
        for (const m of this.members.values()) {
          m.ready = m.id === id;
          m.buffering = false;
        }
        return [
          { type: "media", media: this.media, playback: { ...this.playback }, by: id },
          this.membersEvent(),
          this.system(`${member.name} started “${this.media.title}”`),
        ];
      }
      case "play": {
        const position = sanitizePosition(msg.position);
        if (position === null) return deny("Invalid position");
        this.wantPlaying = true;
        const holding = this.holding;
        this.setPlayback(holding.length > 0, position);
        return [this.playbackEvent(id, holding.length ? "hold" : "play")];
      }
      case "pause": {
        const position = sanitizePosition(msg.position);
        if (position === null) return deny("Invalid position");
        this.wantPlaying = false;
        this.setPlayback(true, position);
        return [this.playbackEvent(id, "pause")];
      }
      case "seek": {
        const position = sanitizePosition(msg.position);
        if (position === null) return deny("Invalid position");
        this.setPlayback(this.playback.paused, position);
        return [this.playbackEvent(id, "seek")];
      }
      case "rate": {
        if (typeof msg.rate !== "number" || !(msg.rate >= 0.25 && msg.rate <= 3)) return deny("Invalid rate");
        this.setPlayback(this.playback.paused, currentPosition(this.playback, this.now()), msg.rate);
        return [this.playbackEvent(id, "rate")];
      }
      case "buffering": {
        if (member.buffering === Boolean(msg.buffering)) return [];
        member.buffering = Boolean(msg.buffering);
        return [this.membersEvent(), ...this.reconcileHold(id)];
      }
      case "ready": {
        if (member.ready === Boolean(msg.ready)) return [];
        member.ready = Boolean(msg.ready);
        return [this.membersEvent(), ...this.reconcileHold(id)];
      }
      case "chat": {
        const text = typeof msg.text === "string" ? msg.text.trim().slice(0, 500) : "";
        if (!text) return [];
        const message: ChatMessage = {
          id: `${this.code}-${++this.seq}`,
          memberId: id,
          name: member.name,
          color: member.color,
          text,
          at: this.now(),
          kind: "chat",
        };
        this.pushChat(message);
        return [{ type: "chat", message }];
      }
      case "reaction": {
        if (!REACTIONS.has(msg.emoji)) return [];
        return [{ type: "reaction", memberId: id, name: member.name, emoji: msg.emoji, at: this.now() }];
      }
      case "settings": {
        if (id !== this.hostId) return deny("Only the host can change room settings");
        const next = { ...this.settings };
        if (typeof msg.settings?.everyoneControls === "boolean") next.everyoneControls = msg.settings.everyoneControls;
        if (typeof msg.settings?.waitForAll === "boolean") next.waitForAll = msg.settings.waitForAll;
        this.settings = next;
        return [{ type: "settings", settings: { ...next }, by: id }, ...this.reconcileHold(id)];
      }
      case "transfer-host": {
        if (id !== this.hostId) return deny("Only the host can transfer host");
        const target = this.members.get(msg.memberId);
        if (!target) return deny("No such member");
        this.hostId = target.id;
        return [this.membersEvent(), this.system(`${target.name} is now the host`)];
      }
      case "kick": {
        if (id !== this.hostId) return deny("Only the host can remove members");
        const target = this.members.get(msg.memberId);
        if (!target || target.id === id) return deny("No such member");
        return [{ type: "kicked", memberId: target.id }, ...this.leave(target.id)];
      }
      case "rename": {
        const name = typeof msg.name === "string" ? msg.name.trim().slice(0, 32) : "";
        if (!name) return [];
        const old = member.name;
        member.name = name;
        return [this.membersEvent(), this.system(`${old} is now ${name}`)];
      }
      default:
        return deny("Unknown message");
    }
  }
}

export class RoomRegistry {
  private readonly rooms = new Map<string, Room>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly random: () => number = Math.random,
  ) {}

  create(): Room {
    let code = randomCode(this.random);
    while (this.rooms.has(code)) code = randomCode(this.random);
    const room = new Room(code, this.now);
    this.rooms.set(code, room);
    return room;
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code.toUpperCase());
  }

  get size(): number {
    return this.rooms.size;
  }

  /** Drop rooms that have been empty for longer than `emptyTtlMs`. */
  sweep(emptyTtlMs = 10 * 60_000): void {
    const now = this.now();
    for (const [code, room] of this.rooms) {
      if (room.members.size === 0 && now - room.lastActivity > emptyTtlMs) this.rooms.delete(code);
    }
  }
}
