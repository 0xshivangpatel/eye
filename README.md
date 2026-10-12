# Marquee

A Netflix-style media center built on the open **Stremio add-on protocol**, with
a first-class **Real-Debrid** integration, **Live TV (IPTV)**, and a
**watch-together** mode that syncs movies, series, YouTube and any direct video
link across a room of friends.

Marquee is a clean-room project: its streaming server reimplements the Stremio
streaming-server HTTP contract from an independent spec (see
[docs/REVERSE-ENGINEERING.md](docs/REVERSE-ENGINEERING.md)) and talks to the
same community add-ons, but shares no code with Stremio.

> **Legal note.** Marquee ships only Creative-Commons content out of the box
> (the Blender open movies). Catalogs, streams, debrid accounts and IPTV
> playlists are things **you** add and are responsible for. Use your own
> accounts and content you have the right to access.

## Features

- **Browse like Netflix.** A rotating hero, per-OTT rows (Netflix, HBO Max,
  Disney+, Prime Video, Apple TV+) sourced from Stremio catalog add-ons, plus
  every catalog your installed add-ons advertise.
- **Play anything your add-ons find.** Direct links, HLS and BitTorrent. Torrents
  stream through Real-Debrid when configured, otherwise through the built-in
  torrent engine. Unsupported containers/codecs are transcoded to fragmented MP4
  on the fly.
- **Real-Debrid.** Link your account once; torrents resolve to fast direct
  links. On a shared server (see below) your guests stream through it without
  ever seeing the token.
- **Live TV.** M3U playlists, Xtream Codes accounts and XMLTV EPG, with a channel
  grid and now-playing guide.
- **Watch Together.** Create a room, share a 6-character code, and stay in sync —
  play/pause/seek, a buffering hold so nobody gets ahead, chat, reactions, and
  host controls. Works for add-on titles, **YouTube**, and **any direct video
  URL**.

## Architecture

```
server/   Node + TypeScript. Torrent engine, Real-Debrid, IPTV, media proxy,
          transcoder, and the watch-together WebSocket. Serves the web app.
web/      React + TypeScript (Vite). The Netflix-style UI and player.
docs/     Reverse-engineering spec and self-hosting guide.
```

Dependencies flow one way: the web app talks to the server over HTTP/WebSocket
and to add-ons over the Stremio protocol. The watch-together room logic is a
pure state machine (`server/src/party/rooms.ts`) with a thin socket layer, so it
is fully unit-tested.

## Quick start (local)

```bash
npm install
npm run build          # builds server and web
npm start              # serves everything on http://127.0.0.1:11470/app/
```

For development with hot reload:

```bash
npm run dev            # server on :11470, Vite web on :8080 (proxied)
```

On first run an **admin account** (`aeon` by default) is created. Set
`MARQUEE_ADMIN_PASSWORD` to choose its password, or read the random one printed
to the log once. Sign in, then go to **Settings** to link your Real-Debrid
account, add IPTV sources, and create accounts for other people (there is no
public sign-up).

### Docker

```bash
cp .env.example .env    # set MARQUEE_ADMIN_PASSWORD
docker compose up -d --build   # http://127.0.0.1:11470/app/
```

## Self-hosting for a group (one VPS, one key)

Run Marquee on your own VPS so your friends share your Real-Debrid account from
a single server IP. Admin actions (setting the token, changing settings) stay
locked to the host; only stream resolution is shared, and the token is never
exposed. See [docs/self-hosting.md](docs/self-hosting.md).

## Tests

```bash
npm test                         # server unit + integration (25 tests)
node test/e2e/watch-together.mjs # two-browser e2e (needs a running server + playwright)
```

## License

MIT for Marquee's own code. Bundled Blender open movies are Creative Commons
(CC-BY). Stremio, Real-Debrid and any add-ons or IPTV services are the property
of their respective owners and are not affiliated with this project.
