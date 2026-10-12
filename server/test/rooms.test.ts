import { describe, expect, it } from "vitest";
import { Room, RoomRegistry, currentPosition, normalizeMedia, type PartyMedia } from "../src/party/rooms.js";

const media: PartyMedia = { key: "tt1:url", title: "Movie", stream: { url: "https://x/y.mp4" } };

function setup() {
  let now = 1_000_000;
  const clock = { tick: (ms: number) => (now += ms), now: () => now };
  const room = new Room("ABCDEF", clock.now);
  room.join("a", "Alice");
  room.join("b", "Bob");
  return { room, clock };
}

describe("Room", () => {
  it("makes the first member host and hands host over when they leave", () => {
    const { room } = setup();
    expect(room.hostId).toBe("a");
    room.leave("a");
    expect(room.hostId).toBe("b");
  });

  it("holds playback until every member has loaded the media, then resumes", () => {
    const { room, clock } = setup();
    room.handle("a", { type: "load", media });
    expect(room.holding).toEqual(["Bob"]);
    const play = room.handle("a", { type: "play", position: 0 });
    expect(play[0]).toMatchObject({ type: "playback", action: "hold", playback: { paused: true } });
    clock.tick(500);
    const ready = room.handle("b", { type: "ready", ready: true });
    const resumed = ready.find((e) => e.type === "playback");
    expect(resumed).toMatchObject({ action: "resume", playback: { paused: false, position: 0 } });
  });

  it("tracks position over time and pauses everyone while someone buffers", () => {
    const { room, clock } = setup();
    room.handle("a", { type: "load", media });
    room.handle("b", { type: "ready", ready: true });
    room.handle("a", { type: "play", position: 10 });
    clock.tick(4_000);
    expect(currentPosition(room.playback, clock.now())).toBeCloseTo(14);
    const hold = room.handle("b", { type: "buffering", buffering: true });
    expect(hold.find((e) => e.type === "playback")).toMatchObject({ action: "hold", playback: { paused: true, position: 14 } });
    clock.tick(2_000);
    expect(currentPosition(room.playback, clock.now())).toBeCloseTo(14);
    const resume = room.handle("b", { type: "buffering", buffering: false });
    expect(resume.find((e) => e.type === "playback")).toMatchObject({ action: "resume", playback: { paused: false } });
    clock.tick(1_000);
    expect(currentPosition(room.playback, clock.now())).toBeCloseTo(15);
  });

  it("does not resume after an explicit pause even if buffering clears", () => {
    const { room } = setup();
    room.handle("a", { type: "load", media });
    room.handle("b", { type: "ready", ready: true });
    room.handle("a", { type: "play", position: 0 });
    room.handle("b", { type: "buffering", buffering: true });
    room.handle("a", { type: "pause", position: 3 });
    const events = room.handle("b", { type: "buffering", buffering: false });
    expect(events.some((e) => e.type === "playback")).toBe(false);
    expect(room.playback.paused).toBe(true);
  });

  it("enforces host-only control, settings and kick permissions", () => {
    const { room } = setup();
    expect(room.handle("b", { type: "settings", settings: { everyoneControls: false } })[0]).toMatchObject({ type: "error", to: "b" });
    room.handle("a", { type: "settings", settings: { everyoneControls: false } });
    expect(room.handle("b", { type: "pause", position: 1 })[0]).toMatchObject({ type: "error" });
    expect(room.handle("a", { type: "pause", position: 1 })[0]).toMatchObject({ type: "playback" });
    const kicked = room.handle("a", { type: "kick", memberId: "b" });
    expect(kicked[0]).toEqual({ type: "kicked", memberId: "b" });
    expect(room.members.has("b")).toBe(false);
  });

  it("rejects invalid input and caps chat", () => {
    const { room } = setup();
    expect(room.handle("a", { type: "seek", position: -1 })[0]).toMatchObject({ type: "error" });
    expect(room.handle("a", { type: "rate", rate: 10 })[0]).toMatchObject({ type: "error" });
    expect(room.handle("a", { type: "reaction", emoji: "<script>" })).toEqual([]);
    expect(room.handle("a", { type: "chat", text: "  " })).toEqual([]);
    for (let i = 0; i < 250; i++) room.handle("a", { type: "chat", text: `m${i}` });
    expect(room.chat.length).toBe(200);
    expect(room.snapshot().chat.length).toBe(50);
  });
});

describe("normalizeMedia", () => {
  it("accepts addon/youtube/web and rejects malformed payloads", () => {
    expect(normalizeMedia({ key: "k", title: "T", stream: { url: "x" } })!.source).toBe("addon");
    expect(normalizeMedia({ key: "k", title: "T", source: "youtube", youtubeId: "dQw4w9WgXcQ" })!.youtubeId).toBe("dQw4w9WgXcQ");
    expect(normalizeMedia({ key: "k", title: "T", source: "web", url: "https://x/y.mp4" })!.url).toBe("https://x/y.mp4");
    expect(normalizeMedia({ key: "k", title: "T", source: "youtube", youtubeId: "bad" })).toBeNull();
    expect(normalizeMedia({ key: "k", title: "T", source: "web", url: "javascript:alert(1)" })).toBeNull();
    expect(normalizeMedia({ key: "k", title: "T", source: "addon" })).toBeNull();
  });
  it("loads a youtube source into a room and syncs playback", () => {
    let now = 0; const room = new Room("YT1234", () => now);
    room.join("a", "A"); room.join("b", "B");
    const ev = room.handle("a", { type: "load", media: { key: "yt:abc", title: "Clip", source: "youtube", youtubeId: "dQw4w9WgXcQ" } as unknown as PartyMedia });
    expect(ev.find((e) => e.type === "media")).toMatchObject({ media: { source: "youtube", youtubeId: "dQw4w9WgXcQ" } });
    expect(room.media!.source).toBe("youtube");
  });
});

describe("RoomRegistry", () => {
  it("creates unique codes and sweeps empty rooms", () => {
    let now = 0;
    const seq = [0, 0, 0, 0, 0, 0, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
    let i = 0;
    const reg = new RoomRegistry(() => now, () => seq[i++ % seq.length]!);
    const a = reg.create();
    const b = reg.create();
    expect(a.code).not.toBe(b.code);
    expect(reg.get(a.code.toLowerCase())).toBe(a);
    now += 11 * 60_000;
    reg.sweep();
    expect(reg.size).toBe(0);
  });
});
