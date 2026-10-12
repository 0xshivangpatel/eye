import { Router, type Request } from "express";
import type { AccountStore, Role } from "../accounts.js";
import { loginUser, SESSION_COOKIE, parseCookies, type AuthedRequest, type SessionManager } from "../auth.js";

function isSecure(req: Request): boolean {
  return req.secure || req.headers["x-forwarded-proto"] === "https";
}

export function authRouter(accounts: AccountStore, sessions: SessionManager): Router {
  const router = Router();

  router.post("/login", (req, res) => {
    const { username, password } = (req.body ?? {}) as { username?: string; password?: string };
    if (typeof username !== "string" || typeof password !== "string") {
      res.status(400).json({ error: "Username and password are required" });
      return;
    }
    const user = loginUser(accounts, username, password);
    if (!user) {
      res.status(401).json({ error: "Incorrect username or password" });
      return;
    }
    const sid = sessions.create(user);
    res.setHeader("Set-Cookie", sessions.cookie(sid, isSecure(req)));
    res.json({ user });
  });

  router.post("/logout", (req, res) => {
    sessions.destroy(parseCookies(req.headers.cookie)[SESSION_COOKIE]);
    res.setHeader("Set-Cookie", sessions.clearCookie());
    res.json({ ok: true });
  });

  router.get("/me", (req, res) => {
    const user = sessions.resolve(req);
    if (!user) {
      res.status(401).json({ error: "Not signed in" });
      return;
    }
    res.json({ user });
  });

  // --- admin: manage accounts ---
  router.get("/users", sessions.requireAdmin, (_req, res) => {
    res.json({ users: accounts.list() });
  });

  router.post("/users", sessions.requireAdmin, (req, res) => {
    const { username, password, role } = (req.body ?? {}) as { username?: string; password?: string; role?: Role };
    if (typeof username !== "string" || typeof password !== "string") {
      res.status(400).json({ error: "Username and password are required" });
      return;
    }
    try {
      const user = accounts.create(username, password, role === "admin" ? "admin" : "user");
      res.status(201).json({ user });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  router.post("/users/:id/password", sessions.requireAdmin, (req, res) => {
    const { password } = (req.body ?? {}) as { password?: string };
    if (typeof password !== "string") {
      res.status(400).json({ error: "Password is required" });
      return;
    }
    try {
      accounts.setPassword(String(req.params.id), password);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  router.delete("/users/:id", sessions.requireAdmin, (req, res) => {
    const self = (req as AuthedRequest).user;
    if (self && self.id === req.params.id) {
      res.status(400).json({ error: "You cannot delete your own account" });
      return;
    }
    try {
      accounts.remove(String(req.params.id));
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  return router;
}
