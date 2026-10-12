import { describe, expect, it } from "vitest";
import { Readable } from "node:stream";
import { gzipSync } from "node:zlib";
import { parseM3U } from "../src/lib/m3u.js";
import { decodeSubtitleBytes, toWebVtt } from "../src/lib/subtitles.js";
import { rewritePlaylist } from "../src/lib/hls.js";
import { guessFileIndex, buildMagnet, trackersFromSources } from "../src/lib/files.js";
import { maybeGunzip, parseXmltv, parseXmltvTime } from "../src/lib/xmltv.js";
import { apiUrl, liveUrl, normalizeServer, redactCredentials } from "../src/lib/xtream.js";

describe("parseM3U", () => {
  it("parses attributes, groups, headers and EPG urls", () => {
    const text = [
      '#EXTM3U x-tvg-url="https://epg.example/guide.xml.gz"',
      '#EXTINF:-1 tvg-id="news.us" tvg-logo="https://logo/n.png" group-title="News;Public",News, Live (1080p)',
      "#EXTVLCOPT:http-user-agent=Mozilla/5.0",
      "#EXTVLCOPT:http-referrer=https://ref.example/",
      "https://cdn.example/news/index.m3u8",
      "#EXTINF:0,Plain",
      "#EXTGRP:Movies",
      "http://cdn.example/plain.ts",
      "",
    ].join("\r\n");
    const pl = parseM3U(text);
    expect(pl.epgUrls).toEqual(["https://epg.example/guide.xml.gz"]);
    expect(pl.channels).toHaveLength(2);
    const [news, plain] = pl.channels;
    expect(news).toMatchObject({
      name: "News, Live (1080p)",
      tvgId: "news.us",
      logo: "https://logo/n.png",
      group: ["News", "Public"],
      headers: { "User-Agent": "Mozilla/5.0", Referer: "https://ref.example/" },
    });
    expect(plain).toMatchObject({ name: "Plain", group: ["Movies"], url: "http://cdn.example/plain.ts" });
    expect(plain!.headers).toBeUndefined();
    expect(news!.id).not.toEqual(plain!.id);
  });

  it("ignores junk and URIs without EXTINF still produce a channel", () => {
    const pl = parseM3U("﻿#EXTM3U\n#RANDOM\nhttp://a/b.m3u8\n");
    expect(pl.channels.map((c) => c.name)).toEqual(["http://a/b.m3u8"]);
  });
});

describe("subtitles", () => {
  it("converts SRT to WebVTT with offsets and drops cues before zero", () => {
    const srt = "1\r\n00:00:01,000 --> 00:00:02,500\r\nHello {\\an8}there\r\n\r\n2\r\n00:01:00,000 --> 00:01:02,000\r\nLine one\r\nLine two\r\n";
    expect(toWebVtt(srt)).toBe("WEBVTT\n\n00:00:01.000 --> 00:00:02.500\nHello there\n\n00:01:00.000 --> 00:01:02.000\nLine one\nLine two\n");
    const shifted = toWebVtt(srt, -2000);
    expect(shifted).toContain("00:00:58.000 --> 00:01:00.000");
    expect(shifted).toContain("00:00:00.000 --> 00:00:00.500");
  });

  it("falls back to windows-1252 for non UTF-8 bytes", () => {
    const bytes = new Uint8Array([0x63, 0x61, 0x66, 0xe9]); // "café" in cp1252
    expect(decodeSubtitleBytes(bytes)).toBe("café");
  });
});

describe("rewritePlaylist", () => {
  it("routes segments, variants and key URIs through the proxy", () => {
    const body = [
      "#EXTM3U",
      '#EXT-X-KEY:METHOD=AES-128,URI="keys/k1.bin"',
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",URI="https://other.example/audio.m3u8"',
      "#EXTINF:6,",
      "seg-1.ts?x=1",
      "/abs/seg-2.ts",
    ].join("\n");
    const out = rewritePlaylist(body, "https://cdn.example/live/master.m3u8", "http://127.0.0.1:11470/proxy", { Referer: "r" });
    const lines = out.split("\n");
    const proxied = (u: string) => `http://127.0.0.1:11470/proxy?${new URLSearchParams({ url: u, headers: JSON.stringify({ Referer: "r" }) })}`;
    expect(lines[1]).toBe(`#EXT-X-KEY:METHOD=AES-128,URI="${proxied("https://cdn.example/live/keys/k1.bin")}"`);
    expect(lines[2]).toContain(`URI="${proxied("https://other.example/audio.m3u8")}"`);
    expect(lines[4]).toBe(proxied("https://cdn.example/live/seg-1.ts?x=1"));
    expect(lines[5]).toBe(proxied("https://cdn.example/abs/seg-2.ts"));
  });
});

