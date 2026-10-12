# Self-hosting Marquee for a group

The goal: you run one Marquee server on a VPS, link **your** Real-Debrid account
once, and your friends open the web app and stream through it. Real-Debrid sees
a single server IP — exactly what it expects for a server — so there is nothing
to "evade" and no multi-IP account-sharing problem.

## What stays private

- The Real-Debrid token is stored only on the server, in
  `~/.marquee/server-settings.json` (mode `0600`), and is **never** returned by
  any HTTP endpoint. Guests can *resolve* streams through it but cannot read or
  change it.
- Admin actions — setting/removing the token, changing server settings, browsing
  your Real-Debrid cloud — require either a request from the server host itself
  (loopback) or the admin token (below). Guests get `403` on those.

## Accounts

Access is invite-only: there is no public sign-up. One admin account is created
on first run.

- Set `MARQUEE_ADMIN_USER` (default `aeon`) and `MARQUEE_ADMIN_PASSWORD` to
  choose the admin credentials.
- If you don't set `MARQUEE_ADMIN_PASSWORD`, the server generates a strong
  random one and prints it **once** to the log on first start — grab it from
  there, sign in, and change it in Settings → Account. No password is baked
  into the source or the image.

The admin then creates an account for each person in Settings → People.

## Option A — Docker (recommended)

```bash
git clone https://github.com/0xshivangpatel/eye marquee && cd marquee
cp .env.example .env            # set MARQUEE_ADMIN_PASSWORD (and user) in .env
docker compose up -d --build
```

The container stores settings, accounts and the torrent cache in the
`marquee-data` volume and binds to `127.0.0.1:11470`; put a TLS reverse proxy in
front (see below). Link Real-Debrid from Settings after signing in — the token
lives in the volume, never in the image or compose file. The container runs with
`MARQUEE_DISABLE_LOOPBACK_ADMIN=1`, so everyone (including you) signs in.

## Option B — from source

```bash
# on the VPS
git clone https://github.com/0xshivangpatel/eye marquee && cd marquee
npm install && npm run build

# configure
export MARQUEE_ADMIN_USER=aeon
export MARQUEE_ADMIN_PASSWORD="a-strong-password"
export MARQUEE_ALLOWED_ORIGINS="https://watch.example.com"
export MARQUEE_DISABLE_LOOPBACK_ADMIN=1                 # require login even on the host
export HOST=0.0.0.0 PORT=11470

npm start
```

Put this behind a TLS reverse proxy (Caddy/nginx) so the app and its WebSocket
are served over HTTPS. Example Caddyfile:

```
watch.example.com {
    reverse_proxy 127.0.0.1:11470
}
```

Then:

1. Open `https://watch.example.com/app/`.
2. Go to **Settings → Profile** and paste your `MARQUEE_ADMIN_TOKEN` into
   "Server admin token". This authorises your browser for admin actions.
3. In **Settings → Debrid**, link your Real-Debrid account.
4. Share `https://watch.example.com/app/` with your friends. They just browse
   and play; with `MARQUEE_SHARE_DEBRID=1` their torrent streams resolve through
   your account automatically. They never need the admin token.

## Environment variables

| Variable | Effect |
| --- | --- |
| `HOST`, `PORT` | Bind address (default `0.0.0.0:11470`). |
| `MARQUEE_HOME` | Where settings and cache live (default `~/.marquee`). |
| `MARQUEE_ADMIN_USER` | Admin username created on first run (default `aeon`). |
| `MARQUEE_ADMIN_PASSWORD` | Admin password on first run. If unset, a random one is generated and printed once to the log. |
| `MARQUEE_ADMIN_TOKEN` | Grants admin from non-loopback clients via the `x-marquee-admin` header. |
| `MARQUEE_DISABLE_LOOPBACK_ADMIN=1` | Require login even for host-local requests (recommended on a shared server). |
| `MARQUEE_ALLOWED_ORIGINS` | Extra CORS origins (comma-separated) beyond localhost/LAN. |
| `MARQUEE_TRUST_LAN=1` | Treat all clients as admin (use only on a trusted private LAN). |
| `FFMPEG_BIN`, `FFPROBE_BIN` | Paths to ffmpeg/ffprobe if not on `PATH`. |

## Scaling notes

- Each distinct torrent is cached once on the server (via Real-Debrid or the
  local engine) and served to every viewer from there, so a watch-together room
  of N people is still one debrid resolution.
- Real-Debrid rate-limits at 250 requests/minute per account; Marquee caches
  resolved links for 30 minutes and reuses existing transfers, which keeps a
  normal group well under that.
- The torrent engine stores partial downloads under `MARQUEE_HOME/cache`; size
  it per `cacheSize` in settings and give the VPS enough disk.
