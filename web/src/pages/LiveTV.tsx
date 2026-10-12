import { useEffect, useMemo, useState } from "react";
import { useStore, type IptvSource } from "../store";
import { iptvApi, type IptvChannel } from "../api/server";
import { usePlayer, useDisplayName } from "../player";
import type { ActiveMedia } from "../components/WatchOverlay";

interface LoadedSource {
  channels: IptvChannel[];
  groups: Array<{ name: string; count?: number }>;
  epgUrls: string[];
}

export function LiveTV() {
  const store = useStore();
  const player = usePlayer();
  const [name] = useDisplayName();
  const [activeSourceId, setActiveSourceId] = useState<string | null>(store.iptv[0]?.id ?? null);
  const [loaded, setLoaded] = useState<LoadedSource | null>(null);
  const [group, setGroup] = useState<string>("");
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [epg, setEpg] = useState<Record<string, Array<{ start: number; stop: number; title: string }>>>({});

  const activeSource = store.iptv.find((s) => s.id === activeSourceId) ?? null;

  useEffect(() => {
    if (!activeSource) {
      setLoaded(null);
      return;
    }
    setError(null);
    setLoaded(null);
    void (async () => {
      try {
        if (activeSource.kind === "m3u" && activeSource.url) {
          const data = await iptvApi.loadM3U(activeSource.url);
          setLoaded(data);
        } else if (activeSource.kind === "xtream" && activeSource.xtream) {
          const data = await iptvApi.xtreamList("live", activeSource.xtream);
          setLoaded({ channels: data.channels ?? [], groups: data.groups, epgUrls: data.epgUrls ?? [] });
        }
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [activeSourceId]);

  // Load EPG now/next for the visible EPG url.
  useEffect(() => {
    const url = activeSource?.epgUrl ?? loaded?.epgUrls?.[0];
    if (!url || !loaded) return;
    const ids = loaded.channels.map((c) => c.tvgId).filter((x): x is string => Boolean(x)).slice(0, 400);
    if (ids.length === 0) return;
    void iptvApi
      .epg(url, ids, 4)
      .then((g) => setEpg(g.programmes))
      .catch(() => {});
  }, [loaded, activeSource]);

  const channels = useMemo(() => {
    let list = loaded?.channels ?? [];
    if (group) list = list.filter((c) => c.group.includes(group));
    if (filter.trim()) {
      const q = filter.toLowerCase();
      list = list.filter((c) => c.name.toLowerCase().includes(q));
    }
    return list.slice(0, 600);
  }, [loaded, group, filter]);

  const nowPlaying = (tvgId?: string) => {
    if (!tvgId) return null;
    const now = Date.now();
    return (epg[tvgId] ?? []).find((p) => p.start <= now && p.stop > now) ?? null;
  };

  const playChannel = (channel: IptvChannel, party?: boolean) => {
    const active: ActiveMedia = {
      key: `live:${channel.id}`,
      title: channel.name,
      source: "web",
      url: channel.url,
      type: "tv",
      poster: channel.logo,
      stream: { url: channel.url, behaviorHints: channel.headers ? { proxyHeaders: { request: channel.headers } } : {} },
    };
    if (party) player.startParty(active, name || "Host");
    else player.watch(active);
  };

  return (
    <div className="page page-pad">
      <h1 className="page-h1">Live TV</h1>
      {store.iptv.length === 0 ? (
        <div className="empty">
          <p>No IPTV sources yet.</p>
          <p className="muted">Add an M3U playlist or Xtream account in Settings → Live TV.</p>
        </div>
      ) : (
        <>
          <div className="livetv-controls">
            <select value={activeSourceId ?? ""} onChange={(e) => setActiveSourceId(e.target.value)}>
              {store.iptv.map((s: IptvSource) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
            {loaded && (
              <select value={group} onChange={(e) => setGroup(e.target.value)}>
                <option value="">All groups ({loaded.channels.length})</option>
                {loaded.groups.map((g) => (
                  <option key={g.name} value={g.name}>
                    {g.name} {g.count ? `(${g.count})` : ""}
                  </option>
                ))}
              </select>
            )}
            <input placeholder="Filter channels…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          </div>
          {error && <div className="watch-error-inline">{error}</div>}
          {!loaded && !error && <div className="muted">Loading channels…</div>}
          <div className="channel-grid">
            {channels.map((c) => {
              const prog = nowPlaying(c.tvgId);
              return (
                <div key={c.id} className="channel-card">
                  <button className="channel-logo" onClick={() => playChannel(c)} type="button" title={c.name}>
                    {c.logo ? <img loading="lazy" src={c.logo} alt="" /> : <span>{c.name.slice(0, 3)}</span>}
                  </button>
                  <div className="channel-meta">
                    <div className="channel-name">{c.name}</div>
                    {prog && <div className="channel-prog">{prog.title}</div>}
                  </div>
                  <button className="channel-party" onClick={() => playChannel(c, true)} title="Watch together" type="button">
                    👥
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
