import { useCallback, useEffect, useRef, useState } from "react";
import { PartyClient, type PartyState } from "./client";
import type { PartyMedia } from "./shared";
import type { VideoHandle } from "../components/VideoPlayer";

export interface FloatingReaction {
  id: number;
  emoji: string;
  name: string;
  left: number;
}

const INITIAL: PartyState = {
  status: "connecting",
  code: null,
  selfId: null,
  hostId: null,
  members: [],
  media: null,
  playback: { paused: true, position: 0, rate: 1, updatedAt: Date.now() },
  settings: { everyoneControls: true, waitForAll: true },
  chat: [],
  holding: [],
  error: null,
};

/**
 * Connects to a room and binds a media player to it. The returned `bindPlayer`
 * must be called with the active VideoHandle; `onLocal*` are fed by the player
 * to broadcast the local user's actions. Remote commands are applied to the
 * player while suppressing the echo.
 */
export function useParty(join: { create: true } | { room: string } | null, name: string) {
  const [state, setState] = useState<PartyState>(INITIAL);
  const [reactions, setReactions] = useState<FloatingReaction[]>([]);
  const clientRef = useRef<PartyClient | null>(null);
  const playerRef = useRef<VideoHandle | null>(null);
  const mediaRef = useRef<PartyMedia | null>(null);
  const applyingRemote = useRef(false);
  const pendingMedia = useRef<((m: PartyMedia | null) => void) | null>(null);

  useEffect(() => {
    if (!join) return;
    const client = new PartyClient(name, join, {
      onState: setState,
      onMedia: (media) => {
        mediaRef.current = media;
        pendingMedia.current?.(media);
      },
      onPlaybackCommand: (playback, action) => {
        const player = playerRef.current;
        if (!player) return;
        applyingRemote.current = true;
        const target = playback.paused
          ? playback.position
          : playback.position + ((client.now() - playback.updatedAt) / 1000) * playback.rate;
        // Only hard-seek on an explicit seek or when drift is large.
        if (action === "seek" || Math.abs(player.currentTime() - target) > 1.5) player.seek(target);
        if (playback.rate !== undefined) player.setRate(playback.rate);
        if (playback.paused) player.pause();
        else void player.play();
        setTimeout(() => (applyingRemote.current = false), 400);
      },
      onReaction: (_id, rName, emoji) => {
        const r: FloatingReaction = { id: Date.now() + Math.random(), emoji, name: rName, left: 10 + Math.random() * 80 };
        setReactions((prev) => [...prev, r]);
        setTimeout(() => setReactions((prev) => prev.filter((x) => x.id !== r.id)), 4000);
      },
    });
    clientRef.current = client;
    client.connect();
    return () => {
      client.close();
      clientRef.current = null;
    };
  }, [join ? ("create" in join ? "create" : join.room) : null, name]);

  const bindPlayer = useCallback((handle: VideoHandle | null) => {
    playerRef.current = handle;
  }, []);

  const api = {
    state,
    reactions,
    bindPlayer,
    client: clientRef,
    isHost: () => clientRef.current?.isHost ?? false,
    canControl: () => clientRef.current?.canControl ?? false,
    /** Register a callback invoked when the host changes the media. */
    onMediaChange: (cb: (m: PartyMedia | null) => void) => {
      pendingMedia.current = cb;
      if (mediaRef.current) cb(mediaRef.current);
    },
    load: (media: PartyMedia) => clientRef.current?.loadMedia(media),
    // Local player events -> broadcast (unless we're applying a remote command).
    onLocalPlay: (t: number) => !applyingRemote.current && clientRef.current?.play(t),
    onLocalPause: (t: number) => !applyingRemote.current && clientRef.current?.pause(t),
    onLocalSeek: (t: number) => !applyingRemote.current && clientRef.current?.seek(t),
    onLocalBuffering: (b: boolean) => clientRef.current?.setBuffering(b),
    onLocalReady: () => clientRef.current?.setReady(true),
    chat: (text: string) => clientRef.current?.chat(text),
    react: (emoji: string) => clientRef.current?.react(emoji),
    updateSettings: clientRef.current?.updateSettings.bind(clientRef.current),
    kick: (id: string) => clientRef.current?.kick(id),
    transferHost: (id: string) => clientRef.current?.transferHost(id),
  };
  return api;
}
