import { useEffect, useState } from "react";
import { useStore } from "../store";
import { serverApi, iptvApi } from "../api/server";
import { useDisplayName } from "../player";
import { useAuth } from "../auth";
import { authApi, type User } from "../api/auth";

export function Settings() {
  const [name, setName] = useDisplayName();
  const { isAdmin } = useAuth();
  return (
    <div className="page page-pad settings">
      <h1 className="page-h1">Settings</h1>
      <AccountSection name={name} setName={setName} />
      {isAdmin && <UsersSection />}
      {isAdmin && <DebridSection />}
      <AddonsSection />
      <IptvSection />
    </div>
  );
}

function AccountSection({ name, setName }: { name: string; setName: (n: string) => void }) {
  const { user, logout } = useAuth();
  return (
    <section className="settings-card">
      <h2>Account</h2>
      <p className="muted">
        Signed in as <strong>{user?.username}</strong> ({user?.role}).
      </p>
      <label className="field">
        <span>Display name (shown in watch-together)</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
      </label>
      <button className="btn" onClick={() => void logout()} type="button">
        Sign out
      </button>
    </section>
  );
}

function UsersSection() {
  const { user: self } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [form, setForm] = useState({ username: "", password: "", role: "user" as "user" | "admin" });
  const [msg, setMsg] = useState<string | null>(null);

  const refresh = () => authApi.listUsers().then((r) => setUsers(r.users)).catch((e) => setMsg(e.message));
  useEffect(() => {
    void refresh();
  }, []);

  const create = async () => {
    setMsg(null);
    try {
      await authApi.createUser(form.username, form.password, form.role);
      setForm({ username: "", password: "", role: "user" });
      await refresh();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  const remove = async (id: string) => {
    setMsg(null);
    try {
      await authApi.deleteUser(id);
      await refresh();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  const resetPassword = async (id: string) => {
    const pw = prompt("New password (min 6 characters):");
    if (!pw) return;
    try {
      await authApi.setPassword(id, pw);
      setMsg("Password updated.");
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  return (
    <section className="settings-card">
      <h2>People</h2>
      <p className="muted">There is no public sign-up. Create an account for each person you want to let in.</p>
      <div className="user-form">
        <input placeholder="Username" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
        <input placeholder="Password" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as "user" | "admin" })}>
          <option value="user">User</option>
          <option value="admin">Admin</option>
        </select>
        <button className="btn btn-primary" disabled={!form.username || !form.password} onClick={create} type="button">
          Create
        </button>
      </div>
      {msg && <div className="field-msg">{msg}</div>}
      <ul className="addon-list">
        {users.map((u) => (
          <li key={u.id}>
            <div>
              <strong>{u.username}</strong> <span className="muted small">{u.role}</span>
              {u.id === self?.id && <span className="tag">you</span>}
            </div>
            <div className="party-buttons">
              <button className="btn" onClick={() => resetPassword(u.id)} type="button">
                Reset password
              </button>
              {u.id !== self?.id && (
                <button className="btn" onClick={() => remove(u.id)} type="button">
                  Remove
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function DebridSection() {
  const store = useStore();
  const [status, setStatus] = useState<{ configured: boolean; provider?: string; user?: { username: string; premium: boolean; expiration?: string }; error?: string } | null>(null);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const refresh = () => serverApi.debridStatus().then(setStatus).catch((e) => setStatus({ configured: false, error: e.message }));
  useEffect(() => {
    void refresh();
  }, [store.adminToken]);

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await serverApi.setDebridToken(token.trim());
      setMsg(res.user ? `Linked ${res.user.username} (${res.user.premium ? "premium" : "free"})` : "Saved");
      setToken("");
      await refresh();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="settings-card">
      <h2>Debrid (Real-Debrid)</h2>
      <p className="muted">
        Your token is stored only on the server and is never shown again. On a shared VPS, set it once here (as admin); your
        guests stream through it without ever seeing it.
      </p>
      {status?.configured ? (
        <div className="debrid-status">
          <span className="ok-dot" /> Linked
          {status.user && (
            <>
              {" "}
              as <strong>{status.user.username}</strong> ({status.user.premium ? "premium" : "free"}
              {status.user.expiration ? `, until ${new Date(status.user.expiration).toLocaleDateString()}` : ""})
            </>
          )}
          {status.error && <span className="warn"> — {status.error}</span>}
          <button className="btn" onClick={() => void serverApi.clearDebrid().then(refresh)} type="button">
            Unlink
          </button>
        </div>
      ) : (
        <div className="muted">Not linked.{status?.error ? ` (${status.error})` : ""}</div>
      )}
      <div className="field-row">
        <input value={token} onChange={(e) => setToken(e.target.value)} placeholder="Paste your Real-Debrid API token" type="password" />
        <button className="btn btn-primary" disabled={busy || !token.trim()} onClick={save} type="button">
          {busy ? "Linking…" : "Link account"}
        </button>
      </div>
      <p className="muted small">
        Get a token at <a href="https://real-debrid.com/apitoken" target="_blank" rel="noreferrer">real-debrid.com/apitoken</a>.
      </p>
      {msg && <div className="field-msg">{msg}</div>}
    </section>
  );
}

function AddonsSection() {
  const store = useStore();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const add = async () => {
    setBusy(true);
    setErr(null);
    try {
      await store.installAddon(url.trim());
      setUrl("");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="settings-card">
      <h2>Add-ons</h2>
      <p className="muted">Add any Stremio-compatible add-on by its manifest URL. Catalogs appear on Home; streams appear on each title.</p>
      <div className="field-row">
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…/manifest.json" />
        <button className="btn btn-primary" disabled={busy || !url.trim()} onClick={add} type="button">
          Install
        </button>
      </div>
      {err && <div className="field-msg">{err}</div>}
      <ul className="addon-list">
        {store.addons.map((a) => (
          <li key={a.transportUrl}>
            <div>
              <strong>{a.manifest.name}</strong> <span className="muted small">v{a.manifest.version}</span>
              <div className="muted small">{a.manifest.description}</div>
            </div>
            <button className="btn" onClick={() => store.removeAddon(a.transportUrl)} type="button">
              Remove
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function IptvSection() {
  const store = useStore();
  const [m3uUrl, setM3uUrl] = useState("");
  const [m3uLabel, setM3uLabel] = useState("");
  const [xt, setXt] = useState({ label: "", server: "", username: "", password: "" });
  const [msg, setMsg] = useState<string | null>(null);

  const addM3U = () => {
    if (!m3uUrl.trim()) return;
    store.addIptv({ id: `m3u-${Date.now()}`, label: m3uLabel.trim() || "Playlist", kind: "m3u", url: m3uUrl.trim() });
    setM3uUrl("");
    setM3uLabel("");
  };

  const addXtream = async () => {
    setMsg(null);
    try {
      const acc = await iptvApi.xtreamAccount({ server: xt.server, username: xt.username, password: xt.password });
      store.addIptv({
        id: `xt-${Date.now()}`,
        label: xt.label.trim() || xt.server,
        kind: "xtream",
        xtream: { server: xt.server, username: xt.username, password: xt.password },
        ...(acc.epgUrl ? { epgUrl: acc.epgUrl } : {}),
      });
      setMsg(`Added. Status: ${acc.status ?? "unknown"}${acc.expires ? `, expires ${new Date(acc.expires).toLocaleDateString()}` : ""}`);
      setXt({ label: "", server: "", username: "", password: "" });
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  return (
    <section className="settings-card">
      <h2>Live TV sources</h2>
      <p className="muted">Your own IPTV playlist or provider account. Credentials are sent to your server only and kept out of URLs and logs.</p>
      <div className="iptv-forms">
        <div className="iptv-form">
          <h3>M3U playlist</h3>
          <input placeholder="Label" value={m3uLabel} onChange={(e) => setM3uLabel(e.target.value)} />
          <input placeholder="https://…/playlist.m3u" value={m3uUrl} onChange={(e) => setM3uUrl(e.target.value)} />
          <button className="btn btn-primary" onClick={addM3U} type="button">
            Add playlist
          </button>
        </div>
        <div className="iptv-form">
          <h3>Xtream Codes</h3>
          <input placeholder="Label" value={xt.label} onChange={(e) => setXt({ ...xt, label: e.target.value })} />
          <input placeholder="http://host:port" value={xt.server} onChange={(e) => setXt({ ...xt, server: e.target.value })} />
          <input placeholder="Username" value={xt.username} onChange={(e) => setXt({ ...xt, username: e.target.value })} />
          <input placeholder="Password" type="password" value={xt.password} onChange={(e) => setXt({ ...xt, password: e.target.value })} />
          <button className="btn btn-primary" onClick={addXtream} type="button">
            Add account
          </button>
        </div>
      </div>
      {msg && <div className="field-msg">{msg}</div>}
      <ul className="addon-list">
        {store.iptv.map((s) => (
          <li key={s.id}>
            <div>
              <strong>{s.label}</strong> <span className="muted small">{s.kind}</span>
            </div>
            <button className="btn" onClick={() => store.removeIptv(s.id)} type="button">
              Remove
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
