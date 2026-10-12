import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { VideoPlayer, type PlayerSubtitle, type VideoHandle } from "./VideoPlayer";
import { YouTubePlayer } from "./YouTubePlayer";
import { PartyPanel } from "./PartyPanel";
import { ensureBrowserPlayable, resolveStream, type PlayableSource } from "../api/resolve";
import { serverApi } from "../api/server";
import type { Stream, Subtitle } from "../api/types";
import type { PartyMedia } from "../party/shared";
import { useParty } from "../party/useParty";
import { useStore } from "../store";

export interface ActiveMedia {
  key: string;
  title: string;
  source: "addon" | "youtube" | "web";
  stream?: Stream;
  youtubeId?: string;
  url?: string;
  metaId?: string;
  videoId?: string;
  type?: string;
  poster?: string;
  background?: string;
  season?: number;
  episode?: number;
  subtitles?: Subtitle[];
}

export function toPartyMedia(m: ActiveMedia): PartyMedia {
  return {
    key: m.key,
    title: m.title,
    source: m.source,
    ...(m.type ? { type: m.type } : {}),
    ...(m.metaId ? { metaId: m.metaId } : {}),
    ...(m.videoId ? { videoId: m.videoId } : {}),
    ...(m.poster ? { poster: m.poster } : {}),
    ...(m.background ? { background: m.background } : {}),
    ...(m.season !== undefined ? { season: m.season } : {}),
    ...(m.episode !== undefined ? { episode: m.episode } : {}),
    ...(m.stream ? { stream: m.stream } : {}),
    ...(m.youtubeId ? { youtubeId: m.youtubeId } : {}),
    ...(m.url ? { url: m.url } : {}),
  };
}

export function fromPartyMedia(m: PartyMedia): ActiveMedia {
  return { ...m };
}

interface Props {
  initial: ActiveMedia;
  /** When set, this overlay is a watch-together session. */
  join?: { create: true } | { room: string };
  partyName: string;
  debridAvailable: boolean;
  debridPreferred: boolean;
  onClose: () => void;
}

