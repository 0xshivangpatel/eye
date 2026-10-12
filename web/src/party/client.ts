// Watch-together client: a thin wrapper over the /party WebSocket with clock
// synchronisation and reconnection. React components subscribe to snapshots.
import type { PartyMedia } from "./shared";

export type { PartyMedia } from "./shared";

export interface Member {
  id: string;
  name: string;
  color: string;
  buffering: boolean;
  ready: boolean;
}
export interface Playback {
  paused: boolean;
  position: number;
  rate: number;
  updatedAt: number;
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
  everyoneControls: boolean;
  waitForAll: boolean;
}
export interface PartyState {
  status: "connecting" | "connected" | "closed" | "error";
  code: string | null;
  selfId: string | null;
  hostId: string | null;
  members: Member[];
  media: PartyMedia | null;
  playback: Playback;
  settings: RoomSettings;
  chat: ChatMessage[];
  holding: string[];
  error: string | null;
}

export interface PartyEvents {
  onState: (state: PartyState) => void;
  /** Playback command the player must apply (seek/play/pause/rate). */
  onPlaybackCommand: (playback: Playback, action: string, by: string | null) => void;
  /** New media selected by the host; player should load it. */
  onMedia: (media: PartyMedia | null) => void;
  onReaction: (memberId: string, name: string, emoji: string) => void;
}

const WS_URL = () => {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}/party`;
};

export class PartyClient {
  private ws: WebSocket | null = null;
  private clockOffset = 0; // serverTime - clientTime
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private closedByUser = false;
  readonly state: PartyState = {
    status: "connecting",
    code: null,
    selfId: null,
    hostId: null,
    members: [],
    media: null,
    playback: { paused: true, position: 0, rate: 1, updatedAt: Date.now() },
    settings: { everyoneControls: true, waitForAll: true },
    chat: [],
    holding: [],
    error: null,
  };

  constructor(
    private readonly name: string,
    private readonly join: { create: true } | { room: string },
    private readonly events: PartyEvents,
  ) {}

  get isHost(): boolean {
    return this.state.selfId !== null && this.state.selfId === this.state.hostId;
  }
  get canControl(): boolean {
    return this.state.settings.everyoneControls || this.isHost;
  }
  /** Server clock estimate for position math. */
  now(): number {
    return Date.now() + this.clockOffset;
  }

  connect(): void {
    this.closedByUser = false;
    const ws = new WebSocket(WS_URL());
    this.ws = ws;
    ws.addEventListener("open", () => {
      this.send({ type: "hello", name: this.name, ...this.join });
      this.pingTimer = setInterval(() => this.send({ type: "ping", t: Date.now() }), 10_000);
      this.send({ type: "ping", t: Date.now() });
    });
    ws.addEventListener("message", (e) => this.onMessage(JSON.parse(e.data as string)));
    ws.addEventListener("close", () => {
      if (this.pingTimer) clearInterval(this.pingTimer);
      if (!this.closedByUser) {
        this.patch({ status: "closed" });
      }
    });
    ws.addEventListener("error", () => this.patch({ status: "error", error: "Connection error" }));
  }

  private onMessage(msg: Record<string, unknown>): void {
    switch (msg.type) {
      case "pong": {
        const rtt = Date.now() - (msg.t as number);
        this.clockOffset = (msg.serverTime as number) + rtt / 2 - Date.now();
        return;
      }
      case "welcome": {
        const room = msg.room as any;
        this.clockOffset = (msg.serverTime as number) - Date.now();
        Object.assign(this.state, {
          status: "connected",
          selfId: msg.selfId as string,
          code: room.code,
          hostId: room.hostId,
          members: room.members,
          media: room.media,
          playback: room.playback,
          settings: room.settings,
          chat: room.chat,
          holding: room.holding,
        });
        this.emit();
        if (room.media) this.events.onMedia(room.media);
        return;
      }
      case "members":
        this.patch({ members: msg.members as Member[], hostId: msg.hostId as string });
        return;
      case "media":
        this.patch({ media: msg.media as PartyMedia | null, playback: msg.playback as Playback });
        this.events.onMedia(msg.media as PartyMedia | null);
        return;
      case "playback":
        this.patch({ playback: msg.playback as Playback, holding: (msg.holding as string[]) ?? [] });
        this.events.onPlaybackCommand(msg.playback as Playback, msg.action as string, (msg.by as string) ?? null);
        return;
      case "chat":
        this.state.chat = [...this.state.chat, msg.message as ChatMessage].slice(-200);
        this.emit();
        return;
      case "reaction":
        this.events.onReaction(msg.memberId as string, msg.name as string, msg.emoji as string);
        return;
      case "settings":
        this.patch({ settings: msg.settings as RoomSettings });
        return;
      case "error":
        this.patch({ error: msg.message as string });
        return;
    }
  }

  private patch(p: Partial<PartyState>): void {
    Object.assign(this.state, p);
    this.emit();
  }
  private emit(): void {
    this.events.onState({ ...this.state, members: [...this.state.members], chat: [...this.state.chat] });
  }

  private send(msg: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  // --- control surface used by the player ---
  loadMedia(media: PartyMedia): void {
    this.send({ type: "load", media });
  }
  play(position: number): void {
    this.send({ type: "play", position });
  }
  pause(position: number): void {
    this.send({ type: "pause", position });
  }
  seek(position: number): void {
    this.send({ type: "seek", position });
  }
  setRate(rate: number): void {
    this.send({ type: "rate", rate });
  }
  setBuffering(buffering: boolean): void {
    this.send({ type: "buffering", buffering });
  }
  setReady(ready: boolean): void {
    this.send({ type: "ready", ready });
  }
  chat(text: string): void {
    this.send({ type: "chat", text });
  }
  react(emoji: string): void {
    this.send({ type: "reaction", emoji });
  }
  updateSettings(settings: Partial<RoomSettings>): void {
    this.send({ type: "settings", settings });
  }
  transferHost(memberId: string): void {
    this.send({ type: "transfer-host", memberId });
  }
  kick(memberId: string): void {
    this.send({ type: "kick", memberId });
  }

  close(): void {
    this.closedByUser = true;
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.ws?.close();
  }
}
