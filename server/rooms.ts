import { WebSocket } from "ws";
import {
  DEBATE_MS,
  MAX_ANSWER_LENGTH,
  MAX_CHAT_LENGTH,
  MAX_NICKNAME_LENGTH,
  MAX_PLAYERS,
  QUESTION_MS,
  RECONNECT_MS,
  type ChatMessage,
  type Phase,
  type PlayerPublic,
  type RoomState,
  type ServerMessage,
  type Stance,
  type Surrender,
} from "../shared/protocol.ts";
import { pickQuestion } from "./questions.ts";

const COLORS = ["#22d3ee", "#f472b6", "#a3e635", "#fbbf24", "#c084fc", "#fb7185"];
const PLAYER_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Player = {
  id: string;
  nickname: string;
  color: string;
  connected: boolean;
  socket: WebSocket | null;
  answer: string | null;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
};

type Room = {
  code: string;
  phase: Phase;
  question: string;
  phaseEndsAt: number | null;
  players: Player[];
  messages: ChatMessage[];
  timer: ReturnType<typeof setTimeout> | null;
  surrender: Surrender | null;
};

const rooms = new Map<string, Room>();
const playerRooms = new Map<string, string>();
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

function stancesFor(room: Room, viewerId: string): Stance[] {
  const all = room.players
    .filter((player) => player.answer)
    .map((player) => ({
      playerId: player.id,
      nickname: player.nickname,
      color: player.color,
      text: player.answer ?? "",
    }));
  if (room.phase === "waiting") return [];
  if (room.phase === "question") return all.filter((stance) => stance.playerId === viewerId);
  return all;
}

function messagesFor(room: Room): ChatMessage[] {
  if (room.phase === "waiting" || room.phase === "question") return [];
  return room.messages;
}

export function snapshot(room: Room, viewerId: string): RoomState {
  const viewer = room.players.find((player) => player.id === viewerId);
  return {
    code: room.code,
    phase: room.phase,
    question: room.question,
    phaseEndsAt: room.phaseEndsAt,
    players: room.players.map(publicPlayer),
    stances: stancesFor(room, viewerId),
    messages: messagesFor(room),
    myAnswer: viewer?.answer ?? null,
    surrender: room.surrender,
  };
}

function broadcast(room: Room): void {
  for (const player of room.players) {
    send(player.socket, { type: "state", room: snapshot(room, player.id) });
  }
}

function clearTimer(room: Room): void {
  if (room.timer) {
    clearTimeout(room.timer);
    room.timer = null;
  }
}

function clearReconnect(player: Player): void {
  if (player.reconnectTimer) {
    clearTimeout(player.reconnectTimer);
    player.reconnectTimer = null;
  }
}

function startQuestion(room: Room): void {
  room.phase = "question";
  room.question = pickQuestion(room.question);
  room.phaseEndsAt = Date.now() + QUESTION_MS;
  room.messages = [];
  room.surrender = null;
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

function maybeAdvanceQuestion(room: Room): void {
  if (room.phase !== "question") return;
  const live = room.players.filter((player) => player.connected);
  if (live.length >= MAX_PLAYERS && live.every((player) => player.answer)) {
    startDebate(room);
  }
}

function destroyIfEmpty(room: Room): void {
  const kept = room.players.some((player) => player.connected || player.reconnectTimer);
  if (kept) return;
  clearTimer(room);
  for (const player of room.players) {
    clearReconnect(player);
    playerRooms.delete(player.id);
  }
  rooms.delete(room.code);
}

function sanitizeNick(raw: string): string {
  const nick = raw.trim().replace(/\s+/g, " ").slice(0, MAX_NICKNAME_LENGTH);
  return nick.length >= 2 ? nick : "";
}

function validPlayerId(id: string | undefined): id is string {
  return Boolean(id && PLAYER_ID_RE.test(id));
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
    surrender: null,
  };
  rooms.set(room.code, room);
  return room;
}

function attach(socket: WebSocket, room: Room, player: Player): void {
  const previous = player.socket;
  clearReconnect(player);
  player.socket = socket;
  player.connected = true;
  socketRoom.set(socket, { roomCode: room.code, playerId: player.id });
  playerRooms.set(player.id, room.code);
  if (previous && previous !== socket && previous.readyState === WebSocket.OPEN) {
    previous.close();
  }
}

function welcome(player: Player, room: Room): void {
  send(player.socket, { type: "welcome", playerId: player.id, room: snapshot(room, player.id) });
}

