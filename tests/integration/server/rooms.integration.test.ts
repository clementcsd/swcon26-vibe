import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MockWebSocket,
  createMockSocket,
  WebSocketStates,
} from "../../support/mockSocket";
import {
  concede,
  disconnect,
  join,
  kick,
  playAgain,
  report,
  resetState,
  setSeats,
  startGame,
  submitAnswer,
} from "../../../server/rooms";
import {
  DEBATE_MS,
  DEFAULT_SEATS,
  MAX_NICKNAME_LENGTH,
  QUESTION_MS,
  RECONNECT_MS,
  REPORT_LIMIT,
} from "../../../shared/protocol";
import { QUESTIONS } from "../../../server/questions";

// ---------------------------------------------------------------------------
// Integration tests — rooms.ts in-process, driven through MockWebSocket with
// fake timers (enabled in tests/support/setup.ts) so phase and reconnect
// timeouts can be advanced deterministically.
// ---------------------------------------------------------------------------

type RoomState = {
  code: string;
  phase: string;
  question: string;
  phaseEndsAt: number | null;
  hostId: string;
  players: Array<{ id: string; nickname: string; color: string; connected: boolean; isHost: boolean }>;
  stances: Array<{ playerId: string; text: string }>;
  myAnswer: string | null;
  surrender: { playerId: string; nickname: string } | null;
  consensus: boolean;
};

