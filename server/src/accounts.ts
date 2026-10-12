// User accounts for the private app. There is no public sign-up: the seeded
// admin creates every other account. Passwords are stored only as scrypt
// hashes in accounts.json (0600), outside the repo.
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { appDir } from "./settings.js";

export type Role = "admin" | "user";

export interface Account {
  id: string;
  username: string;
  role: Role;
  passwordHash: string;
  createdAt: number;
}

export interface PublicAccount {
  id: string;
  username: string;
  role: Role;
  createdAt: number;
}

const SCRYPT_KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  try {
    const salt = Buffer.from(parts[1]!, "base64");
    const expected = Buffer.from(parts[2]!, "base64");
    const actual = scryptSync(password, salt, expected.length);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

export class AccountStore {
  private accounts: Account[] = [];
  /**
   * Set once, on first run, when no MARQUEE_ADMIN_PASSWORD was provided and a
   * password had to be generated. The caller prints it to the server log so the
   * operator can sign in and change it. No password literal lives in source.
   */
  readonly generatedAdminPassword: string | null;

  constructor(private readonly file = path.join(appDir(), "accounts.json")) {
    try {
      this.accounts = JSON.parse(fs.readFileSync(file, "utf8")) as Account[];
    } catch {
      this.accounts = [];
    }
    this.generatedAdminPassword = this.seedAdmin();
  }

  /**
   * Ensure the admin account exists on first run. Username and password come
   * from MARQUEE_ADMIN_USER / MARQUEE_ADMIN_PASSWORD. When no password is set,
   * a strong random one is generated and returned so the caller can print it
   * once; there is no hardcoded default.
   */
  private seedAdmin(): string | null {
    if (this.accounts.some((a) => a.role === "admin")) return null;
    const username = normalizeUsername(process.env.MARQUEE_ADMIN_USER || "aeon");
    const provided = process.env.MARQUEE_ADMIN_PASSWORD;
    const generated = provided ? null : randomBytes(12).toString("base64url");
    this.accounts.push({
      id: randomBytes(8).toString("hex"),
      username,
      role: "admin",
      passwordHash: hashPassword(provided ?? generated!),
      createdAt: Date.now(),
    });
    this.save();
    return generated;
  }

  private save(): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.accounts, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }

  authenticate(username: string, password: string): Account | null {
    const account = this.accounts.find((a) => a.username === normalizeUsername(username));
    if (!account) {
      // Hash anyway to keep timing uniform against username enumeration.
      verifyPassword(password, "scrypt$AAAA$AAAA");
      return null;
    }
    return verifyPassword(password, account.passwordHash) ? account : null;
  }

  get(id: string): Account | undefined {
    return this.accounts.find((a) => a.id === id);
  }

  list(): PublicAccount[] {
    return this.accounts.map(({ passwordHash: _hash, ...rest }) => rest);
  }

  create(username: string, password: string, role: Role): PublicAccount {
    const normalized = normalizeUsername(username);
    if (!/^[a-z0-9._-]{2,32}$/.test(normalized)) throw new Error("Username must be 2–32 chars: letters, digits, . _ -");
    if (password.length < 6) throw new Error("Password must be at least 6 characters");
    if (this.accounts.some((a) => a.username === normalized)) throw new Error("That username is taken");
    const account: Account = {
      id: randomBytes(8).toString("hex"),
      username: normalized,
      role,
      passwordHash: hashPassword(password),
      createdAt: Date.now(),
    };
    this.accounts.push(account);
    this.save();
    const { passwordHash: _h, ...pub } = account;
    return pub;
  }

  setPassword(id: string, password: string): void {
    const account = this.get(id);
    if (!account) throw new Error("No such account");
    if (password.length < 6) throw new Error("Password must be at least 6 characters");
    account.passwordHash = hashPassword(password);
    this.save();
  }

  remove(id: string): void {
    const account = this.get(id);
    if (!account) throw new Error("No such account");
    if (account.role === "admin" && this.accounts.filter((a) => a.role === "admin").length === 1) {
      throw new Error("Cannot delete the only admin account");
    }
    this.accounts = this.accounts.filter((a) => a.id !== id);
    this.save();
  }
}
