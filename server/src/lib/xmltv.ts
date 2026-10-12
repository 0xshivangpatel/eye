// Streaming XMLTV (EPG) parser. Guides can be hundreds of megabytes, so we parse
// with SAX and only keep programmes inside a time window around "now".
import sax from "sax";
import { createGunzip } from "node:zlib";
import { Readable } from "node:stream";

export interface Programme {
  channel: string;
  start: number;
  stop: number;
  title: string;
  description?: string;
  category?: string;
}

export interface Guide {
  channels: Record<string, { name: string; icon?: string }>;
  programmes: Record<string, Programme[]>;
}

/** XMLTV timestamps look like `20240102153000 +0100`. */
export function parseXmltvTime(value: string): number {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*([+-]\d{4})?/.exec(value.trim());
  if (!m) return Number.NaN;
  const [, y, mo, d, h, mi, s = "00", tz] = m;
  let ms = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  if (tz) {
    const sign = tz.startsWith("-") ? -1 : 1;
    const offsetMin = Number(tz.slice(1, 3)) * 60 + Number(tz.slice(3, 5));
    ms -= sign * offsetMin * 60_000;
  }
  return ms;
}

export interface ParseOptions {
  /** Keep programmes overlapping [from, to]. */
  from: number;
  to: number;
  /** Only keep these channel ids (when provided). */
  channelIds?: Set<string>;
}

export function parseXmltv(input: Readable, options: ParseOptions): Promise<Guide> {
  return new Promise((resolve, reject) => {
    const parser = sax.createStream(true, { trim: false });
    const guide: Guide = { channels: {}, programmes: {} };
    let current: Programme | null = null;
    let currentChannel: { id: string; name: string; icon?: string } | null = null;
    let textTarget: "title" | "desc" | "category" | "display-name" | null = null;
    let text = "";

    parser.on("opentag", (node) => {
      const attrs = node.attributes as Record<string, string>;
      switch (node.name) {
        case "channel":
          currentChannel = { id: attrs.id ?? "", name: "" };
          break;
        case "icon":
          if (currentChannel && attrs.src) currentChannel.icon = attrs.src;
          break;
        case "programme": {
          const channel = attrs.channel ?? "";
          const start = parseXmltvTime(attrs.start ?? "");
          const stop = parseXmltvTime(attrs.stop ?? "") || start + 3_600_000;
          const wanted =
            (!options.channelIds || options.channelIds.has(channel)) && stop >= options.from && start <= options.to;
          current = wanted ? { channel, start, stop, title: "" } : null;
          break;
        }
        case "title":
        case "desc":
        case "category":
        case "display-name":
          if (current || (currentChannel && node.name === "display-name")) {
            textTarget = node.name;
            text = "";
          }
          break;
      }
    });
    parser.on("text", (t) => {
      if (textTarget) text += t;
    });
    parser.on("cdata", (t) => {
      if (textTarget) text += t;
    });
    parser.on("closetag", (name) => {
      if (textTarget === name) {
        const value = text.trim();
        if (name === "display-name" && currentChannel && !currentChannel.name) currentChannel.name = value;
        if (current) {
          if (name === "title" && !current.title) current.title = value;
          if (name === "desc" && !current.description) current.description = value;
          if (name === "category" && !current.category) current.category = value;
        }
        textTarget = null;
      }
      if (name === "channel" && currentChannel) {
        if (!options.channelIds || options.channelIds.has(currentChannel.id)) {
          guide.channels[currentChannel.id] = { name: currentChannel.name, ...(currentChannel.icon ? { icon: currentChannel.icon } : {}) };
        }
        currentChannel = null;
      }
      if (name === "programme" && current) {
        (guide.programmes[current.channel] ??= []).push(current);
        current = null;
      }
    });
    parser.on("error", (err) => reject(err));
    parser.on("end", () => {
      for (const list of Object.values(guide.programmes)) list.sort((a, b) => a.start - b.start);
      resolve(guide);
    });
    input.on("error", reject);
    input.pipe(parser);
  });
}

/** Wrap a byte stream, transparently gunzipping when it starts with the gzip magic. */
export async function maybeGunzip(stream: Readable): Promise<Readable> {
  const iterator = stream[Symbol.asyncIterator]();
  const first = await iterator.next();
  if (first.done) return Readable.from([]);
  const head = Buffer.from(first.value as Uint8Array);
  const rest = Readable.from(
    (async function* () {
      yield head;
      for (;;) {
        const next = await iterator.next();
        if (next.done) return;
        yield next.value as Buffer;
      }
    })(),
  );
  if (head[0] === 0x1f && head[1] === 0x8b) return rest.pipe(createGunzip());
  return rest;
}
