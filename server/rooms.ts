import { WebSocket } from "ws";
import {
  DEBATE_MS,
  MAX_ANSWER_LENGTH,
  MAX_CHAT_LENGTH,
  MAX_NICKNAME_LENGTH,
  MAX_PLAYERS,
  QUESTION_MS,
  type ChatMessage,
  type Phase,
  type PlayerPublic,
  type RoomState,
  type ServerMessage,
  type Stance,
} from "../shared/protocol.ts";
import { pickQuestion } from "./questions.ts";

const COLORS = ["#22d3ee", "#f472b6", "#a3e635", "#fbbf24", "#c084fc", "#fb7185"];

type Player = {
  id: string;
  nickname: string;
  color: string;
  connected: boolean;
  socket: WebSocket | null;
  answer: string | null;
};

type Room = {
  code: string;
  phase: Phase;
  question: string;
  phaseEndsAt: number | null;
  players: Player[];
  messages: ChatMessage[];
  timer: ReturnType<typeof setTimeout> | null;
};

const rooms = new Map<string, Room>();
const socketRoom = new WeakMap<WebSocket, { roomCode: string; playerId: string }>();

function code(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 4; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

function uniqueCode(): string {
  let next = code();
  while (rooms.has(next)) next = code();
  return next;
}

function send(socket: WebSocket | null, message: ServerMessage): void {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(message));
}

function publicPlayer(player: Player): PlayerPublic {
  return {
    id: player.id,
    nickname: player.nickname,
    color: player.color,
    connected: player.connected,
    hasAnswer: player.answer !== null,
  };
}

function stances(room: Room): Stance[] {
  if (room.phase === "waiting" || room.phase === "question") return [];
  return room.players
    .filter((player) => player.answer)
    .map((player) => ({
      playerId: player.id,
      nickname: player.nickname,
      color: player.color,
      text: player.answer ?? "",
    }));
}

export function snapshot(room: Room): RoomState {
  return {
    code: room.code,
    phase: room.phase,
    question: room.question,
    phaseEndsAt: room.phaseEndsAt,
    players: room.players.map(publicPlayer),
    stances: stances(room),
    messages: room.phase === "waiting" || room.phase === "question" ? [] : room.messages,
  };
}

function broadcast(room: Room): void {
  const state = snapshot(room);
  for (const player of room.players) {
    send(player.socket, { type: "state", room: state });
  }
}

function clearTimer(room: Room): void {
  if (room.timer) {
    clearTimeout(room.timer);
    room.timer = null;
  }
}

function startQuestion(room: Room): void {
  room.phase = "question";
  room.question = pickQuestion(room.question);
  room.phaseEndsAt = Date.now() + QUESTION_MS;
  room.messages = [];
  for (const player of room.players) player.answer = null;
  clearTimer(room);
  room.timer = setTimeout(() => startDebate(room), QUESTION_MS);
  broadcast(room);
}

function startDebate(room: Room): void {
  if (room.phase !== "question") return;
  room.phase = "debate";
  room.phaseEndsAt = Date.now() + DEBATE_MS;
  clearTimer(room);
  room.timer = setTimeout(() => endDebate(room), DEBATE_MS);
  broadcast(room);
}

function endDebate(room: Room): void {
  if (room.phase !== "debate") return;
  room.phase = "ended";
  room.phaseEndsAt = Date.now();
  clearTimer(room);
  broadcast(room);
}

function maybeStart(room: Room): void {
  const ready = room.players.filter((player) => player.connected);
  if (room.phase === "waiting" && ready.length >= MAX_PLAYERS) {
    startQuestion(room);
  }
}

function destroyIfEmpty(room: Room): void {
  const anyone = room.players.some((player) => player.connected);
  if (anyone) return;
  clearTimer(room);
  rooms.delete(room.code);
}

function sanitizeNick(raw: string): string {
  const nick = raw.trim().replace(/\s+/g, " ").slice(0, MAX_NICKNAME_LENGTH);
  return nick.length >= 2 ? nick : "";
}

function findOpenRoom(): Room | null {
  for (const room of rooms.values()) {
    if (room.phase !== "waiting") continue;
    if (room.players.filter((player) => player.connected).length >= MAX_PLAYERS) continue;
    return room;
  }
  return null;
}

