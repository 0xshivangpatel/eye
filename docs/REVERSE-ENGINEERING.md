# How Stremio was reverse engineered for Marquee

Marquee is a clean-room reimplementation. Nothing from Stremio's proprietary
`server.js` was copied. This document records exactly what was observed in the
shipped artifacts, how it was observed, and which observations the Marquee
server reproduces as an independent implementation. Every claim below is an
**observation** of a shipped artifact, an **inference** drawn from it, or an
explicit **unknown**.

## Artifacts examined

| Artifact | Version | SHA-256 | How obtained |
| --- | --- | --- | --- |
| `StremioSetup-v5.0.24_x64.exe` | 5.0.24 | `12dc718e02773d747f85d5aac765cf73915b63c582ea799cc4f9b880f1242842` | Official link on stremio.com/downloads |
| `stremio_4.4.168-1_amd64.deb` | 4.4.168 | `1028f1a38a70fc66bfcda1c8a9e1674231e17ac81774fc48859ed8f53c7a6039` | dl.strem.io |
| `com.stremio.one-2.3.2-…x86_64.apk` | 2.3.2 | `b874a17ebfc34b9fcdfff008726be1d6873c5c7405380ae274a556072a54e1de` | dl.strem.io |

### Tooling

- The Windows installer is **Inno Setup 6.4.3**. Stock `innoextract` 1.9 cannot
  parse that header version; upstream `innoextract` was built from source and
  patched to accept the 6.4.2/6.4.3 setup-data versions (an added header string
  in 6.4.2 and the reduced file-location flag set in 6.4.3). Extraction then
  yielded the 16 payload files, including `app/server.js`,
  `app/stremio-shell-ng.exe`, `app/stremio-runtime.exe` and the bundled
  ffmpeg/libmpv DLLs.
- `app/server.js` (6.39 MiB, a single webpacked bundle of 1,314 modules) was
  analyzed with **REA** (`analyze_javascript_application`): 1,261 JavaScript
  modules and 108 network endpoints were recovered, cross-checked against the
  bundle's webpack module boundaries.
- `stremio-shell-ng.exe` (a PE32+ Rust binary) was analyzed with REA's **Ghidra**
  provider (Ghidra 12.1.2) to confirm shell IPC command strings; these match the
  open-source shell at github.com/Stremio/stremio-shell-ng.

## Streaming server (`server.js`) — observations

The server is an Express application that binds `127.0.0.1:11470` (incrementing
to 11474 on conflict) and, unless `NO_HTTPS_SERVER`, an HTTPS listener on
`local.strem.io:12470`. The core module (webpack id 172, "EngineFS") exposes a
BitTorrent-to-HTTP bridge; module 813 is the torrent engine, 801 the HTTPS
certificate client, 802 an HTTP proxy, 940 the casting subsystem, 1021 a local
files add-on and 1087 a Usenet/NZB client.

Recovered HTTP surface (selected, `call:*` mechanism = Express route):

| Route | Purpose |
| --- | --- |
| `GET /:infoHash/create`, `/:infoHash/:idx` | create a torrent engine; stream a file by index (HTTP Range) |
| `GET /:infoHash/stats.json`, `/stats.json` | per-torrent / global engine statistics |
| `GET /:infoHash/remove`, `/removeAll` | tear engines down |
| `GET /:first/:second/{master,stream,…}.m3u8`, `…/:seg.ts` | HLSv2 transmux playlists and segments |
| `GET /subtitles.:ext`, `/subtitlesTracks`, `/opensubHash` | subtitle conversion to SRT/VTT and OpenSubtitles hashing |
| `GET /probe`, `/hwaccel-profiler`, `/device-info` | ffprobe inspection and hardware-accel profiling |
| `GET /settings`, `POST /settings` | read/update server settings (persisted to `server-settings.json`) |
| `GET /network-info`, `/heartbeat` | LAN interface discovery; liveness |
| `GET /get-https`, `/casting/*`, `/yt/:id`, `/proxy` | HTTPS cert provisioning, DLNA/Chromecast, YouTube resolve, generic proxy |

Other observations:

- **Settings** (module 106) persist to `server-settings.json` and include
  `cacheSize` (default 2 GiB; 0 on Android), `btMaxConnections` (55),
  `btHandshakeTimeout` (20 s), `btRequestTimeout` (4 s), transcode options and
  `proxyStreamsEnabled`. Environment flags `TV_ENV`, `UNITY_ENV`, `IOS_APP`
  toggle casting/caching/HTTPS off.
- **CORS** is allowed for origins matching `*.strem.io`, `*.stremio.net`,
  `*.stremio.com`, `stremio.github.io` and `localhost:11470`.
- **HTTPS certificates** (module 801) are fetched from
  `https://api.strem.io/api/certificateGet` with `{authKey, ipAddress}` and
  cached in `httpsCert.json`; this gives the loopback server a browser-trusted
  cert for a `*.strem.io` subdomain derived from the LAN IP.
- The **web UI** location defaults to `https://app.strem.io/shell-v4.4/`; the
  root route 307-redirects there with `?streamingServer=<encoded local url>`.
- There is **no debrid support** in the server: a search of all recovered
  strings for `real-debrid|alldebrid|premiumize|torbox` returned nothing. In
  real Stremio, debrid is provided by community **add-ons**, not the server.

## Shell (`stremio-shell-ng.exe`) — observations

The shell is a Rust binary that supervises `stremio-runtime.exe server.js` and
hosts the web UI in a WebView. REA/Ghidra confirmed IPC command strings
(`win-set-visibility`, `pick-cache-directory`, `play-external`, `mpv-*`,
`autoupdater-*`, `open-external`), matching the public `stremio-shell-ng`
source. The shell↔UI transport is a JSON-RPC handshake (`id:0`) advertising a
`transport` object; player control flows over `mpv-*` methods.

## What Marquee reproduces (independently)

Marquee's server (`server/src`) reimplements the **behaviours** above from this
spec, not the code:

- Stremio-compatible torrent routes (`/:infoHash/create`, `/:infoHash/:idx`
  Range streaming, `stats.json`) over the `torrent-stream` library.
- `GET /settings` / `POST /settings`, `/heartbeat`, `/network-info`, a generic
  `/proxy` with HLS rewriting, `/subtitles.vtt`, `/probe` and `/transcode.mp4`.
- The Stremio **add-on protocol** client (manifest/catalog/meta/stream/subtitle),
  verified live against cinemeta, the streaming-catalogs add-on, WatchHub and
  OpenSubtitles v3.

Marquee then **adds** what Stremio leaves to add-ons or omits: a first-class
Real-Debrid integration, IPTV (M3U/Xtream/XMLTV), and a watch-together service.
It deliberately does **not** reproduce Stremio's `api.strem.io` certificate
provisioning or its proprietary web UI.
