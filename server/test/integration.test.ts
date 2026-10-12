import { afterAll, beforeAll, describe, expect, it } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { WebSocket } from "ws";
import { createServer } from "../src/app.js";

// Boots the real Express + WebSocket server (no network to third parties) and
// drives two watch-together clients through a full sync handshake.

let instance: ReturnType<typeof createServer>;
let base: string;
let wsBase: string;
let tmp: string;

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "marquee-it-"));
  process.env.MARQUEE_ADMIN_USER = "aeon";
  process.env.MARQUEE_ADMIN_PASSWORD = "aeonsystemoverload";
  instance = createServer({
    settingsFile: path.join(tmp, "settings.json"),
    accountsFile: path.join(tmp, "accounts.json"),
    cacheRoot: path.join(tmp, "cache"),
    webRoot: null,
    // A fetch stub so no test ever reaches the real internet.
    fetchImpl: (async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith("/user")) return new Response(JSON.stringify({ username: "tester", type: "premium" }), { status: 200 });
      return new Response("{}", { status: 200 });
    }) as typeof fetch,
  });
  await new Promise<void>((resolve) => instance.server.listen(0, "127.0.0.1", resolve));
  const { port } = instance.server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
  wsBase = `ws://127.0.0.1:${port}/party`;
});

afterAll(async () => {
  await instance.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

function connect(): Promise<WebSocket> {
  const ws = new WebSocket(wsBase);
  return once(ws, "open").then(() => ws);
}

function nextMessage(ws: WebSocket, predicate: (msg: any) => boolean, timeoutMs = 3000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out waiting for message")), timeoutMs);
    const onMessage = (data: Buffer) => {
      const msg = JSON.parse(String(data));
      if (predicate(msg)) {
        clearTimeout(timer);
        ws.off("message", onMessage);
        resolve(msg);
      }
    };
    ws.on("message", onMessage);
  });
}

describe("auth", () => {
  it("logs in the seeded admin, rejects bad credentials, and manages users", async () => {
    // Login requests originate from loopback in tests, but the login route
    // still verifies the password against the account store.
    const bad = await fetch(`${base}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "aeon", password: "wrong" }),
    });
    expect(bad.status).toBe(401);

    const ok = await fetch(`${base}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "aeon", password: "aeonsystemoverload" }),
    });
    expect(ok.status).toBe(200);
    expect((await ok.json()).user).toMatchObject({ username: "aeon", role: "admin" });
    const cookie = ok.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("marquee_sid=");
    expect(cookie).toContain("HttpOnly");

    // Admin creates a member account.
    const created = await fetch(`${base}/auth/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "friend", password: "letmein", role: "user" }),
    });
    expect(created.status).toBe(201);
    const list = await (await fetch(`${base}/auth/users`)).json();
    expect(list.users.map((u: { username: string }) => u.username).sort()).toEqual(["aeon", "friend"]);

    // The member can log in.
    const memberLogin = await fetch(`${base}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "friend", password: "letmein" }),
    });
    expect(memberLogin.status).toBe(200);
    expect((await memberLogin.json()).user.role).toBe("user");
  });
});

describe("HTTP endpoints", () => {
  it("serves heartbeat, settings and the built-in add-on manifest", async () => {
    expect(await (await fetch(`${base}/heartbeat`)).json()).toEqual({ success: true });
    const settings = await (await fetch(`${base}/settings`)).json();
    expect(settings.app).toBe("marquee");
    expect(settings.values.debrid).toBeNull();
    const manifest = await (await fetch(`${base}/addon/open-movies/manifest.json`)).json();
    expect(manifest.id).toBe("app.marquee.openmovies");
    const catalog = await (await fetch(`${base}/addon/open-movies/catalog/movie/open-movies.json`)).json();
    expect(catalog.metas.length).toBeGreaterThan(0);
    const stream = await (await fetch(`${base}/addon/open-movies/stream/movie/tt1727587.json`)).json();
    expect(stream.streams.some((s: any) => s.infoHash)).toBe(true);
  });

  it("configures and reports debrid without ever echoing the token", async () => {
    const set = await fetch(`${base}/debrid/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "realdebrid", token: "secret-token-value" }),
    });
    expect(set.status).toBe(200);
    const status = await (await fetch(`${base}/debrid/status`)).json();
    expect(status).toMatchObject({ configured: true, provider: "realdebrid", user: { username: "tester", premium: true } });
    // The persisted settings file holds the token; the HTTP surface must not.
    const publicSettings = await (await fetch(`${base}/settings`)).text();
    expect(publicSettings).not.toContain("secret-token-value");
    const available = await (await fetch(`${base}/debrid/available`)).json();
    expect(available).toMatchObject({ configured: true, provider: "realdebrid" });
    const raw = fs.readFileSync(path.join(tmp, "settings.json"), "utf8");
    expect(raw).toContain("secret-token-value");
  });
});

describe("watch-together over WebSocket", () => {
  it("syncs two clients through load, buffering hold, resume and chat", async () => {
    const host = await connect();
    host.send(JSON.stringify({ type: "hello", name: "Host", create: true }));
    const welcome = await nextMessage(host, (m) => m.type === "welcome");
    const code = welcome.room.code as string;
    expect(code).toMatch(/^[A-Z0-9]{6}$/);

    const guest = await connect();
    guest.send(JSON.stringify({ type: "hello", name: "Guest", room: code }));
    await nextMessage(guest, (m) => m.type === "welcome");
    // Host sees the guest join.
    await nextMessage(host, (m) => m.type === "members" && m.members.length === 2);

    // Host loads a YouTube source; both get the media event.
    host.send(JSON.stringify({ type: "load", media: { key: "yt:dQw4w9WgXcQ", title: "Clip", source: "youtube", youtubeId: "dQw4w9WgXcQ" } }));
    const guestMedia = await nextMessage(guest, (m) => m.type === "media");
    expect(guestMedia.media.youtubeId).toBe("dQw4w9WgXcQ");

    // Host hits play, but the guest has not reported ready yet -> room holds.
    host.send(JSON.stringify({ type: "play", position: 0 }));
    const held = await nextMessage(guest, (m) => m.type === "playback" && m.action === "hold");
    expect(held.playback.paused).toBe(true);
    expect(held.holding).toContain("Guest");

    // Guest reports ready -> room resumes for everyone.
    guest.send(JSON.stringify({ type: "ready", ready: true }));
    const resumed = await nextMessage(host, (m) => m.type === "playback" && m.action === "resume");
    expect(resumed.playback.paused).toBe(false);

    // Chat relays to the other member.
    guest.send(JSON.stringify({ type: "chat", text: "hi there" }));
    const chat = await nextMessage(host, (m) => m.type === "chat" && m.message.kind === "chat");
    expect(chat.message).toMatchObject({ name: "Guest", text: "hi there" });

    // Non-host cannot change room settings.
    guest.send(JSON.stringify({ type: "settings", settings: { everyoneControls: false } }));
    const err = await nextMessage(guest, (m) => m.type === "error");
    expect(err.message).toMatch(/host/i);

    host.close();
    guest.close();
  });

  it("rejects joining a nonexistent room", async () => {
    const ws = await connect();
    ws.send(JSON.stringify({ type: "hello", name: "x", room: "ZZZZZZ" }));
    const err = await nextMessage(ws, (m) => m.type === "error");
    expect(err.code).toBe("room_not_found");
    ws.close();
  });
});
