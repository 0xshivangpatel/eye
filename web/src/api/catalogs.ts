// Default add-ons shipped with a fresh install and the per-OTT catalog rows
// shown on the home screen. All of these are the user-installable Stremio
// add-ons already verified against their live manifests.

export const DEFAULT_ADDON_URLS = [
  // Local built-in Open Movies (served by the Marquee server).
  "/addon/open-movies/manifest.json",
  // Cinemeta: canonical movie/series metadata + popular catalogs.
  "https://v3-cinemeta.strem.io/manifest.json",
  // Streaming Catalogs: trending per streaming service (Netflix, HBO, Disney+...).
  "https://7a82163c306e-stremio-netflix-catalog-addon.baby-beamup.club/manifest.json",
  // WatchHub: "where to stream" links (legal provider deep-links).
  "https://watchhub.strem.io/manifest.json",
  // OpenSubtitles v3.
  "https://opensubtitles-v3.strem.io/manifest.json",
];

/** Catalog rows that, when present, get a branded OTT label on the home screen. */
export interface OttRow {
  label: string;
  /** Matches CatalogDefinition.id and the catalog's declared type. */
  catalogId: string;
  type: "movie" | "series";
  accent: string;
}

export const OTT_ROWS: OttRow[] = [
  { label: "Netflix", catalogId: "nfx", type: "series", accent: "#e50914" },
  { label: "Netflix Movies", catalogId: "nfx", type: "movie", accent: "#e50914" },
  { label: "HBO Max", catalogId: "hbm", type: "series", accent: "#9b4dff" },
  { label: "Disney+", catalogId: "dnp", type: "series", accent: "#113ccf" },
  { label: "Prime Video", catalogId: "amp", type: "series", accent: "#00a8e1" },
  { label: "Apple TV+", catalogId: "atp", type: "series", accent: "#9ca3af" },
];

export const METAHUB = {
  poster: (id: string, size: "small" | "medium" = "medium") => `https://images.metahub.space/poster/${size}/${id}/img`,
  background: (id: string) => `https://images.metahub.space/background/medium/${id}/img`,
  logo: (id: string) => `https://images.metahub.space/logo/medium/${id}/img`,
};
