import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import Hls from "hls.js";
import type { PlayableSource } from "../api/resolve";
import { serverApi } from "../api/server";

export interface PlayerSubtitle {
  id: string;
  lang: string;
  label: string;
  /** A URL the browser can load directly as WebVTT. */
  vttUrl: string;
}

export interface VideoHandle {
  play: () => Promise<void>;
  pause: () => void;
  seek: (t: number) => void;
  setRate: (r: number) => void;
  currentTime: () => number;
  duration: () => number;
}

interface Props {
  source: PlayableSource;
  subtitles?: PlayerSubtitle[];
  activeSubtitle?: string | null;
  autoPlay?: boolean;
  /** Called with a fresh (transcoded) source when the current one can't decode. */
  onFallback?: (next: PlayableSource) => void;
  onTimeUpdate?: (time: number, duration: number) => void;
  onPlay?: (time: number) => void;
  onPause?: (time: number) => void;
  onSeeked?: (time: number) => void;
  onWaiting?: (waiting: boolean) => void;
  onEnded?: () => void;
  onReady?: () => void;
}

/**
 * A single <video> element that handles HLS (via hls.js), native playback and
 * a one-shot transcode fallback when the browser rejects the codecs/container.
 * It exposes an imperative handle so watch-together can drive it.
 */
export const VideoPlayer = forwardRef<VideoHandle, Props>(function VideoPlayer(props, ref) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [triedTranscode, setTriedTranscode] = useState(false);

  useImperativeHandle(ref, () => ({
    play: () => videoRef.current?.play() ?? Promise.resolve(),
    pause: () => videoRef.current?.pause(),
    seek: (t) => {
      if (videoRef.current) videoRef.current.currentTime = t;
    },
    setRate: (r) => {
      if (videoRef.current) videoRef.current.playbackRate = r;
    },
    currentTime: () => videoRef.current?.currentTime ?? 0,
    duration: () => videoRef.current?.duration ?? 0,
  }));

  // Attach the media source, choosing hls.js when needed.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    hlsRef.current?.destroy();
    hlsRef.current = null;
    const { source } = props;

    if (source.kind === "hls" && Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true, lowLatencyMode: false });
      hlsRef.current = hls;
      hls.loadSource(source.url);
      hls.attachMedia(video);
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (data.fatal && data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
      });
    } else {
      video.src = source.url;
      video.load();
    }
    return () => {
      hlsRef.current?.destroy();
      hlsRef.current = null;
    };
  }, [props.source]);

  // Transcode fallback: if a direct file errors with a decode/format problem.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onError = () => {
      const err = video.error;
      const decodeIssue = err && (err.code === MediaError.MEDIA_ERR_DECODE || err.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED);
      if (decodeIssue && props.source.direct && props.source.kind === "file" && !triedTranscode) {
        setTriedTranscode(true);
        const at = video.currentTime || 0;
        const next: PlayableSource = { ...props.source, url: serverApi.transcodeUrl(props.source.url, { t: at }), direct: false };
        props.onFallback?.(next);
      }
    };
    video.addEventListener("error", onError);
    return () => video.removeEventListener("error", onError);
  }, [props.source, triedTranscode, props.onFallback]);

  useEffect(() => setTriedTranscode(false), [props.source.filename]);

  const p = props;
  return (
    <video
      ref={videoRef}
      className="video-el"
      playsInline
      autoPlay={p.autoPlay}
      controls
      crossOrigin="anonymous"
      onLoadedMetadata={() => p.onReady?.()}
      onTimeUpdate={(e) => p.onTimeUpdate?.(e.currentTarget.currentTime, e.currentTarget.duration)}
      onPlay={(e) => p.onPlay?.(e.currentTarget.currentTime)}
      onPause={(e) => p.onPause?.(e.currentTarget.currentTime)}
      onSeeked={(e) => p.onSeeked?.(e.currentTarget.currentTime)}
      onWaiting={() => p.onWaiting?.(true)}
      onPlaying={() => p.onWaiting?.(false)}
      onCanPlay={() => p.onWaiting?.(false)}
      onEnded={() => p.onEnded?.()}
    >
      {(p.subtitles ?? []).map((s) => (
        <track key={s.id} kind="subtitles" srcLang={s.lang} label={s.label} src={s.vttUrl} default={p.activeSubtitle === s.id} />
      ))}
    </video>
  );
});
