import { useEffect, useState } from "react";
import { useStore } from "../store";
import { serverApi, iptvApi } from "../api/server";
import { useDisplayName } from "../player";

export function Settings() {
  const [name, setName] = useDisplayName();
  return (
    <div className="page page-pad settings">
      <h1 className="page-h1">Settings</h1>
      <ProfileSection name={name} setName={setName} />
      <DebridSection />
      <AddonsSection />
      <IptvSection />
    </div>
  );
}

function ProfileSection({ name, setName }: { name: string; setName: (n: string) => void }) {
  const store = useStore();
  const [token, setToken] = useState(store.adminToken);
  return (
    <section className="settings-card">
      <h2>Profile</h2>
      <label className="field">
        <span>Display name (shown in watch-together)</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
      </label>
      <label className="field">
        <span>Server admin token (only needed for a shared VPS)</span>
        <input
          value={token}
          onChange={(e) => setToken(e.target.value)}
          onBlur={() => store.setAdminToken(token)}
          placeholder="MARQUEE_ADMIN_TOKEN"
          type="password"
        />
      </label>
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
