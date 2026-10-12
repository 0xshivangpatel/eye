// Stremio add-on protocol types (the subset Marquee consumes). Verified against
// live responses from cinemeta, the streaming-catalogs add-on and watchhub.

export type MetaType = "movie" | "series" | "channel" | "tv" | string;

export interface MetaPreview {
  id: string;
  type: MetaType;
  name: string;
  poster?: string;
  posterShape?: "poster" | "landscape" | "square";
  background?: string;
  logo?: string;
  description?: string;
  releaseInfo?: string;
  imdbRating?: string;
  genres?: string[];
}

export interface Video {
  id: string;
  title?: string;
  name?: string;
  season?: number;
  episode?: number;
  number?: number;
  thumbnail?: string;
  overview?: string;
  released?: string;
  firstAired?: string;
}

export interface MetaDetail extends MetaPreview {
  videos?: Video[];
  runtime?: string;
  cast?: string[];
  director?: string[];
  writer?: string[];
  country?: string;
  trailerStreams?: Array<{ title?: string; ytId: string }>;
  links?: Array<{ name: string; category: string; url: string }>;
  behaviorHints?: { defaultVideoId?: string | null; hasScheduledVideos?: boolean };
}

export interface Stream {
  url?: string;
  ytId?: string;
  infoHash?: string;
  fileIdx?: number;
  externalUrl?: string;
  name?: string;
  title?: string;
  description?: string;
  sources?: string[];
  subtitles?: Subtitle[];
  behaviorHints?: {
    bingeGroup?: string;
    filename?: string;
    notWebReady?: boolean;
    videoSize?: number;
    proxyHeaders?: { request?: Record<string, string>; response?: Record<string, string> };
  };
}

export interface Subtitle {
  id: string;
  url: string;
  lang: string;
}

export interface CatalogDefinition {
  type: MetaType;
  id: string;
  name?: string;
  extra?: Array<{ name: string; options?: string[]; isRequired?: boolean; optionsLimit?: number }>;
  extraSupported?: string[];
  extraRequired?: string[];
}

export interface Manifest {
  id: string;
  version: string;
  name: string;
  description?: string;
  logo?: string;
  background?: string;
  types: MetaType[];
  resources: Array<string | { name: string; types?: MetaType[]; idPrefixes?: string[] }>;
  catalogs: CatalogDefinition[];
  idPrefixes?: string[];
  behaviorHints?: { configurable?: boolean; configurationRequired?: boolean };
}

export interface AddonDescriptor {
  /** Full URL to the add-on's manifest.json. */
  transportUrl: string;
  manifest: Manifest;
}
