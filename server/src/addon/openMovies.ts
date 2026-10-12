// Built-in Stremio-protocol add-on serving Creative Commons films from the
// Blender Foundation. It gives a fresh install something legally playable and
// doubles as a fixture for the player, transcoder and watch-together tests.
import { Router } from "express";

interface OpenMovie {
  id: string;
  name: string;
  year: number;
  runtime: string;
  genres: string[];
  description: string;
  director: string[];
  streams: Array<{
    title: string;
    url?: string;
    infoHash?: string;
    fileIdx?: number;
    filename?: string;
    sources?: string[];
  }>;
  subtitles?: Array<{ id: string; lang: string; url: string }>;
  trailer?: string;
}

const MOVIES: OpenMovie[] = [
  {
    id: "tt1254207",
    name: "Big Buck Bunny",
    year: 2008,
    runtime: "10 min",
    genres: ["Animation", "Comedy", "Short"],
    description:
      "A large and lovable rabbit deals with three tiny bullies, led by a flying squirrel, who are determined to squelch his happiness.",
    director: ["Sacha Goedegebure"],
    streams: [
      { title: "720p · MP4 · archive.org", url: "https://archive.org/download/BigBuckBunny_124/Content/big_buck_bunny_720p_surround.mp4" },
      {
        title: "P2P · WebTorrent swarm",
        infoHash: "dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c",
        filename: "Big Buck Bunny.mp4",
        sources: ["tracker:udp://tracker.opentrackr.org:1337/announce"],
      },
    ],
    trailer: "https://download.blender.org/peach/trailer/trailer_480p.mov",
  },
  {
    id: "tt0807840",
    name: "Elephants Dream",
    year: 2006,
    runtime: "11 min",
    genres: ["Animation", "Sci-Fi", "Short"],
    description:
      "Friends Proog and Emo journey inside the folds of a seemingly infinite Machine, exploring the dark and twisted complex of wires, gears, and cogs.",
    director: ["Bassam Kurdali"],
    streams: [
      { title: "HD · MP4 · archive.org", url: "https://archive.org/download/ElephantsDream/ed_hd.mp4" },
      { title: "1024p · AVI (transcoded) · blender.org", url: "https://download.blender.org/ED/ED_1024.avi" },
    ],
  },
  {
    id: "tt1727587",
    name: "Sintel",
    year: 2010,
    runtime: "15 min",
    genres: ["Animation", "Fantasy", "Short"],
    description:
      "A lonely young woman, Sintel, helps and befriends a dragon, whom she calls Scales. When he is kidnapped by an adult dragon, Sintel sets out on a dangerous quest.",
    director: ["Colin Levy"],
    streams: [
      { title: "2048p · MP4 · archive.org", url: "https://archive.org/download/Sintel/sintel-2048-surround.mp4" },
      {
        title: "P2P · WebTorrent swarm",
        infoHash: "08ada5a7a6183aae1e09d831df6748d566095a10",
        filename: "Sintel.mp4",
        sources: ["tracker:udp://tracker.opentrackr.org:1337/announce"],
      },
    ],
    trailer: "https://download.blender.org/durian/trailer/sintel_trailer-720p.mp4",
  },
  {
    id: "tt2285752",
    name: "Tears of Steel",
    year: 2012,
    runtime: "12 min",
    genres: ["Sci-Fi", "Short"],
    description:
      "A group of warriors and scientists gather at the Oude Kerk in Amsterdam to stage a crucial event from the past, in a desperate attempt to rescue the world from destructive robots.",
    director: ["Ian Hubert"],
    streams: [
      { title: "1080p · WebM · archive.org", url: "https://archive.org/download/Tears-of-Steel/tears_of_steel_1080p.webm" },
      { title: "720p · MOV · blender.org", url: "https://download.blender.org/demo/movies/ToS/tears_of_steel_720p.mov" },
    ],
    subtitles: [{ id: "tos-en", lang: "eng", url: "https://download.blender.org/demo/movies/ToS/subtitles/TOS-en.srt" }],
  },
];

const IMG = (kind: "poster" | "background" | "logo", id: string) =>
  `https://images.metahub.space/${kind}/${kind === "poster" ? "medium" : "medium"}/${id}/img`;

function toMeta(m: OpenMovie, full = false) {
  return {
    id: m.id,
    type: "movie",
    name: m.name,
    poster: IMG("poster", m.id),
    background: IMG("background", m.id),
    logo: IMG("logo", m.id),
    releaseInfo: String(m.year),
    genres: m.genres,
    description: m.description,
    ...(full ? { runtime: m.runtime, director: m.director, year: m.year } : {}),
  };
}

export const OPEN_MOVIES_MANIFEST = {
  id: "app.marquee.openmovies",
  version: "1.0.0",
  name: "Open Movies",
  description: "Creative Commons films from the Blender Foundation, playable out of the box.",
  logo: "https://download.blender.org/branding/blender_logo_socket.png",
  resources: ["catalog", "meta", "stream", "subtitles"],
  types: ["movie"],
  idPrefixes: MOVIES.map((m) => m.id),
  catalogs: [{ type: "movie", id: "open-movies", name: "Open Movies" }],
  behaviorHints: { configurable: false },
};

export function openMoviesRouter(): Router {
  const router = Router();
  const find = (id: string) => MOVIES.find((m) => m.id === id.replace(/\.json$/, ""));

  router.get("/manifest.json", (_req, res) => {
    res.json(OPEN_MOVIES_MANIFEST);
  });
  router.get("/catalog/movie/open-movies{/:extra}.json", (_req, res) => {
    res.json({ metas: MOVIES.map((m) => toMeta(m)) });
  });
  router.get("/meta/movie/:id.json", (req, res) => {
    const m = find(req.params.id);
    res.json({ meta: m ? toMeta(m, true) : null });
  });
  router.get("/stream/movie/:id.json", (req, res) => {
    const m = find(req.params.id);
    res.json({
      streams: (m?.streams ?? []).map((s) => ({
        name: "Open Movies",
        title: s.title,
        ...(s.url ? { url: s.url } : {}),
        ...(s.infoHash ? { infoHash: s.infoHash } : {}),
        ...(s.fileIdx !== undefined ? { fileIdx: s.fileIdx } : {}),
        ...(s.sources ? { sources: s.sources } : {}),
        behaviorHints: { ...(s.filename ? { filename: s.filename } : {}), bingeGroup: "open-movies" },
      })),
    });
  });
  router.get("/subtitles/movie/:id{/:extra}.json", (req, res) => {
    const m = find(req.params.id);
    res.json({ subtitles: m?.subtitles ?? [] });
  });
  return router;
}
