import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { AddonDescriptor, MetaPreview } from "./api/types";
import { fetchManifest } from "./api/addons";
import { DEFAULT_ADDON_URLS } from "./api/catalogs";

export interface LibraryItem extends MetaPreview {
  addedAt: number;
}
export interface Progress {
  id: string;
  videoId?: string;
  type: string;
  name: string;
  poster?: string;
  time: number;
  duration: number;
  updatedAt: number;
  season?: number;
  episode?: number;
}
export interface IptvSource {
  id: string;
  label: string;
  kind: "m3u" | "xtream";
  url?: string;
  epgUrl?: string;
  xtream?: { server: string; username: string; password: string };
}

interface PersistShape {
  addonUrls: string[];
  library: LibraryItem[];
  progress: Progress[];
  iptv: IptvSource[];
  adminToken: string;
}

const KEY = "marquee.state.v1";

function load(): PersistShape {
  const base: PersistShape = { addonUrls: DEFAULT_ADDON_URLS, library: [], progress: [], iptv: [], adminToken: "" };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<PersistShape>;
    return {
      addonUrls: parsed.addonUrls?.length ? parsed.addonUrls : base.addonUrls,
      library: parsed.library ?? [],
      progress: parsed.progress ?? [],
      iptv: parsed.iptv ?? [],
      adminToken: parsed.adminToken ?? "",
    };
  } catch {
    return base;
  }
}

interface StoreValue {
  addons: AddonDescriptor[];
  addonUrls: string[];
  addonsLoading: boolean;
  installAddon: (url: string) => Promise<void>;
  removeAddon: (url: string) => void;
  library: LibraryItem[];
  inLibrary: (id: string) => boolean;
  toggleLibrary: (meta: MetaPreview) => void;
  progress: Progress[];
  getProgress: (id: string, videoId?: string) => Progress | undefined;
  saveProgress: (p: Omit<Progress, "updatedAt">) => void;
  iptv: IptvSource[];
  addIptv: (s: IptvSource) => void;
  removeIptv: (id: string) => void;
  adminToken: string;
  setAdminToken: (t: string) => void;
}

const StoreContext = createContext<StoreValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [persist, setPersist] = useState<PersistShape>(load);
  const [addons, setAddons] = useState<AddonDescriptor[]>([]);
  const [addonsLoading, setAddonsLoading] = useState(true);
  const persistRef = useRef(persist);
  persistRef.current = persist;

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(persist));
      localStorage.setItem("marquee.adminToken", persist.adminToken);
    } catch {
      /* storage may be unavailable (private mode) */
    }
  }, [persist]);

  // Resolve installed add-on manifests whenever the URL list changes.
  useEffect(() => {
    let cancelled = false;
    setAddonsLoading(true);
    void (async () => {
      const resolved = await Promise.allSettled(persist.addonUrls.map((u) => fetchManifest(u)));
      if (cancelled) return;
      setAddons(resolved.filter((r): r is PromiseFulfilledResult<AddonDescriptor> => r.status === "fulfilled").map((r) => r.value));
      setAddonsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [persist.addonUrls]);

  const installAddon = useCallback(async (url: string) => {
    const descriptor = await fetchManifest(url);
    setPersist((p) => (p.addonUrls.includes(descriptor.transportUrl) ? p : { ...p, addonUrls: [...p.addonUrls, descriptor.transportUrl] }));
  }, []);
  const removeAddon = useCallback((url: string) => {
    setPersist((p) => ({ ...p, addonUrls: p.addonUrls.filter((u) => u !== url) }));
  }, []);

  const toggleLibrary = useCallback((meta: MetaPreview) => {
    setPersist((p) => {
      const exists = p.library.some((m) => m.id === meta.id);
      return {
        ...p,
        library: exists ? p.library.filter((m) => m.id !== meta.id) : [{ ...meta, addedAt: Date.now() }, ...p.library],
      };
    });
  }, []);

  const saveProgress = useCallback((entry: Omit<Progress, "updatedAt">) => {
    setPersist((p) => {
      const key = (x: Progress | Omit<Progress, "updatedAt">) => `${x.id}:${x.videoId ?? ""}`;
      const rest = p.progress.filter((x) => key(x) !== key(entry));
      const finished = entry.duration > 0 && entry.time / entry.duration > 0.92;
      const next = finished ? rest : [{ ...entry, updatedAt: Date.now() }, ...rest];
      return { ...p, progress: next.slice(0, 100) };
    });
  }, []);

  const value = useMemo<StoreValue>(
    () => ({
      addons,
      addonUrls: persist.addonUrls,
      addonsLoading,
      installAddon,
      removeAddon,
      library: persist.library,
      inLibrary: (id) => persist.library.some((m) => m.id === id),
      toggleLibrary,
      progress: persist.progress,
      getProgress: (id, videoId) => persist.progress.find((p) => p.id === id && p.videoId === videoId),
      saveProgress,
      iptv: persist.iptv,
      addIptv: (s) => setPersist((p) => ({ ...p, iptv: [...p.iptv.filter((x) => x.id !== s.id), s] })),
      removeIptv: (id) => setPersist((p) => ({ ...p, iptv: p.iptv.filter((x) => x.id !== id) })),
      adminToken: persist.adminToken,
      setAdminToken: (t) => setPersist((p) => ({ ...p, adminToken: t })),
    }),
    [addons, addonsLoading, persist, installAddon, removeAddon, toggleLibrary, saveProgress],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within StoreProvider");
  return ctx;
}
