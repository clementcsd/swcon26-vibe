import express from "express";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import type { ClientMessage } from "../shared/protocol.ts";
import {
  chat,
  concede,
  disconnect,
  join,
  kick,
  leave,
  playAgain,
  resume,
  setSeats,
  startGame,
  submitAnswer,
} from "./rooms.ts";

const PORT = Number(process.env.PORT ?? 3001);
const root = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(root, "../dist/client");

const app = express();
const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get(/.*/, (_req, res) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });
} else {
  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });
}

function parse(raw: string): ClientMessage | null {
  try {
    const data = JSON.parse(raw) as ClientMessage;
    if (!data || typeof data !== "object" || typeof data.type !== "string") return null;
    return data;
  } catch {
    return null;
  }
}

wss.on("connection", (socket: WebSocket) => {
  socket.on("message", (raw) => {
    const message = parse(String(raw));
    if (!message) return;
    switch (message.type) {
      case "join":
        join(socket, message.nickname, message.playerId, message.roomCode);
        break;
      case "resume":
        resume(socket, message.playerId);
        break;
      case "submit_answer":
        submitAnswer(socket, message.text);
        break;
      case "chat":
        chat(socket, message.text);
        break;
      case "concede":
        concede(socket);
        break;
      case "play_again":
        playAgain(socket);
        break;
      case "leave":
        leave(socket);
        break;
      case "start":
        startGame(socket);
        break;
      case "kick":
        kick(socket, message.playerId);
        break;
      case "set_seats":
        setSeats(socket, message.seats);
        break;
    }
  });
  socket.on("close", () => disconnect(socket));
  socket.on("error", () => disconnect(socket));
});

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`argue.io server on http://localhost:${PORT}`);
});