function createRoom(): Room {
  const room: Room = {
    code: uniqueCode(),
    phase: "waiting",
    question: "",
    phaseEndsAt: null,
    players: [],
    messages: [],
    timer: null,
  };
  rooms.set(room.code, room);
  return room;
}

export function join(
  socket: WebSocket,
  nickname: string,
  roomCode?: string,
): void {
  const nick = sanitizeNick(nickname);
  if (!nick) {
    send(socket, { type: "error", message: "Pick a nickname (2–16 characters)." });
    return;
  }

  let room: Room | undefined;
  if (roomCode) {
    room = rooms.get(roomCode.trim().toUpperCase());
    if (!room) {
      send(socket, { type: "error", message: "No room with that code." });
      return;
    }
  } else {
    room = findOpenRoom() ?? createRoom();
  }

  const live = room.players.filter((player) => player.connected);
  if (live.length >= MAX_PLAYERS && room.phase === "waiting") {
    send(socket, { type: "error", message: "That room is full. Try another code." });
    return;
  }
  if (room.phase !== "waiting") {
    send(socket, { type: "error", message: "That debate already started." });
    return;
  }

  const player: Player = {
    id: crypto.randomUUID(),
    nickname: nick,
    color: COLORS[room.players.length % COLORS.length]!,
    connected: true,
    socket,
    answer: null,
  };
  room.players.push(player);
  socketRoom.set(socket, { roomCode: room.code, playerId: player.id });
  send(socket, { type: "welcome", playerId: player.id, room: snapshot(room) });
  broadcast(room);
  maybeStart(room);
}

export function submitAnswer(socket: WebSocket, text: string): void {
  const loc = socketRoom.get(socket);
  if (!loc) return;
  const room = rooms.get(loc.roomCode);
  if (!room || room.phase !== "question") return;
  const player = room.players.find((p) => p.id === loc.playerId);
  if (!player || player.answer) return;

  const answer = text.trim().slice(0, MAX_ANSWER_LENGTH);
  if (answer.length < 8) {
    send(socket, { type: "error", message: "Give a bit more of a stance (8+ characters)." });
    return;
  }
  player.answer = answer;
  broadcast(room);

  const everyoneIn = room.players
    .filter((p) => p.connected)
    .every((p) => p.answer);
  if (everyoneIn && room.players.filter((p) => p.connected).length >= MAX_PLAYERS) {
    startDebate(room);
  }
}

export function chat(socket: WebSocket, text: string): void {
  const loc = socketRoom.get(socket);
  if (!loc) return;
  const room = rooms.get(loc.roomCode);
  if (!room || room.phase !== "debate") return;
  const player = room.players.find((p) => p.id === loc.playerId);
  if (!player) return;

  const body = text.trim().slice(0, MAX_CHAT_LENGTH);
  if (!body) return;

  const message: ChatMessage = {
    id: crypto.randomUUID(),
    playerId: player.id,
    nickname: player.nickname,
    color: player.color,
    text: body,
    at: Date.now(),
  };
  room.messages.push(message);
  if (room.messages.length > 200) room.messages.splice(0, room.messages.length - 200);
  for (const p of room.players) {
    send(p.socket, { type: "chat", message });
  }
}

export function playAgain(socket: WebSocket): void {
  const loc = socketRoom.get(socket);
  if (!loc) return;
  const room = rooms.get(loc.roomCode);
  if (!room || room.phase !== "ended") return;

  const connected = room.players.filter((p) => p.connected);
  room.players = connected;
  room.messages = [];
  room.phase = "waiting";
  room.phaseEndsAt = null;
  room.question = "";
  for (const player of room.players) player.answer = null;
  clearTimer(room);
  broadcast(room);
  maybeStart(room);
}

export function disconnect(socket: WebSocket): void {
  const loc = socketRoom.get(socket);
  if (!loc) return;
  const room = rooms.get(loc.roomCode);
  if (!room) return;
  const player = room.players.find((p) => p.id === loc.playerId);
  if (!player) return;
  player.connected = false;
  player.socket = null;
  if (room.phase === "waiting") {
    room.players = room.players.filter((p) => p.id !== player.id);
  }
  broadcast(room);
  destroyIfEmpty(room);
}
