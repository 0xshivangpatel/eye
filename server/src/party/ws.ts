// WebSocket transport for watch-together rooms.
//
// Protocol (JSON text frames):
//   client -> {type:"hello", name, room?: CODE, create?: true}   (first frame)
//   server -> {type:"welcome", selfId, room: RoomSnapshot, serverTime}
//   client -> any ClientMessage from rooms.ts, or {type:"ping", t}
//   server -> ServerEvent broadcasts, {type:"pong", t, serverTime}
import { randomUUID } from "node:crypto";
import type { IncomingMessage, Server } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { RoomRegistry, type ClientMessage, type Room, type ServerEvent } from "./rooms.js";

interface Connection {
  id: string;
  socket: WebSocket;
  room: Room | null;
  alive: boolean;
}

const MAX_FRAME = 64 * 1024;

export function attachParty(server: Server, path = "/party", registry = new RoomRegistry()) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME });
  const connections = new Map<string, Connection>();

  server.on("upgrade", (req: IncomingMessage, socket, head) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== path) return;
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });

  const send = (conn: Connection, payload: unknown) => {
    if (conn.socket.readyState === conn.socket.OPEN) conn.socket.send(JSON.stringify(payload));
  };

  const dispatch = (room: Room, events: ServerEvent[]) => {
    for (const event of events) {
      if (event.type === "error") {
        const target = connections.get(event.to);
        if (target) send(target, { type: "error", message: event.message });
        continue;
      }
      if (event.type === "kicked") {
        const target = connections.get(event.memberId);
        if (target) {
          send(target, event);
          target.room = null;
          target.socket.close(4001, "Removed by host");
        }
        continue;
      }
      for (const member of room.members.keys()) {
        const conn = connections.get(member);
        if (conn) send(conn, event);
      }
    }
  };

  wss.on("connection", (socket: WebSocket) => {
    const conn: Connection = { id: randomUUID(), socket, room: null, alive: true };
    connections.set(conn.id, conn);
    socket.on("pong", () => (conn.alive = true));

    socket.on("message", (data) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(data)) as Record<string, unknown>;
      } catch {
        return send(conn, { type: "error", message: "Malformed message" });
      }
      if (msg.type === "ping") {
        return send(conn, { type: "pong", t: msg.t, serverTime: Date.now() });
      }
      if (msg.type === "hello") {
        if (conn.room) return send(conn, { type: "error", message: "Already in a room" });
        const name = typeof msg.name === "string" ? msg.name : "Guest";
        let room: Room | undefined;
        if (msg.create === true) room = registry.create();
        else if (typeof msg.room === "string") room = registry.get(msg.room);
        if (!room) return send(conn, { type: "error", message: "Room not found", code: "room_not_found" });
        conn.room = room;
        const events = room.join(conn.id, name);
        send(conn, { type: "welcome", selfId: conn.id, room: room.snapshot(), serverTime: Date.now() });
        dispatch(room, events);
        return;
      }
      if (!conn.room) return send(conn, { type: "error", message: "Join a room first" });
      dispatch(conn.room, conn.room.handle(conn.id, msg as unknown as ClientMessage));
    });

    socket.on("close", () => {
      connections.delete(conn.id);
      if (conn.room) dispatch(conn.room, conn.room.leave(conn.id));
    });
  });

  const heartbeat = setInterval(() => {
    for (const conn of connections.values()) {
      if (!conn.alive) {
        conn.socket.terminate();
        continue;
      }
      conn.alive = false;
      conn.socket.ping();
    }
    registry.sweep();
  }, 30_000);
  heartbeat.unref();

  return {
    registry,
    close: () => {
      clearInterval(heartbeat);
      for (const conn of connections.values()) conn.socket.terminate();
      wss.close();
    },
  };
}