function id(n: number): string {
  return `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
}

function lastState(socket: MockWebSocket): RoomState {
  const msg = socket.lastOfType<{ room: RoomState }>("state");
  if (!msg) throw new Error("socket received no state message");
  return msg.room;
}

function lastError(socket: MockWebSocket): string | null {
  return socket.lastOfType<{ message: string }>("error")?.message ?? null;
}

/** Host creates a room and `count - 1` guests join it. */
function lobby(count: number): { sockets: MockWebSocket[]; ids: string[]; code: string } {
  const sockets: MockWebSocket[] = [];
  const ids: string[] = [];
  const host = createMockSocket();
  join(host, "Player0", id(0));
  sockets.push(host);
  ids.push(id(0));
  const code = host.lastOfType<{ room: RoomState }>("welcome")!.room.code;
  for (let i = 1; i < count; i += 1) {
    const s = createMockSocket();
    join(s, `Player${i}`, id(i), code);
    sockets.push(s);
    ids.push(id(i));
  }
  return { sockets, ids, code };
}

function toDebate(sockets: MockWebSocket[]): void {
  startGame(sockets[0]!);
  sockets.forEach((s, i) => submitAnswer(s, `Stance number ${i} on the question.`));
}

beforeEach(() => {
  vi.clearAllTimers();
  resetState();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("rooms.join", () => {
  it("assigns a color, marks the host, and broadcasts state to the joiner", () => {
    const { sockets, ids } = lobby(2);
    const [host, guest] = sockets as [MockWebSocket, MockWebSocket];

    const welcome = guest.lastOfType<{ playerId: string; room: RoomState }>("welcome");
    expect(welcome?.playerId).toBe(ids[1]);

    const state = lastState(guest);
    expect(state.hostId).toBe(ids[0]);
    expect(state.players.map((p) => p.id)).toEqual(ids);
    expect(state.players[0]!.isHost).toBe(true);
    expect(state.players[1]!.isHost).toBe(false);
    expect(state.players[0]!.color).toMatch(/^#[0-9a-f]{6}$/);
    expect(state.players[1]!.color).not.toBe(state.players[0]!.color);

    // The host is told about the newcomer too.
    expect(lastState(host).players).toHaveLength(2);
  });

  it("rejects an empty nickname and truncates one that is too long", () => {
    const empty = createMockSocket();
    join(empty, "   ", id(1));
    expect(lastError(empty)).toBe("Pick a nickname (2–16 characters).");
    expect(empty.lastOfType("welcome")).toBeNull();

    const long = createMockSocket();
    join(long, "x".repeat(40), id(2));
    const me = lastState(long).players.find((p) => p.id === id(2));
    expect(me?.nickname).toBe("x".repeat(MAX_NICKNAME_LENGTH));
  });

  it("caps enrollment at seatLimit and rejects further joins", () => {
    const { code } = lobby(DEFAULT_SEATS);
    const extra = createMockSocket();
    join(extra, "Latecomer", id(99), code);
    expect(lastError(extra)).toBe("That lobby is full. Try another code.");
    expect(extra.lastOfType("welcome")).toBeNull();
  });

  it("reuses a reconnecting player's existing seat instead of adding a duplicate", () => {
    const { sockets, ids, code } = lobby(2);
    startGame(sockets[0]!);
    disconnect(sockets[1]!);

    const back = createMockSocket();
    join(back, "Player1", ids[1]!, code);

    const state = lastState(back);
    expect(state.players).toHaveLength(2);
    expect(state.players.filter((p) => p.id === ids[1])).toHaveLength(1);
    expect(state.players.find((p) => p.id === ids[1])?.connected).toBe(true);
    expect(state.phase).toBe("question");
  });
});

describe("rooms.gameFlow", () => {
  it("host start transitions waiting -> question and picks a non-repeated question", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const { sockets } = lobby(2);
    const [host] = sockets as [MockWebSocket];

    expect(lastState(host).phase).toBe("waiting");
    startGame(host);
    const first = lastState(host);
    expect(first.phase).toBe("question");
    expect(QUESTIONS).toContain(first.question);

    // Finish the round and start another: the same question must not repeat,
    // even though Math.random keeps pointing at the first pool entry.
    vi.advanceTimersByTime(QUESTION_MS + DEBATE_MS);
    expect(lastState(host).phase).toBe("ended");
    playAgain(host);
    startGame(host);
    const second = lastState(host);
    expect(second.phase).toBe("question");
    expect(second.question).not.toBe(first.question);
  });

  it("question timer expiry advances question -> debate", () => {
    const { sockets } = lobby(2);
    const [host] = sockets as [MockWebSocket];
    startGame(host);

    vi.advanceTimersByTime(QUESTION_MS - 1);
    expect(lastState(host).phase).toBe("question");

    vi.advanceTimersByTime(1);
    const state = lastState(host);
    expect(state.phase).toBe("debate");
    expect(state.phaseEndsAt).toBe(Date.now() + DEBATE_MS);
  });

  it("debate timer expiry advances debate -> ended", () => {
    const { sockets } = lobby(2);
    const [host] = sockets as [MockWebSocket];
    toDebate(sockets);
    expect(lastState(host).phase).toBe("debate");

    vi.advanceTimersByTime(DEBATE_MS - 1);
    expect(lastState(host).phase).toBe("debate");

    vi.advanceTimersByTime(1);
    const state = lastState(host);
    expect(state.phase).toBe("ended");
    expect(state.consensus).toBe(false);
    expect(state.surrender).toBeNull();
  });

  it("submitting an answer reveals only the viewer's stance during question phase", () => {
    const { sockets, ids } = lobby(3);
    const [host, guest, third] = sockets as [MockWebSocket, MockWebSocket, MockWebSocket];
    startGame(host);
    submitAnswer(host, "Homework teaches discipline.");
    submitAnswer(guest, "Homework steals family time.");

    const hostView = lastState(host);
    expect(hostView.phase).toBe("question");
    expect(hostView.stances).toEqual([
      expect.objectContaining({ playerId: ids[0], text: "Homework teaches discipline." }),
    ]);
    expect(hostView.myAnswer).toBe("Homework teaches discipline.");

    const thirdView = lastState(third);
    expect(thirdView.stances).toEqual([]);
    expect(thirdView.myAnswer).toBeNull();

    // Once everyone answers, the debate reveals all stances to everybody.
    submitAnswer(third, "It depends on the age group.");
    expect(lastState(third).phase).toBe("debate");
    expect(lastState(third).stances).toHaveLength(3);
  });
});

describe("rooms.moderation", () => {
  it("host kick removes the player and notifies them with reason host", () => {
    const { sockets, ids } = lobby(3);
    const [host, guest, third] = sockets as [MockWebSocket, MockWebSocket, MockWebSocket];

    kick(host, ids[1]!);

    expect(guest.lastOfType<{ reason: string }>("kicked")?.reason).toBe("host");
    expect(lastState(host).players.map((p) => p.id)).toEqual([ids[0], ids[2]]);
    expect(lastState(third).players.map((p) => p.id)).toEqual([ids[0], ids[2]]);
  });

  it("reports beyond REPORT_LIMIT auto-kick the reported player", () => {
    // The target plus REPORT_LIMIT + 1 distinct reporters.
    const total = REPORT_LIMIT + 2;
    const host = createMockSocket();
    join(host, "Player0", id(0));
    const code = lastState(host).code;
    setSeats(host, total);
    const sockets = [host];
    for (let i = 1; i < total; i += 1) {
      const s = createMockSocket();
      join(s, `Player${i}`, id(i), code);
      sockets.push(s);
    }
    const target = sockets[1]!;
    const targetId = id(1);
    const reporters = sockets.filter((s) => s !== target);

    reporters.slice(0, REPORT_LIMIT).forEach((s) => report(s, targetId));
    expect(target.lastOfType("kicked")).toBeNull();
    expect(lastState(host).players.map((p) => p.id)).toContain(targetId);

    report(reporters[REPORT_LIMIT]!, targetId);
    expect(target.lastOfType<{ reason: string }>("kicked")?.reason).toBe("reports");
    expect(lastState(host).players.map((p) => p.id)).not.toContain(targetId);
    expect(lastState(host).players).toHaveLength(total - 1);
  });

  it("disconnect during waiting removes the player; during debate starts the reconnect grace", () => {
    const waiting = lobby(2);
    disconnect(waiting.sockets[1]!);
    expect(lastState(waiting.sockets[0]!).players.map((p) => p.id)).toEqual([waiting.ids[0]]);

    resetState();
    const { sockets, ids } = lobby(3);
    const [host, guest] = sockets as [MockWebSocket, MockWebSocket];
    toDebate(sockets);

    disconnect(guest);
    let bob = lastState(host).players.find((p) => p.id === ids[1]);
    expect(bob?.connected).toBe(false);

    // Still holding the seat right up to the end of the grace period.
    vi.advanceTimersByTime(RECONNECT_MS - 1);
    bob = lastState(host).players.find((p) => p.id === ids[1]);
    expect(bob).toBeDefined();
    expect(lastState(host).phase).toBe("debate");
  });

  it("reconnect grace expiry forfeits the player and ends the room if below MIN_PLAYERS", () => {
    const { sockets, ids } = lobby(2);
    const [host, guest] = sockets as [MockWebSocket, MockWebSocket];
    toDebate(sockets);

    disconnect(guest);
    vi.advanceTimersByTime(RECONNECT_MS);

    expect(host.lastOfType<{ playerId: string }>("opponent_left")?.playerId).toBe(ids[1]);
    const state = lastState(host);
    expect(state.phase).toBe("ended");
    expect(state.surrender).toEqual({ playerId: ids[1], nickname: "Player1" });
    expect(state.players.map((p) => p.id)).toEqual([ids[0]]);
  });

  it("reconnect grace expiry keeps the debate going when enough players remain", () => {
    const { sockets, ids } = lobby(3);
    const [host, guest] = sockets as [MockWebSocket, MockWebSocket];
    toDebate(sockets);

    disconnect(guest);
    vi.advanceTimersByTime(RECONNECT_MS);

    const state = lastState(host);
    expect(state.phase).toBe("debate");
    expect(state.players.map((p) => p.id)).not.toContain(ids[1]);
  });

  it("everyone conceding ends the debate with consensus", () => {
    const { sockets } = lobby(2);
    toDebate(sockets);
    sockets.forEach((s) => concede(s));
    const state = lastState(sockets[0]!);
    expect(state.phase).toBe("ended");
    expect(state.consensus).toBe(true);
  });
});

describe("MockWebSocket contract", () => {
  it("records sent messages and reports readyState", () => {
    const socket = createMockSocket();
    socket.send('{"type":"welcome"}');
    expect(socket.readyState).toBe(WebSocketStates.OPEN);
    expect(socket.lastSent).toBe('{"type":"welcome"}');
    expect(socket.lastOfType("welcome")).toEqual({ type: "welcome" });
    socket.close();
    expect(socket.readyState).toBe(WebSocketStates.CLOSED);
    expect(() => socket.send("{}")).toThrow("WebSocket is not open");
  });
});