describe("guessFileIndex", () => {
  const pack = [
    { name: "Show/Season 1/Show.S01E01.1080p.mkv", length: 900 },
    { name: "Show/Season 1/Show.S01E02.1080p.mkv", length: 950 },
    { name: "Show/Season 1/Show.S01E10.1080p.mkv", length: 800 },
    { name: "Show/Sample/sample.mkv", length: 2000 },
    { name: "Show/info.nfo", length: 10 },
  ];
  it("matches season/episode without confusing E01 and E10", () => {
    expect(guessFileIndex(pack, { season: 1, episode: 1 })).toBe(0);
    expect(guessFileIndex(pack, { season: 1, episode: 10 })).toBe(2);
    expect(guessFileIndex([{ name: "show.1x02.avi", length: 1 }, { name: "show.1x03.avi", length: 1 }], { season: 1, episode: 2 })).toBe(0);
  });
  it("prefers the filename hint, then the largest non-sample video", () => {
    expect(guessFileIndex(pack, { filename: "Show.S01E02.1080p.mkv" })).toBe(1);
    expect(guessFileIndex(pack)).toBe(1);
    expect(guessFileIndex([])).toBe(-1);
  });
  it("builds magnets and reads Stremio sources", () => {
    expect(buildMagnet("ab".repeat(20), ["udp://t:1/announce"])).toBe(
      `magnet:?xt=urn:btih:${"ab".repeat(20)}&tr=${encodeURIComponent("udp://t:1/announce")}`,
    );
    expect(trackersFromSources(["tracker:udp://x:1", "dht:abc"])).toEqual(["udp://x:1"]);
  });
});

describe("xmltv", () => {
  const xml = `<?xml version="1.0"?><tv>
    <channel id="a.us"><display-name>Channel A</display-name><icon src="https://i/a.png"/></channel>
    <channel id="b.us"><display-name>Channel B</display-name></channel>
    <programme channel="a.us" start="20300101100000 +0100" stop="20300101110000 +0100"><title>Morning &amp; News</title><desc><![CDATA[Daily]]></desc><category>News</category></programme>
    <programme channel="a.us" start="20300101090000 +0100" stop="20300101100000 +0100"><title>Early</title></programme>
    <programme channel="b.us" start="20300101100000 +0000" stop="20300101110000 +0000"><title>B show</title></programme>
    <programme channel="a.us" start="20290101100000 +0000" stop="20290101110000 +0000"><title>Old</title></programme>
  </tv>`;
  it("parses timezones", () => {
    expect(parseXmltvTime("20300101100000 +0100")).toBe(Date.UTC(2030, 0, 1, 9));
    expect(parseXmltvTime("20300101100000 -0530")).toBe(Date.UTC(2030, 0, 1, 15, 30));
  });
  it("keeps programmes in the window, sorted, filtered by channel, through gzip", async () => {
    const from = Date.UTC(2030, 0, 1, 0);
    const to = Date.UTC(2030, 0, 2, 0);
    const stream = await maybeGunzip(Readable.from([gzipSync(Buffer.from(xml))]));
    const guide = await parseXmltv(stream, { from, to, channelIds: new Set(["a.us"]) });
    expect(Object.keys(guide.channels)).toEqual(["a.us"]);
    expect(guide.channels["a.us"]).toEqual({ name: "Channel A", icon: "https://i/a.png" });
    expect(guide.programmes["a.us"]!.map((p) => p.title)).toEqual(["Early", "Morning & News"]);
    expect(guide.programmes["a.us"]![1]).toMatchObject({ description: "Daily", category: "News" });
    expect(guide.programmes["b.us"]).toBeUndefined();
  });
});

describe("xtream", () => {
  const creds = { server: "provider.example:8080/player_api.php?username=x", username: "user@mail", password: "p&ss" };
  it("normalizes pasted URLs and builds API/stream URLs", () => {
    expect(normalizeServer(creds.server)).toBe("http://provider.example:8080");
    expect(apiUrl(creds, "get_live_streams")).toBe(
      "http://provider.example:8080/player_api.php?username=user%40mail&password=p%26ss&action=get_live_streams",
    );
    expect(liveUrl(creds, 42)).toBe("http://provider.example:8080/live/user%40mail/p%26ss/42.m3u8");
  });
  it("redacts credentials in raw and encoded form", () => {
    expect(redactCredentials(`failed ${liveUrl(creds, 1)} p&ss`, creds)).toBe(
      "failed http://provider.example:8080/live/***/***/1.m3u8 ***",
    );
  });
});
