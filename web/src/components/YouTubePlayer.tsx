import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { VideoHandle } from "./VideoPlayer";

interface Props {
  videoId: string;
  autoPlay?: boolean;
  onTimeUpdate?: (time: number, duration: number) => void;
  onPlay?: (time: number) => void;
  onPause?: (time: number) => void;
  onWaiting?: (waiting: boolean) => void;
  onReady?: () => void;
  onEnded?: () => void;
}

// Minimal typings for the slice of the YouTube IFrame API we use.
interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  setPlaybackRate(rate: number): void;
  destroy(): void;
}
declare global {
  interface Window {
    YT?: { Player: new (el: HTMLElement, opts: unknown) => YTPlayer; PlayerState: Record<string, number> };
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<void> | null = null;
function loadApi(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve();
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve) => {
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    window.onYouTubeIframeAPIReady = () => resolve();
    document.head.appendChild(tag);
  });
  return apiPromise;
}

/** YouTube player exposing the same imperative handle as VideoPlayer so the
 * watch-together controller can drive either one identically. */
export const YouTubePlayer = forwardRef<VideoHandle, Props>(function YouTubePlayer(props, ref) {
  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useImperativeHandle(ref, () => ({
    play: () => {
      playerRef.current?.playVideo();
      return Promise.resolve();
    },
    pause: () => playerRef.current?.pauseVideo(),
    seek: (t) => playerRef.current?.seekTo(t, true),
    setRate: (r) => playerRef.current?.setPlaybackRate(r),
    currentTime: () => playerRef.current?.getCurrentTime() ?? 0,
    duration: () => playerRef.current?.getDuration() ?? 0,
  }));

  useEffect(() => {
    let disposed = false;
    void loadApi().then(() => {
      if (disposed || !hostRef.current || !window.YT) return;
      const mount = document.createElement("div");
      hostRef.current.appendChild(mount);
      playerRef.current = new window.YT.Player(mount, {
        videoId: props.videoId,
        playerVars: { autoplay: props.autoPlay ? 1 : 0, modestbranding: 1, rel: 0, playsinline: 1 },
        events: {
          onReady: () => {
            props.onReady?.();
            pollRef.current = setInterval(() => {
              const p = playerRef.current;
              if (p) props.onTimeUpdate?.(p.getCurrentTime(), p.getDuration());
            }, 500);
          },
          onStateChange: (e: { data: number }) => {
            const S = window.YT!.PlayerState;
            const t = playerRef.current?.getCurrentTime() ?? 0;
            if (e.data === S.PLAYING) {
              props.onPlay?.(t);
              props.onWaiting?.(false);
            } else if (e.data === S.PAUSED) props.onPause?.(t);
            else if (e.data === S.BUFFERING) props.onWaiting?.(true);
            else if (e.data === S.ENDED) props.onEnded?.();
          },
        },
      });
    });
    return () => {
      disposed = true;
      if (pollRef.current) clearInterval(pollRef.current);
      playerRef.current?.destroy();
      playerRef.current = null;
    };
  }, [props.videoId]);

  return <div className="video-el yt-host" ref={hostRef} />;
});
