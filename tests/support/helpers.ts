/**
 * Shared test fixtures for building rooms and players without touching the
 * network. Used by integration tests that exercise rooms.ts in-process.
 */

import { MockWebSocket, createMockSocket } from "./mockSocket";

// NOTE: Room and Player are not exported from rooms.ts. These helper signatures
// use structural types mirroring the internal models so tests can assemble
// fixtures without reaching into private module state.

export type TestPlayer = {
  id: string;
  nickname: string;
  color: string;
  connected: boolean;
  socket: MockWebSocket | null;
  answer: string | null;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  conceded: boolean;
};

export type TestRoom = {
  code: string;
  phase: "waiting" | "question" | "debate" | "ended";
  question: string;
  phaseEndsAt: number | null;
  players: TestPlayer[];
  messages: Array<{
    id: string;
    playerId: string;
    nickname: string;
    color: string;
    text: string;
    at: number;
  }>;
  timer: ReturnType<typeof setTimeout> | null;
  surrender: { playerId: string; nickname: string } | null;
  hostId: string;
  seatLimit: number;
  consensus: boolean;
  reports: Map<string, Set<string>>;
};

export function makePlayer(
  overrides: Partial<TestPlayer> = {}
): TestPlayer {
  return {
    id: overrides.id ?? "player-1",
    nickname: overrides.nickname ?? "Player 1",
    color: overrides.color ?? "#22d3ee",
    connected: overrides.connected ?? true,
    socket: overrides.socket ?? null,
    answer: overrides.answer ?? null,
    reconnectTimer: null,
    conceded: overrides.conceded ?? false,
    ...overrides,
  };
}

export function makeRoom(overrides: Partial<TestRoom> = {}): TestRoom {
  const players = overrides.players ?? [makePlayer()];
  return {
    code: overrides.code ?? "ABCD",
    phase: overrides.phase ?? "waiting",
    question: overrides.question ?? "",
    phaseEndsAt: overrides.phaseEndsAt ?? null,
    players,
    messages: [],
    timer: null,
    surrender: null,
    hostId: overrides.hostId ?? players[0].id,
    seatLimit: overrides.seatLimit ?? 4,
    consensus: false,
    reports: new Map(),
    ...overrides,
  };
}

export function openSocket(player: TestPlayer): MockWebSocket {
  const socket = createMockSocket();
  player.socket = socket;
  player.connected = true;
  return socket;
}

export { MockWebSocket };
