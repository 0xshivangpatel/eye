declare module "torrent-stream" {
  import { EventEmitter } from "node:events";
  import { Readable } from "node:stream";

  namespace torrentStream {
  interface TorrentFile {
    name: string;
    path: string;
    length: number;
    offset: number;
    select(): void;
    deselect(): void;
    createReadStream(opts?: { start?: number; end?: number }): Readable;
  }

  interface Swarm extends EventEmitter {
    downloaded: number;
    uploaded: number;
    downloadSpeed(): number;
    uploadSpeed(): number;
    wires: Array<{ peerChoking: boolean }>;
    paused: boolean;
    queued: number;
    pause(): void;
    resume(): void;
  }

  interface Engine extends EventEmitter {
    infoHash: string;
    files: TorrentFile[];
    torrent?: { name: string; pieceLength: number; length: number; pieces: unknown[] };
    swarm: Swarm;
    bitfield?: { get(i: number): boolean };
    connect(addr: string): void;
    listen(port?: number, cb?: () => void): void;
    destroy(cb?: () => void): void;
    remove(keepPieces: boolean, cb?: () => void): void;
  }

  interface Options {
    connections?: number;
    uploads?: number;
    tmp?: string;
    path?: string;
    verify?: boolean;
    dht?: boolean | number;
    tracker?: boolean;
    trackers?: string[];
    name?: string;
  }

  }
  function torrentStream(source: string | Buffer | object, opts?: torrentStream.Options): torrentStream.Engine;
  export = torrentStream;
}
