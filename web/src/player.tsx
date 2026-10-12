import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { WatchOverlay, type ActiveMedia } from "./components/WatchOverlay";
import { useStore } from "./store";
import { serverApi } from "./api/server";
import { useEffect } from "react";

interface WatchOptions {
  party?: { create: true } | { room: string };
  partyName?: string;
}

interface PlayerValue {
  watch: (media: ActiveMedia, opts?: WatchOptions) => void;
  startParty: (media: ActiveMedia | null, name: string) => void;
  joinParty: (code: string, name: string) => void;
  close: () => void;
  active: boolean;
}

const PlayerContext = createContext<PlayerValue | null>(null);

// A tiny placeholder used when joining a room before the host has picked media.
const LOBBY: ActiveMedia = { key: "lobby", title: "Waiting for host…", source: "web", url: "" };

export function PlayerProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<{ media: ActiveMedia; opts: WatchOptions } | null>(null);
  const [debrid, setDebrid] = useState({ available: false, preferred: true });

  useEffect(() => {
    void (async () => {
      try {
        const [avail, settings] = await Promise.all([serverApi.debridAvailable(), serverApi.settings()]);
        setDebrid({ available: avail.configured, preferred: (settings.values.debridPreferred as boolean) ?? true });
      } catch {
        /* server not reachable yet */
      }
    })();
  }, []);

  const watch = useCallback((media: ActiveMedia, opts: WatchOptions = {}) => setCurrent({ media, opts }), []);
  const startParty = useCallback(
    (media: ActiveMedia | null, name: string) => setCurrent({ media: media ?? LOBBY, opts: { party: { create: true }, partyName: name } }),
    [],
  );
  const joinParty = useCallback(
    (code: string, name: string) => setCurrent({ media: LOBBY, opts: { party: { room: code.toUpperCase() }, partyName: name } }),
    [],
  );
  const close = useCallback(() => setCurrent(null), []);

  const value = useMemo<PlayerValue>(() => ({ watch, startParty, joinParty, close, active: current !== null }), [watch, startParty, joinParty, close, current]);

  return (
    <PlayerContext.Provider value={value}>
      {children}
      {current && (
        <WatchOverlay
          key={current.opts.party ? ("create" in current.opts.party ? "create" : current.opts.party.room) : current.media.key}
          initial={current.media}
          {...(current.opts.party ? { join: current.opts.party } : {})}
          partyName={current.opts.partyName ?? "Guest"}
          debridAvailable={debrid.available}
          debridPreferred={debrid.preferred}
          onClose={close}
        />
      )}
    </PlayerContext.Provider>
  );
}

export function usePlayer(): PlayerValue {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error("usePlayer must be used within PlayerProvider");
  return ctx;
}

/** Display name remembered for watch-together sessions. */
export function useDisplayName(): [string, (n: string) => void] {
  const { profileName, setProfileName } = useStore() as unknown as { profileName?: string; setProfileName?: (n: string) => void };
  const [name, setName] = useState(() => {
    try {
      return localStorage.getItem("marquee.name") ?? profileName ?? "";
    } catch {
      return "";
    }
  });
  const update = useCallback(
    (n: string) => {
      setName(n);
      try {
        localStorage.setItem("marquee.name", n);
      } catch {
        /* ignore */
      }
      setProfileName?.(n);
    },
    [setProfileName],
  );
  return [name, update];
}
