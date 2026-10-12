# Multi-stage build: compile server + web, then a slim runtime image with ffmpeg.
FROM node:22-bookworm-slim AS build
WORKDIR /app

# Install all workspace deps (dev deps needed for the build).
COPY package.json package-lock.json ./
COPY server/package.json server/package.json
COPY web/package.json web/package.json
RUN npm ci

# Build server (tsc) and web (vite).
COPY . .
RUN npm run build

# Prune to production dependencies for the runtime image.
RUN npm prune --omit=dev

# ---- runtime ----
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=11470 \
    MARQUEE_HOME=/data \
    # On a server, do not treat in-container loopback as admin; require login.
    MARQUEE_DISABLE_LOOPBACK_ADMIN=1

# ffmpeg/ffprobe power probing, transcoding and HLS; tini reaps zombies.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg tini ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy the built app and its production node_modules from the build stage.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/server/package.json ./server/package.json
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/web/dist ./web/dist

# Run as the unprivileged node user; /data holds settings, accounts and cache.
RUN mkdir -p /data && chown -R node:node /data
USER node
VOLUME ["/data"]
EXPOSE 11470

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||11470)+'/heartbeat').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server/dist/index.js"]