function forfeit(room: Room, player: Player): void {
  player.reconnectTimer = null;
  if (player.connected) return;
  if (room.phase === "waiting") {
    room.players = room.players.filter((p) => p.id !== player.id);
    playerRooms.delete(player.id);
    broadcast(room);
    destroyIfEmpty(room);
    return;
  }
  if (room.phase === "ended") {
    destroyIfEmpty(room);
    return;
  }

  room.surrender = { playerId: player.id, nickname: player.nickname };
  room.phase = "ended";
  room.phaseEndsAt = Date.now();
  clearTimer(room);

  const left: ServerMessage = {
    type: "opponent_left",
    playerId: player.id,
    nickname: player.nickname,
  };
  for (const other of room.players) {
    if (other.id === player.id) continue;
    send(other.socket, left);
  }
  broadcast(room);
}

function rejoin(socket: WebSocket, playerId: string): boolean {
  const roomCode = playerRooms.get(playerId);
  if (!roomCode) return false;
  const room = rooms.get(roomCode);
  if (!room) {
    playerRooms.delete(playerId);
    return false;
  }
  const player = room.players.find((p) => p.id === playerId);
  if (!player) {
    playerRooms.delete(playerId);
    return false;
  }
  attach(socket, room, player);
  welcome(player, room);
  broadcast(room);
  maybeStart(room);
  maybeAdvanceQuestion(room);
  return true;
}

export function resume(socket: WebSocket, playerId: string): void {
  if (!validPlayerId(playerId) || !rejoin(socket, playerId)) {
    send(socket, { type: "error", message: "No active debate to restore." });
  }
}

export function join(
  socket: WebSocket,
  nickname: string,
  playerId: string,
  roomCode?: string,
): void {
  const nick = sanitizeNick(nickname);
  if (!nick) {
    send(socket, { type: "error", message: "Pick a nickname (2–16 characters)." });
    return;
  }
  if (!validPlayerId(playerId)) {
    send(socket, { type: "error", message: "Invalid player id." });
    return;
  }

  if (rejoin(socket, playerId)) return;

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
    id: playerId,
    nickname: nick,
    color: COLORS[room.players.length % COLORS.length]!,
    connected: true,
    socket,
    answer: null,
    reconnectTimer: null,
  };
  room.players.push(player);
  attach(socket, room, player);
  welcome(player, room);
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
  maybeAdvanceQuestion(room);
}

export function chat(socket: WebSocket, text: string): void {
  const loc = socketRoom.get(socket);
  if (!loc) return;
  const room = rooms.get(loc.roomCode);
  if (!room || room.phase !== "debate" || room.surrender) return;
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

  room.players = room.players.filter((p) => p.connected);
  for (const player of room.players) player.answer = null;
  room.messages = [];
  room.phase = "waiting";
  room.phaseEndsAt = null;
  room.question = "";
  room.surrender = null;
  clearTimer(room);
  broadcast(room);
  maybeStart(room);
}

export function leave(socket: WebSocket): void {
  const loc = socketRoom.get(socket);
  if (!loc) return;
  const room = rooms.get(loc.roomCode);
  if (!room) return;
  const player = room.players.find((p) => p.id === loc.playerId);
  if (!player || player.socket !== socket) return;
  if (room.phase !== "waiting") {
    send(socket, { type: "error", message: "The debate already started — you cannot cancel." });
    return;
  }

  room.players = room.players.filter((p) => p.id !== player.id);
  playerRooms.delete(player.id);
  socketRoom.delete(socket);
  player.connected = false;
  player.socket = null;
  send(socket, { type: "left" });
  broadcast(room);
  destroyIfEmpty(room);
}

export function disconnect(socket: WebSocket): void {
  const loc = socketRoom.get(socket);
  if (!loc) return;
  const room = rooms.get(loc.roomCode);
  if (!room) return;
  const player = room.players.find((p) => p.id === loc.playerId);
  if (!player) return;
  if (player.socket !== socket) return;

  player.connected = false;
  player.socket = null;

  if (room.phase === "waiting") {
    room.players = room.players.filter((p) => p.id !== player.id);
    playerRooms.delete(player.id);
    broadcast(room);
    destroyIfEmpty(room);
    return;
  }

  clearReconnect(player);
  player.reconnectTimer = setTimeout(() => forfeit(room, player), RECONNECT_MS);
  broadcast(room);
}
