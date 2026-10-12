import { useEffect, useMemo, useState } from "react";
import type { MetaDetail, MetaPreview, Stream, Video } from "../api/types";
import { aggregateStreams, fetchMeta, fetchSubtitles } from "../api/addons";
import { useStore } from "../store";
import { usePlayer, useDisplayName } from "../player";
import type { ActiveMedia } from "./WatchOverlay";

interface Props {
  meta: MetaPreview;
  onClose: () => void;
}

function streamQuality(s: Stream): string {
  const text = `${s.title ?? ""} ${s.name ?? ""} ${s.description ?? ""}`;
  const res = /(2160p|4k|1080p|720p|480p)/i.exec(text);
  return res ? res[1]!.toUpperCase() : "";
}

export function DetailModal({ meta, onClose }: Props) {
  const store = useStore();
  const player = usePlayer();
  const [name] = useDisplayName();
  const [detail, setDetail] = useState<MetaDetail | null>(null);
  const [selectedVideo, setSelectedVideo] = useState<Video | null>(null);
  const [streams, setStreams] = useState<Array<Stream & { addonName: string }> | null>(null);
  const [loadingStreams, setLoadingStreams] = useState(false);
  const isSeries = meta.type === "series";

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      for (const addon of store.addons) {
        const d = await fetchMeta(addon, meta.type, meta.id, controller.signal).catch(() => null);
        if (d) {
          setDetail(d);
          return;
        }
      }
      setDetail({ ...meta });
    })();
    return () => controller.abort();
  }, [meta.id, meta.type, store.addons]);

  const episodesBySeason = useMemo(() => {
    const groups = new Map<number, Video[]>();
    for (const v of detail?.videos ?? []) {
      const season = v.season ?? 1;
      (groups.get(season) ?? groups.set(season, []).get(season)!).push(v);
    }
    for (const list of groups.values()) list.sort((a, b) => (a.episode ?? a.number ?? 0) - (b.episode ?? b.number ?? 0));
    return groups;
  }, [detail]);

  const [season, setSeason] = useState<number | null>(null);
  useEffect(() => {
    if (isSeries && episodesBySeason.size && season === null) {
      const seasons = [...episodesBySeason.keys()].filter((s) => s > 0).sort((a, b) => a - b);
      setSeason(seasons[0] ?? [...episodesBySeason.keys()][0] ?? 1);
    }
  }, [episodesBySeason, isSeries, season]);

  const loadStreams = async (video: Video | null) => {
    setSelectedVideo(video);
    setStreams(null);
    setLoadingStreams(true);
    const id = video ? video.id : meta.id;
    const type = meta.type;
    const found = await aggregateStreams(store.addons, type, id).catch(() => []);
    // Rank: has a usable source, then quality, then add-on name.
    const order = ["2160P", "4K", "1080P", "720P", "480P", ""];
    found.sort((a, b) => order.indexOf(streamQuality(a)) - order.indexOf(streamQuality(b)));
    setStreams(found);
    setLoadingStreams(false);
  };

  const buildActive = async (stream: Stream, video: Video | null): Promise<ActiveMedia> => {
    const subtitles = await Promise.all(store.addons.map((a) => fetchSubtitles(a, meta.type, (video ?? { id: meta.id }).id).catch(() => [])));
    return {
      key: `${meta.id}:${video?.id ?? ""}:${stream.infoHash ?? stream.url ?? stream.ytId}`,
      title: detail?.name ?? meta.name,
      source: stream.ytId ? "youtube" : stream.url && !stream.infoHash ? "web" : "addon",
      stream,
      ...(stream.ytId ? { youtubeId: stream.ytId } : {}),
      ...(stream.url && !stream.infoHash ? { url: stream.url } : {}),
      metaId: meta.id,
      ...(video ? { videoId: video.id } : {}),
      type: meta.type,
      poster: meta.poster ?? detail?.poster,
      background: meta.background ?? detail?.background,
      ...(video?.season !== undefined ? { season: video.season } : {}),
      ...(video?.episode !== undefined ? { episode: video.episode } : {}),
      subtitles: subtitles.flat(),
    };
  };

  const play = async (stream: Stream, video: Video | null, party?: boolean) => {
    const active = await buildActive(stream, video);
    if (party) player.startParty(active, name || "Host");
    else player.watch(active);
    onClose();
  };

  const background = detail?.background ?? meta.background;
  const seasons = [...episodesBySeason.keys()].sort((a, b) => a - b);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close icon-btn" onClick={onClose} aria-label="Close" type="button">
          ✕
        </button>
        <div className="modal-hero" style={background ? { backgroundImage: `url(${background})` } : undefined}>
          <div className="modal-hero-shade" />
          <div className="modal-hero-body">
            {detail?.logo ? <img className="modal-logo" src={detail.logo} alt={detail.name} /> : <h2>{detail?.name ?? meta.name}</h2>}
            <div className="modal-meta">
              {detail?.releaseInfo && <span>{detail.releaseInfo}</span>}
              {detail?.runtime && <span>{detail.runtime}</span>}
              {detail?.imdbRating && <span>★ {detail.imdbRating}</span>}
            </div>
          </div>
        </div>

        <div className="modal-body">
          <div className="modal-actions">
            {!isSeries && (
              <>
                <button className="btn btn-primary" onClick={() => loadStreams(null)} type="button">
                  ▶ Find streams
                </button>
              </>
            )}
            <button className={`btn ${store.inLibrary(meta.id) ? "btn-on" : ""}`} onClick={() => store.toggleLibrary(meta)} type="button">
              {store.inLibrary(meta.id) ? "✓ In library" : "+ Library"}
            </button>
          </div>

          {detail?.genres && <div className="modal-genres">{detail.genres.map((g) => <span key={g} className="chip">{g}</span>)}</div>}
          {detail?.description && <p className="modal-desc">{detail.description}</p>}
          {detail?.cast && detail.cast.length > 0 && <p className="muted"><strong>Cast:</strong> {detail.cast.slice(0, 6).join(", ")}</p>}

          {isSeries && (
            <div className="episodes">
              <div className="season-tabs">
                {seasons.map((s) => (
                  <button key={s} className={s === season ? "on" : ""} onClick={() => setSeason(s)} type="button">
                    {s === 0 ? "Specials" : `Season ${s}`}
                  </button>
                ))}
              </div>
              <div className="episode-list">
                {(episodesBySeason.get(season ?? 1) ?? []).map((v) => (
                  <button key={v.id} className="episode" onClick={() => loadStreams(v)} type="button">
                    {v.thumbnail && <img loading="lazy" src={v.thumbnail} alt="" />}
                    <div className="episode-info">
                      <div className="episode-title">
                        {v.episode ?? v.number}. {v.name ?? v.title}
                      </div>
                      {v.overview && <div className="episode-overview">{v.overview}</div>}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {(loadingStreams || streams) && (
            <div className="streams">
              <h3>
                Streams{selectedVideo ? ` · S${selectedVideo.season}E${selectedVideo.episode}` : ""}
              </h3>
              {loadingStreams && <div className="muted">Searching add-ons…</div>}
              {streams && streams.length === 0 && <div className="muted">No streams found. Install more add-ons in Settings.</div>}
              <div className="stream-list">
                {streams?.map((s, i) => {
                  const q = streamQuality(s);
                  return (
                    <div key={i} className="stream-row">
                      <div className="stream-info">
                        <span className="stream-addon">{s.addonName}</span>
                        <span className="stream-name">{s.title ?? s.name}</span>
                        {q && <span className="stream-q">{q}</span>}
                        {s.infoHash && <span className="stream-tag">P2P</span>}
                        {s.externalUrl && <span className="stream-tag">external</span>}
                      </div>
                      <div className="stream-buttons">
                        {s.externalUrl ? (
                          <a className="btn" href={s.externalUrl} target="_blank" rel="noreferrer">
                            Open ↗
                          </a>
                        ) : (
                          <>
                            <button className="btn btn-primary" onClick={() => play(s, selectedVideo)} type="button">
                              ▶ Play
                            </button>
                            <button className="btn" onClick={() => play(s, selectedVideo, true)} type="button" title="Watch together">
                              👥 Party
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
