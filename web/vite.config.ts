import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The app is served under /app/ by the streaming server in production.
export default defineConfig({
  base: "/app/",
  plugins: [react()],
  server: {
    port: 8080,
    proxy: {
      "/debrid": "http://127.0.0.1:11470",
      "/iptv": "http://127.0.0.1:11470",
      "/addon": "http://127.0.0.1:11470",
      "/proxy": "http://127.0.0.1:11470",
      "/probe": "http://127.0.0.1:11470",
      "/subtitles.vtt": "http://127.0.0.1:11470",
      "/transcode.mp4": "http://127.0.0.1:11470",
      "/settings": "http://127.0.0.1:11470",
      "/party": { target: "ws://127.0.0.1:11470", ws: true },
    },
  },
});