export function WatchOverlay({ initial, join, partyName, debridAvailable, debridPreferred, onClose }: Props) {
  const store = useStore();
  const [media, setMedia] = useState<ActiveMedia>(initial);
  const [source, setSource] = useState<PlayableSource | null>(null);
  const [status, setStatus] = useState<{ phase: "resolving" | "ready" | "error"; message: string; progress: number }>({
    phase: "resolving",
    message: "Preparing stream…",
    progress: 0,
  });
  const [subtitles, setSubtitles] = useState<PlayerSubtitle[]>([]);
  const [activeSub, setActiveSub] = useState<string | null>(null);
  const [showParty, setShowParty] = useState(Boolean(join));
  const handleRef = useRef<VideoHandle | null>(null);

  const party = join ? useParty(join, partyName) : null;

  // In a party, the host's selection is the source of truth.
  useEffect(() => {
    if (!party) return;
    party.onMediaChange((m) => {
      if (m) setMedia(fromPartyMedia(m));
    });
  }, [party]);

  // Host loads the initial media into the room once connected.
  const loadedInitial = useRef(false);
  useEffect(() => {
    if (!party || loadedInitial.current) return;
    if (party.state.status === "connected" && party.isHost() && !party.state.media) {
      party.load(toPartyMedia(initial));
      loadedInitial.current = true;
    }
  }, [party?.state.status, party?.state.media]);

  // Resolve the current media into a playable source.
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setSource(null);
    setStatus({ phase: "resolving", message: "Preparing stream…", progress: 0 });
    void (async () => {
      try {
        if (media.source === "youtube" && media.youtubeId) {
          if (!cancelled) {
            setSource({ url: media.youtubeId, kind: "youtube", direct: false });
            setStatus({ phase: "ready", message: "", progress: 100 });
          }
          return;
        }
        const stream: Stream = media.source === "web" ? { url: media.url } : media.stream!;
        const hint = { ...(media.season !== undefined ? { season: media.season } : {}), ...(media.episode !== undefined ? { episode: media.episode } : {}) };
        let resolved = await resolveStream(stream, {
          hint,
          debridAvailable,
          debridPreferred,
          signal: controller.signal,
          onProgress: (message, progress) => !cancelled && setStatus({ phase: "resolving", message, progress }),
        });
        if (cancelled) return;
        setStatus({ phase: "resolving", message: "Checking compatibility…", progress: 100 });
        resolved = await ensureBrowserPlayable(resolved);
        if (cancelled) return;
        setSource(resolved);
        setStatus({ phase: "ready", message: "", progress: 100 });
        // Build subtitle tracks (add-on + stream-embedded external files).
        const subs = [...(media.subtitles ?? []), ...(stream.subtitles ?? [])];
        setSubtitles(
          subs.map((s: Subtitle) => ({ id: s.id, lang: s.lang, label: s.lang.toUpperCase(), vttUrl: serverApi.subtitleVttUrl(s.url) })),
        );
      } catch (err) {
        if (!cancelled) setStatus({ phase: "error", message: (err as Error).message, progress: 0 });
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [media.key, media.source, debridAvailable, debridPreferred]);

  // Persist progress for continue-watching (non-party and party alike).
  const onTimeUpdate = useCallback(
    (time: number, duration: number) => {
      if (media.metaId && duration > 0 && time > 5) {
        store.saveProgress({
          id: media.metaId,
          ...(media.videoId ? { videoId: media.videoId } : {}),
          type: media.type ?? "movie",
          name: media.title,
          ...(media.poster ? { poster: media.poster } : {}),
          time,
          duration,
          ...(media.season !== undefined ? { season: media.season } : {}),
          ...(media.episode !== undefined ? { episode: media.episode } : {}),
        });
      }
    },
    [media, store],
  );

  const bindHandle = (h: VideoHandle | null) => {
    handleRef.current = h;
    party?.bindPlayer(h);
  };

  // Resume from saved progress on first ready (non-party only).
  const resumedRef = useRef(false);
  const onReady = () => {
    party?.onLocalReady();
    if (!party && !resumedRef.current && media.metaId) {
      const p = store.getProgress(media.metaId, media.videoId);
      if (p && p.time > 10 && handleRef.current) handleRef.current.seek(p.time);
      resumedRef.current = true;
    }
  };

  const playerProps = {
    autoPlay: true,
    onReady,
    onTimeUpdate,
    onPlay: (t: number) => party?.onLocalPlay(t),
    onPause: (t: number) => party?.onLocalPause(t),
    onSeeked: (t: number) => party?.onLocalSeek(t),
    onWaiting: (w: boolean) => party?.onLocalBuffering(w),
  };

  const title = useMemo(() => {
    if (media.season !== undefined && media.episode !== undefined) return `${media.title} · S${media.season}E${media.episode}`;
    return media.title;
  }, [media]);

  return (
    <div className="watch-overlay">
      <div className="watch-main">
        <header className="watch-bar">
          <button className="icon-btn" onClick={onClose} aria-label="Back" type="button">
            ‹ Back
          </button>
          <div className="watch-title">{title}</div>
          <div className="watch-bar-right">
            {subtitles.length > 0 && source?.kind !== "youtube" && (
              <select value={activeSub ?? ""} onChange={(e) => setActiveSub(e.target.value || null)} className="sub-select">
                <option value="">Subtitles off</option>
                {subtitles.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            )}
            {join && (
              <button className="icon-btn" onClick={() => setShowParty((v) => !v)} type="button">
                {showParty ? "Hide party" : "Show party"}
              </button>
            )}
          </div>
        </header>

        <div className="watch-stage">
          {status.phase === "resolving" && (
            <div className="watch-loading">
              <div className="spinner" />
              <div className="watch-loading-msg">{status.message}</div>
              {status.progress > 0 && status.progress < 100 && (
                <div className="watch-progress">
                  <span style={{ width: `${status.progress}%` }} />
                </div>
              )}
            </div>
          )}
          {status.phase === "error" && (
            <div className="watch-error">
              <p>Could not play this stream.</p>
              <p className="muted">{status.message}</p>
              <button className="btn" onClick={onClose} type="button">
                Back
              </button>
            </div>
          )}
          {source && status.phase === "ready" && source.kind === "youtube" && (
            <YouTubePlayer
              ref={bindHandle}
              videoId={source.url}
              autoPlay
              onReady={onReady}
              onTimeUpdate={onTimeUpdate}
              onPlay={(t) => party?.onLocalPlay(t)}
              onPause={(t) => party?.onLocalPause(t)}
              onWaiting={(w) => party?.onLocalBuffering(w)}
            />
          )}
          {source && status.phase === "ready" && source.kind !== "youtube" && (
            <VideoPlayer
              ref={bindHandle}
              source={source}
              subtitles={subtitles}
              activeSubtitle={activeSub}
              onFallback={(next) => setSource(next)}
              {...playerProps}
            />
          )}

          {party && (
            <div className="reaction-layer">
              {party.reactions.map((r) => (
                <span key={r.id} className="floating-reaction" style={{ left: `${r.left}%` }}>
                  {r.emoji}
                  <em>{r.name}</em>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {party && showParty && <PartyPanel party={party} onClose={() => setShowParty(false)} />}
    </div>
  );
}
