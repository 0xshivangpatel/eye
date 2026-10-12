// Cookie-based sessions for the private app. Sessions live in memory (a restart
// forces re-login, which is fine for a small group) and are keyed by a random
// id carried in an httpOnly cookie.
import { randomBytes } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { NextFunction, Request, Response } from "express";
import type { AccountStore, Role } from "./accounts.js";

export const SESSION_COOKIE = "marquee_sid";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface SessionUser {
  id: string;
  username: string;
  role: Role;
}

interface Session extends SessionUser {
  expires: number;
}

export interface AuthedRequest extends Request {
  user?: SessionUser;
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

export class SessionManager {
  private readonly sessions = new Map<string, Session>();

  constructor(
    private readonly adminToken: string | null,
    private readonly trustLan: boolean,
    /** Treat loopback requests as admin (host-local setup). Disable to force login everywhere. */
    private readonly loopbackAdmin: boolean = true,
  ) {}

  create(user: SessionUser): string {
    const sid = randomBytes(24).toString("base64url");
    this.sessions.set(sid, { ...user, expires: Date.now() + SESSION_TTL_MS });
    return sid;
  }

  destroy(sid: string | undefined): void {
    if (sid) this.sessions.delete(sid);
  }

  lookup(sid: string | undefined): SessionUser | null {
    if (!sid) return null;
    const session = this.sessions.get(sid);
    if (!session) return null;
    if (session.expires < Date.now()) {
      this.sessions.delete(sid);
      return null;
    }
    return { id: session.id, username: session.username, role: session.role };
  }

  cookie(sid: string, secure: boolean): string {
    const attrs = [
      `${SESSION_COOKIE}=${sid}`,
      "HttpOnly",
      "SameSite=Lax",
      "Path=/",
      `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
    ];
    if (secure) attrs.push("Secure");
    return attrs.join("; ");
  }

  clearCookie(): string {
    return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
  }

  /** Resolve the user for a request from its session cookie. */
  userFromRequest(req: IncomingMessage): SessionUser | null {
    const cookies = parseCookies(req.headers.cookie);
    return this.lookup(cookies[SESSION_COOKIE]);
  }

  /** Whether a WebSocket upgrade may proceed: valid session, or headless bypass. */
  authorizeSocket(req: IncomingMessage): boolean {
    if (this.userFromRequest(req)) return true;
    if (this.trustLan) return true;
    if (!this.loopbackAdmin) return false;
    const addr = req.socket.remoteAddress;
    return Boolean(addr && (addr === "::1" || addr.startsWith("127.") || addr.startsWith("::ffff:127.")));
  }

  /**
   * Headless/admin bypass: a loopback request, or one carrying the configured
   * admin token, acts as a synthetic admin. This keeps CLI/VPS setup working
   * before any browser login and is how automated setup seeds the token.
   */
  private bypassAdmin(req: Request): SessionUser | null {
    if (this.trustLan) return { id: "system", username: "system", role: "admin" };
    const addr = req.socket.remoteAddress;
    if (this.loopbackAdmin && addr && (addr === "::1" || addr.startsWith("127.") || addr.startsWith("::ffff:127."))) {
      return { id: "system", username: "system", role: "admin" };
    }
    if (this.adminToken) {
      const header = req.headers["x-marquee-admin"];
      const supplied = typeof header === "string" ? header : undefined;
      if (supplied && supplied === this.adminToken) return { id: "system", username: "system", role: "admin" };
    }
    return null;
  }

  resolve(req: Request): SessionUser | null {
    return this.userFromRequest(req) ?? this.bypassAdmin(req);
  }

  requireAuth = (req: Request, res: Response, next: NextFunction): void => {
    const user = this.resolve(req);
    if (!user) {
      res.status(401).json({ error: "Sign in to continue", code: "unauthenticated" });
      return;
    }
    (req as AuthedRequest).user = user;
    next();
  };

  requireAdmin = (req: Request, res: Response, next: NextFunction): void => {
    const user = this.resolve(req);
    if (!user) {
      res.status(401).json({ error: "Sign in to continue", code: "unauthenticated" });
      return;
    }
    if (user.role !== "admin") {
      res.status(403).json({ error: "Admins only", code: "forbidden" });
      return;
    }
    (req as AuthedRequest).user = user;
    next();
  };
}

export function loginUser(accounts: AccountStore, username: string, password: string): SessionUser | null {
  const account = accounts.authenticate(username, password);
  return account ? { id: account.id, username: account.username, role: account.role } : null;
}
