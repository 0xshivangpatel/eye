import { afterEach, beforeEach, describe, expect, it } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import type { Request, Response } from "express";
import { AccountStore, hashPassword, verifyPassword } from "../src/accounts.js";
import { SessionManager } from "../src/auth.js";

let tmp: string;
let file: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "marquee-auth-"));
  file = path.join(tmp, "accounts.json");
  delete process.env.MARQUEE_ADMIN_USER;
  delete process.env.MARQUEE_ADMIN_PASSWORD;
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("password hashing", () => {
  it("round-trips and rejects wrong passwords", () => {
    const h = hashPassword("correct horse");
    expect(h.startsWith("scrypt$")).toBe(true);
    expect(verifyPassword("correct horse", h)).toBe(true);
    expect(verifyPassword("wrong", h)).toBe(false);
    expect(verifyPassword("x", "garbage")).toBe(false);
  });
});

describe("AccountStore", () => {
  it("seeds the admin from env and authenticates it", () => {
    process.env.MARQUEE_ADMIN_USER = "aeon";
    process.env.MARQUEE_ADMIN_PASSWORD = "aeonsystemoverload";
    const store = new AccountStore(file);
    expect(store.list()).toHaveLength(1);
    expect(store.list()[0]).toMatchObject({ username: "aeon", role: "admin" });
    expect(store.authenticate("AEON", "aeonsystemoverload")?.role).toBe("admin");
    expect(store.authenticate("aeon", "nope")).toBeNull();
    // Hashes are never serialized in the public list.
    expect(JSON.stringify(store.list())).not.toContain("scrypt$");
  });

  it("persists across reloads and never stores plaintext", () => {
    process.env.MARQUEE_ADMIN_PASSWORD = "aeonsystemoverload";
    new AccountStore(file);
    const raw = fs.readFileSync(file, "utf8");
    expect(raw).not.toContain("aeonsystemoverload");
    const reloaded = new AccountStore(file);
    expect(reloaded.list()).toHaveLength(1); // did not re-seed a second admin
  });

  it("creates and removes members with validation", () => {
    const store = new AccountStore(file);
    const u = store.create("Friend_1", "hunter2", "user");
    expect(u).toMatchObject({ username: "friend_1", role: "user" });
    expect(() => store.create("friend_1", "another", "user")).toThrow(/taken/i);
    expect(() => store.create("x", "hunter2", "user")).toThrow(/2.?32/);
    expect(() => store.create("okname", "short", "user")).toThrow(/6 characters/);
    store.remove(u.id);
    expect(store.list().some((a) => a.id === u.id)).toBe(false);
  });

  it("refuses to delete the only admin", () => {
    const store = new AccountStore(file);
    const admin = store.list()[0]!;
    expect(() => store.remove(admin.id)).toThrow(/only admin/i);
  });
});

function mockReq(opts: { cookie?: string; remote?: string; adminHeader?: string } = {}): Request {
  return {
    headers: { ...(opts.cookie ? { cookie: opts.cookie } : {}), ...(opts.adminHeader ? { "x-marquee-admin": opts.adminHeader } : {}) },
    socket: { remoteAddress: opts.remote ?? "203.0.113.9" },
  } as unknown as Request;
}
function mockRes(): Response & { statusCode: number; body: unknown } {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res as unknown as Response & { statusCode: number; body: unknown };
}

describe("SessionManager", () => {
  it("rejects unauthenticated remote requests and accepts a valid session cookie", () => {
    const sm = new SessionManager(null, false);
    const sid = sm.create({ id: "1", username: "bob", role: "user" });

    const res1 = mockRes();
    let called = false;
    sm.requireAuth(mockReq({ remote: "203.0.113.9" }), res1, () => (called = true));
    expect(called).toBe(false);
    expect(res1.statusCode).toBe(401);

    const res2 = mockRes();
    called = false;
    sm.requireAuth(mockReq({ cookie: `marquee_sid=${sid}`, remote: "203.0.113.9" }), res2, () => (called = true));
    expect(called).toBe(true);
  });

  it("treats loopback and the admin token as admin, blocks non-admin users", () => {
    const sm = new SessionManager("s3cret", false);
    // loopback => admin bypass
    let ok = false;
    sm.requireAdmin(mockReq({ remote: "127.0.0.1" }), mockRes(), () => (ok = true));
    expect(ok).toBe(true);
    // admin token header => admin
    ok = false;
    sm.requireAdmin(mockReq({ adminHeader: "s3cret" }), mockRes(), () => (ok = true));
    expect(ok).toBe(true);
    // a normal user session is authed but not admin
    const sid = sm.create({ id: "2", username: "carol", role: "user" });
    const res = mockRes();
    ok = false;
    sm.requireAdmin(mockReq({ cookie: `marquee_sid=${sid}` }), res, () => (ok = true));
    expect(ok).toBe(false);
    expect(res.statusCode).toBe(403);
  });

  it("authorizes websocket upgrades for sessions and loopback only", () => {
    const sm = new SessionManager(null, false);
    const sid = sm.create({ id: "3", username: "dave", role: "user" });
    expect(sm.authorizeSocket({ headers: {}, socket: { remoteAddress: "203.0.113.9" } } as never)).toBe(false);
    expect(sm.authorizeSocket({ headers: {}, socket: { remoteAddress: "127.0.0.1" } } as never)).toBe(true);
    expect(sm.authorizeSocket({ headers: { cookie: `marquee_sid=${sid}` }, socket: { remoteAddress: "203.0.113.9" } } as never)).toBe(true);
  });
});
