import { WebSocket } from "ws";
import {
  DEBATE_MS,
  DEFAULT_SEATS,
  MAX_ANSWER_LENGTH,
  MAX_CHAT_LENGTH,
  MAX_NICKNAME_LENGTH,
  MAX_PLAYERS,
  MIN_PLAYERS,
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

const COLORS = [
  "#22d3ee",
  "#f472b6",
  "#a3e635",
  "#fbbf24",
  "#c084fc",
  "#fb7185",
  "#38bdf8",
  "#fb923c",
  "#4ade80",
  "#e879f9",
];
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
  hostId: string;
  seatLimit: number;
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

function connectedPlayers(room: Room): Player[] {
  return room.players.filter((player) => player.connected);
}

function publicPlayer(room: Room, player: Player): PlayerPublic {
  return {
    id: player.id,
    nickname: player.nickname,
    color: player.color,
    connected: player.connected,
    hasAnswer: player.answer !== null,
    isHost: player.id === room.hostId,
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
    players: room.players.map((player) => publicPlayer(room, player)),
    stances: stancesFor(room, viewerId),
    messages: messagesFor(room),
    myAnswer: viewer?.answer ?? null,
    surrender: room.surrender,
    hostId: room.hostId,
    seatLimit: room.seatLimit,
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

function promoteHost(room: Room): void {
  const next = connectedPlayers(room)[0];
  room.hostId = next?.id ?? "";
}

function removePlayer(room: Room, player: Player): void {
  clearReconnect(player);
  room.players = room.players.filter((p) => p.id !== player.id);
  playerRooms.delete(player.id);
  if (player.socket) socketRoom.delete(player.socket);
  player.connected = false;
  player.socket = null;
  if (room.hostId === player.id) promoteHost(room);
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

function maybeAdvanceQuestion(room: Room): void {
  if (room.phase !== "question") return;
  const live = connectedPlayers(room);
  if (live.length >= MIN_PLAYERS && live.every((player) => player.answer)) {
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
    hostId: "",
    seatLimit: DEFAULT_SEATS,
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

function locate(
  socket: WebSocket,
): { room: Room; player: Player } | null {
  const loc = socketRoom.get(socket);
  if (!loc) return null;
  const room = rooms.get(loc.roomCode);
  if (!room) return null;
  const player = room.players.find((p) => p.id === loc.playerId);
  if (!player || player.socket !== socket) return null;
  return { room, player };
}

function requireHost(socket: WebSocket): { room: Room; player: Player } | null {
  const found = locate(socket);
  if (!found) return null;
  if (found.player.id !== found.room.hostId) {
    send(socket, { type: "error", message: "Only the host can do that." });
    return null;
  }
  return found;
}

function forfeit(room: Room, player: Player): void {
  player.reconnectTimer = null;
  if (player.connected) return;
  if (room.phase === "waiting") {
    removePlayer(room, player);
    broadcast(room);
    destroyIfEmpty(room);
    return;
  }
  if (room.phase === "ended") {
    destroyIfEmpty(room);
    return;
  }

  const left: ServerMessage = {
    type: "opponent_left",
    playerId: player.id,
    nickname: player.nickname,
  };
  for (const other of room.players) {
    if (other.id === player.id) continue;
    send(other.socket, left);
  }
  removePlayer(room, player);

  const live = connectedPlayers(room);
  if (live.length < MIN_PLAYERS) {
    room.surrender = { playerId: player.id, nickname: player.nickname };
    room.phase = "ended";
    room.phaseEndsAt = Date.now();
    clearTimer(room);
  }
  broadcast(room);
  destroyIfEmpty(room);
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
    room = createRoom();
  }

  if (room.phase !== "waiting") {
    send(socket, { type: "error", message: "That debate already started." });
    return;
  }
  const live = connectedPlayers(room);
  if (live.length >= room.seatLimit) {
    send(socket, { type: "error", message: "That lobby is full. Try another code." });
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
  if (!room.hostId) room.hostId = player.id;
  attach(socket, room, player);
  welcome(player, room);
  broadcast(room);
}

export function startGame(socket: WebSocket): void {
  const found = requireHost(socket);
  if (!found) return;
  const { room } = found;
  if (room.phase !== "waiting") {
    send(socket, { type: "error", message: "The debate already started." });
    return;
  }
  if (connectedPlayers(room).length < MIN_PLAYERS) {
    send(socket, { type: "error", message: "Need at least two players to start." });
    return;
  }
  startQuestion(room);
}

export function setSeats(socket: WebSocket, seats: number): void {
  const found = requireHost(socket);
  if (!found) return;
  const { room } = found;
  if (room.phase !== "waiting") {
    send(socket, { type: "error", message: "Seat count is locked once the debate starts." });
    return;
  }
  const next = Math.round(Number(seats));
  if (!Number.isFinite(next) || next < MIN_PLAYERS || next > MAX_PLAYERS) {
    send(socket, { type: "error", message: `Seats must be between ${MIN_PLAYERS} and ${MAX_PLAYERS}.` });
    return;
  }
  if (next < connectedPlayers(room).length) {
    send(socket, { type: "error", message: "Kick someone first — seats can’t go below players already here." });
    return;
  }
  room.seatLimit = next;
  broadcast(room);
}

export function kick(socket: WebSocket, targetId: string): void {
  const found = requireHost(socket);
  if (!found) return;
  const { room, player: host } = found;
  if (room.phase !== "waiting") {
    send(socket, { type: "error", message: "You can only kick people from the lobby." });
    return;
  }
  if (targetId === host.id) {
    send(socket, { type: "error", message: "You can’t kick yourself. Leave instead." });
    return;
  }
  const target = room.players.find((p) => p.id === targetId);
  if (!target) return;
  const targetSocket = target.socket;
  removePlayer(room, target);
  send(targetSocket, { type: "kicked" });
  broadcast(room);
  destroyIfEmpty(room);
}

export function submitAnswer(socket: WebSocket, text: string): void {
  const found = locate(socket);
  if (!found) return;
  const { room, player } = found;
  if (room.phase !== "question" || player.answer) return;

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
  const found = locate(socket);
  if (!found) return;
  const { room, player } = found;
  if (room.phase !== "debate" || room.surrender) return;

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
  const found = locate(socket);
  if (!found) return;
  const { room } = found;
  if (room.phase !== "ended") return;

  room.players = room.players.filter((p) => p.connected);
  for (const player of room.players) player.answer = null;
  room.messages = [];
  room.phase = "waiting";
  room.phaseEndsAt = null;
  room.question = "";
  room.surrender = null;
  if (!room.players.some((p) => p.id === room.hostId)) promoteHost(room);
  if (room.seatLimit < connectedPlayers(room).length) {
    room.seatLimit = Math.min(MAX_PLAYERS, connectedPlayers(room).length);
  }
  clearTimer(room);
  broadcast(room);
}

export function leave(socket: WebSocket): void {
  const found = locate(socket);
  if (!found) return;
  const { room, player } = found;
  if (room.phase !== "waiting") {
    send(socket, { type: "error", message: "The debate already started — you cannot cancel." });
    return;
  }

  removePlayer(room, player);
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
    removePlayer(room, player);
    broadcast(room);
    destroyIfEmpty(room);
    return;
  }

  clearReconnect(player);
  player.reconnectTimer = setTimeout(() => forfeit(room, player), RECONNECT_MS);
  broadcast(room);
}
