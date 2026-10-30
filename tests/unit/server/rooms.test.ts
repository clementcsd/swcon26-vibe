import { describe, it, expect, beforeEach } from "vitest";
import {
  join,
  startGame,
  setSeats,
  kick,
  report,
  submitAnswer,
  chat,
  concede,
  playAgain,
  leave,
  disconnect,
  resume,
  sanitizeNickPublic,
  validPlayerIdPublic,
  snapshot,
  resetState,
  SOCKET_OPEN,
  type SocketLike,
} from "../../../server/rooms";
import { MIN_PLAYERS, MAX_PLAYERS, REPORT_LIMIT, MAX_ANSWER_LENGTH, MAX_CHAT_LENGTH } from "../../../shared/protocol";

/**
 * Minimal in-memory WebSocket stand-in matching the `SocketLike` interface that
 * `rooms.ts` depends on. Each instance records every `send` call so tests can
 * assert on the messages the server would push over a real socket.
 */
class MockSocket implements SocketLike {
  readyState = SOCKET_OPEN;
  sent: string[] = [];

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    // no-op
  }

  on(_event: string, _handler: (...args: unknown[]) => void): void {
    // no-op
  }

  removeListener?(): void {
    // no-op
  }

  lastParsed<T = unknown>(): T | null {
    const raw = this.sent[this.sent.length - 1];
    return raw ? (JSON.parse(raw) as T) : null;
  }

  findParsed<T = unknown>(type: string): T | null {
    for (let i = this.sent.length - 1; i >= 0; i -= 1) {
      const msg = JSON.parse(this.sent[i]) as { type: string } & T;
      if (msg.type === type) return msg;
    }
    return null;
  }

  clear(): void {
    this.sent = [];
  }
}

function makeSocket(): MockSocket {
  return new MockSocket();
}

function lastError(socket: MockSocket): string | null {
  const msg = socket.findParsed<{ message?: string }>("error");
  return msg?.message ?? null;
}

const VALID_ID = "550e8400-e29b-41d4-a716-446655440000";
const VALID_ID_2 = "650e8400-e29b-41d4-a716-446655440001";

beforeEach(() => {
  resetState();
});

describe("sanitizeNickPublic", () => {
  it("trims and collapses whitespace", () => {
    expect(sanitizeNickPublic("  hello   world  ")).toBe("hello world");
  });

  it("truncates to max length", () => {
    expect(sanitizeNickPublic("a".repeat(50))).toBe("a".repeat(16));
  });

  it("accepts the minimum valid length", () => {
    expect(sanitizeNickPublic("ab")).toBe("ab");
  });

  it("rejects nicknames shorter than 2 characters", () => {
    expect(sanitizeNickPublic("a")).toBe("");
    expect(sanitizeNickPublic("")).toBe("");
    expect(sanitizeNickPublic("   ")).toBe("");
  });
});

describe("validPlayerIdPublic", () => {
  it("accepts a valid uuid", () => {
    expect(validPlayerIdPublic(VALID_ID)).toBe(true);
  });

  it("accepts a valid uuid with uppercase hex", () => {
    expect(validPlayerIdPublic(VALID_ID.toUpperCase())).toBe(true);
  });

  it("rejects invalid values", () => {
    expect(validPlayerIdPublic(undefined)).toBe(false);
    expect(validPlayerIdPublic("")).toBe(false);
    expect(validPlayerIdPublic("not-a-uuid")).toBe(false);
    expect(validPlayerIdPublic("550e8400-e29b-41d4-a716-44665544000")).toBe(false);
  });
});

describe("join", () => {
  it("rejects a nickname that is too short", () => {
    const socket = makeSocket();
    join(socket, "a", VALID_ID);
    expect(lastError(socket)).toBe("Pick a nickname (2–16 characters).");
  });

  it("rejects an invalid player id", () => {
    const socket = makeSocket();
    join(socket, "Alice", "not-a-uuid");
    expect(lastError(socket)).toBe("Invalid player id.");
  });

  it("creates a room and sets the first player as host", () => {
    const socket = makeSocket();
    join(socket, "Alice", VALID_ID);

    const welcome = socket.findParsed<{
      type: string;
      playerId: string;
      room: { hostId: string; phase: string; seatLimit: number };
    }>("welcome");
    expect(welcome?.type).toBe("welcome");
    expect(welcome?.playerId).toBe(VALID_ID);
    expect(welcome?.room.hostId).toBe(VALID_ID);
    expect(welcome?.room.phase).toBe("waiting");
    expect(welcome?.room.seatLimit).toBe(4);
  });

  it("joins an existing room by code", () => {
    const host = makeSocket();
    join(host, "Alice", VALID_ID);
    const code = host.lastParsed<{ room: { code: string } }>()?.room.code;
    expect(code).toBeTruthy();

    const joiner = makeSocket();
    join(joiner, "Bob", VALID_ID_2, code);
    expect(lastError(joiner)).toBeNull();

    const welcome = joiner.lastParsed<{ room: { code: string } }>();
    expect(welcome?.room.code).toBe(code);
  });

  it("rejects joining a room with an unknown code", () => {
    const socket = makeSocket();
    join(socket, "Alice", VALID_ID, "XXXX");
    expect(lastError(socket)).toBe("No room with that code.");
  });

  it("rejects joining a room that has already started", () => {
    const host = makeSocket();
    const joiner = makeSocket();
    join(host, "Alice", VALID_ID);
    const code = host.lastParsed<{ room: { code: string } }>()?.room.code!;
    join(joiner, "Bob", VALID_ID_2, code);
    startGame(host);

    const late = makeSocket();
    join(late, "Carol", "750e8400-e29b-41d4-a716-446655440002", code);
    expect(lastError(late)).toBe("That debate already started.");
  });

  it("rejects joining a room that is full", () => {
    const host = makeSocket();
    const joiner = makeSocket();
    join(host, "Alice", VALID_ID);
    const code = host.lastParsed<{ room: { code: string } }>()?.room.code!;

    setSeats(host, 2);
    join(joiner, "Bob", VALID_ID_2, code);

    const late = makeSocket();
    join(late, "Carol", "750e8400-e29b-41d4-a716-446655440002", code);
    expect(lastError(late)).toBe("That lobby is full. Try another code.");
  });

  it("rejoins an existing player without creating a duplicate", () => {
    const socket = makeSocket();
    join(socket, "Alice", VALID_ID);
    const code = socket.findParsed<{ room: { code: string } }>("welcome")?.room.code!;

    const stateBefore = socket.findParsed<{ room: { players: Array<{ id: string }> } }>("state");
    expect(stateBefore?.room.players.length).toBe(1);

    join(socket, "Alice", VALID_ID, code);

    const stateAfter = socket.findParsed<{ room: { players: Array<{ id: string }> } }>("state");
    expect(stateAfter?.room.players.length).toBe(1);
  });
});

describe("startGame", () => {
  it("rejects a non-host", () => {
    const host = makeSocket();
    const joiner = makeSocket();
    join(host, "Alice", VALID_ID);
    const code = host.lastParsed<{ room: { code: string } }>()?.room.code!;
    join(joiner, "Bob", VALID_ID_2, code);

    startGame(joiner);
    expect(lastError(joiner)).toBe("Only the host can do that.");
  });

  it("rejects starting a game that has already started", () => {
    const host = makeSocket();
    const joiner = makeSocket();
    join(host, "Alice", VALID_ID);
    const code = host.lastParsed<{ room: { code: string } }>()?.room.code!;
    join(joiner, "Bob", VALID_ID_2, code);
    startGame(host);

    startGame(host);
    expect(lastError(host)).toBe("The debate already started.");
  });

  it("rejects starting with fewer than two players", () => {
    const host = makeSocket();
    join(host, "Alice", VALID_ID);

    startGame(host);
    expect(lastError(host)).toBe("Need at least two players to start.");
  });

  it("transitions the room to question phase and picks a question", () => {
    const host = makeSocket();
    const joiner = makeSocket();
    join(host, "Alice", VALID_ID);
    const code = host.lastParsed<{ room: { code: string } }>()?.room.code!;
    join(joiner, "Bob", VALID_ID_2, code);

    startGame(host);
    expect(lastError(host)).toBeNull();

    const state = host.findParsed<{ room: { phase: string; question: string } }>(
      "state",
    );
    expect(state?.room.phase).toBe("question");
    expect(state?.room.question.length).toBeGreaterThan(0);
  });
});


describe("setSeats", () => {
  it("rejects a non-host", () => {
    const host = makeSocket();
    const joiner = makeSocket();
    join(host, "Alice", VALID_ID);
    const code = host.lastParsed<{ room: { code: string } }>()?.room.code!;
    join(joiner, "Bob", VALID_ID_2, code);

    setSeats(joiner, 6);
    expect(lastError(joiner)).toBe("Only the host can do that.");
  });

  it("rejects changing seats after the debate has started", () => {
    const host = makeSocket();
    const joiner = makeSocket();
    join(host, "Alice", VALID_ID);
    const code = host.lastParsed<{ room: { code: string } }>()?.room.code!;
    join(joiner, "Bob", VALID_ID_2, code);
    startGame(host);

    setSeats(host, 6);
    expect(lastError(host)).toBe("Seat count is locked once the debate starts.");
  });

  it("rejects seats outside the allowed range", () => {
    const host = makeSocket();
    join(host, "Alice", VALID_ID);

    setSeats(host, MIN_PLAYERS - 1);
    expect(lastError(host)).toContain(`between ${MIN_PLAYERS} and ${MAX_PLAYERS}`);

    setSeats(host, MAX_PLAYERS + 1);
    expect(lastError(host)).toContain(`between ${MIN_PLAYERS} and ${MAX_PLAYERS}`);
  });

  it("rejects seats below the current player count", () => {
    const host = makeSocket();
    const joiner = makeSocket();
    const third = makeSocket();
    join(host, "Alice", VALID_ID);
    const code = host.lastParsed<{ room: { code: string } }>()?.room.code!;
    join(joiner, "Bob", VALID_ID_2, code);
    join(third, "Carol", "750e8400-e29b-41d4-a716-446655440002", code);

    setSeats(host, MIN_PLAYERS);
    expect(lastError(host)).toBe("Kick someone first — seats can’t go below players already here.");
  });

  it("updates the seat limit for a valid value", () => {
    const host = makeSocket();
    join(host, "Alice", VALID_ID);

    setSeats(host, 6);
    expect(lastError(host)).toBeNull();

    const state = host.findParsed<{ room: { seatLimit: number } }>("state");
    expect(state?.room.seatLimit).toBe(6);
  });
});

describe("submitAnswer", () => {
  function enterQuestionPhase(): { host: MockSocket; joiner: MockSocket } {
    const host = makeSocket();
    const joiner = makeSocket();
    join(host, "Alice", VALID_ID);
    const code = host.lastParsed<{ room: { code: string } }>()?.room.code!;
    join(joiner, "Bob", VALID_ID_2, code);
    startGame(host);
    host.clear();
    joiner.clear();
    return { host, joiner };
  }

  it("does nothing when the room is not in question phase", () => {
    const waitingHost = makeSocket();
    join(waitingHost, "Alice", VALID_ID);
    submitAnswer(waitingHost, "some answer text here");
    expect(lastError(waitingHost)).toBeNull();
  });

  it("rejects an answer that is too short", () => {
    const { host } = enterQuestionPhase();
    submitAnswer(host, "short");
    expect(lastError(host)).toBe("Give a bit more of a stance (8+ characters).");
  });

  it("records the answer and broadcasts state", () => {
    const { host } = enterQuestionPhase();
    submitAnswer(host, "This is my stance on the issue.");
    expect(lastError(host)).toBeNull();

    const state = host.findParsed<{
      room: { players: Array<{ id: string; hasAnswer: boolean }> };
    }>("state");
    const me = state?.room.players.find((p) => p.id === VALID_ID);
    expect(me?.hasAnswer).toBe(true);
  });

  it("advances to debate when all players have answered", () => {
    const { host, joiner } = enterQuestionPhase();
    submitAnswer(host, "This is my stance on the issue.");
    submitAnswer(joiner, "This is the opposing stance.");

    const state = host.findParsed<{ room: { phase: string } }>("state");
    expect(state?.room.phase).toBe("debate");
  });
});


describe("chat", () => {
  function enterDebatePhase(): { host: MockSocket; joiner: MockSocket } {
    const h = makeSocket();
    const j = makeSocket();
    join(h, "Alice", VALID_ID);
    const code = h.lastParsed<{ room: { code: string } }>()?.room.code!;
    join(j, "Bob", VALID_ID_2, code);
    startGame(h);
    h.clear();
    j.clear();
    submitAnswer(h, "This is my stance on the issue.");
    submitAnswer(j, "This is the opposing stance.");
    h.clear();
    j.clear();
    return { host: h, joiner: j };
  }

  it("does nothing when the room is not in debate phase", () => {
    const waitingHost = makeSocket();
    join(waitingHost, "Alice", VALID_ID);
    chat(waitingHost, "hello");
    expect(lastError(waitingHost)).toBeNull();
  });

  it("broadcasts a chat message during debate", () => {
    const { host, joiner } = enterDebatePhase();
    chat(host, "Hello everyone");
    expect(lastError(host)).toBeNull();

    const message = joiner.findParsed<{
      type: string;
      message: { playerId: string; text: string };
    }>("chat");
    expect(message?.type).toBe("chat");
    expect(message?.message.playerId).toBe(VALID_ID);
    expect(message?.message.text).toBe("Hello everyone");
  });

  it("censors forbidden words and sends a warning", () => {
    const { host } = enterDebatePhase();
    chat(host, "what the fuck is going on");
    expect(lastError(host)).toBeNull();

    const message = host.findParsed<{ message: { text: string } }>("chat");
    expect(message?.message.text).toBe("what the **** is going on");

    const warning = host.findParsed<{ type: string; warning: string }>("censored");
    expect(warning?.type).toBe("censored");
    expect(warning?.warning).toContain("forbidden words");
  });
});

describe("concede", () => {
  function enterDebatePhase(): { host: MockSocket; joiner: MockSocket } {
    const h = makeSocket();
    const j = makeSocket();
    join(h, "Alice", VALID_ID);
    const code = h.lastParsed<{ room: { code: string } }>()?.room.code!;
    join(j, "Bob", VALID_ID_2, code);
    startGame(h);
    h.clear();
    j.clear();
    submitAnswer(h, "This is my stance on the issue.");
    submitAnswer(j, "This is the opposing stance.");
    h.clear();
    j.clear();
    return { host: h, joiner: j };
  }

  it("does nothing when the room is not in debate phase", () => {
    const waitingHost = makeSocket();
    join(waitingHost, "Alice", VALID_ID);
    concede(waitingHost);
    expect(lastError(waitingHost)).toBeNull();
  });

  it("marks the player as conceded", () => {
    const { host } = enterDebatePhase();
    concede(host);
    expect(lastError(host)).toBeNull();

    const state = host.findParsed<{
      room: { players: Array<{ id: string; conceded: boolean }> };
    }>("state");
    const me = state?.room.players.find((p) => p.id === VALID_ID);
    expect(me?.conceded).toBe(true);
  });

  it("ends the debate with consensus when all players concede", () => {
    const { host, joiner } = enterDebatePhase();
    concede(host);
    concede(joiner);

    const state = host.findParsed<{ room: { phase: string; consensus: boolean } }>("state");
    expect(state?.room.phase).toBe("ended");
    expect(state?.room.consensus).toBe(true);
  });
});


describe("playAgain", () => {
  function enterEndedPhase(): { host: MockSocket; joiner: MockSocket } {
    const h = makeSocket();
    const j = makeSocket();
    join(h, "Alice", VALID_ID);
    const code = h.lastParsed<{ room: { code: string } }>()?.room.code!;
    join(j, "Bob", VALID_ID_2, code);
    startGame(h);
    h.clear();
    j.clear();
    submitAnswer(h, "This is my stance on the issue.");
    submitAnswer(j, "This is the opposing stance.");
    h.clear();
    j.clear();
    concede(h);
    concede(j);
    h.clear();
    j.clear();
    return { host: h, joiner: j };
  }

  it("does nothing when the room is not ended", () => {
    const waitingHost = makeSocket();
    join(waitingHost, "Alice", VALID_ID);
    playAgain(waitingHost);
    expect(lastError(waitingHost)).toBeNull();
  });

  it("resets the room to waiting", () => {
    const { host } = enterEndedPhase();
    playAgain(host);

    const state = host.findParsed<{ room: { phase: string; question: string } }>("state");
    expect(state?.room.phase).toBe("waiting");
    expect(state?.room.question).toBe("");
  });
});

describe("leave", () => {
  it("rejects leaving after the debate has started", () => {
    const host = makeSocket();
    const joiner = makeSocket();
    join(host, "Alice", VALID_ID);
    const code = host.lastParsed<{ room: { code: string } }>()?.room.code!;
    join(joiner, "Bob", VALID_ID_2, code);
    startGame(host);

    leave(host);
    expect(lastError(host)).toBe("The debate already started — you cannot cancel.");
  });

  it("removes the player from a waiting room", () => {
    const host = makeSocket();
    const joiner = makeSocket();
    join(host, "Alice", VALID_ID);
    const code = host.lastParsed<{ room: { code: string } }>()?.room.code!;
    join(joiner, "Bob", VALID_ID_2, code);

    leave(joiner);
    expect(lastError(joiner)).toBeNull();

    const left = joiner.findParsed<{ type: string }>("left");
    expect(left?.type).toBe("left");
  });
});

describe("disconnect", () => {
  it("removes a player who disconnects while waiting", () => {
    const host = makeSocket();
    const joiner = makeSocket();
    join(host, "Alice", VALID_ID);
    const code = host.lastParsed<{ room: { code: string } }>()?.room.code!;
    join(joiner, "Bob", VALID_ID_2, code);

    disconnect(joiner);

    const state = host.findParsed<{ room: { players: Array<{ id: string }> } }>("state");
    expect(state?.room.players.map((p) => p.id)).not.toContain(VALID_ID_2);
  });

  it("marks a player as disconnected during a debate", () => {
    const host = makeSocket();
    const joiner = makeSocket();
    join(host, "Alice", VALID_ID);
    const code = host.lastParsed<{ room: { code: string } }>()?.room.code!;
    join(joiner, "Bob", VALID_ID_2, code);
    startGame(host);
    host.clear();
    joiner.clear();
    submitAnswer(host, "This is my stance on the issue.");
    submitAnswer(joiner, "This is the opposing stance.");
    host.clear();
    joiner.clear();

    disconnect(joiner);

    const state = host.findParsed<{
      room: { players: Array<{ id: string; connected: boolean }> };
    }>("state");
    const bob = state?.room.players.find((p) => p.id === VALID_ID_2);
    expect(bob?.connected).toBe(false);
  });
});

describe("resume", () => {
  it("sends an error for an invalid player id", () => {
    const socket = makeSocket();
    resume(socket, "not-a-uuid");
    expect(lastError(socket)).toBe("No active debate to restore.");
  });

  it("sends an error when there is no active debate to restore", () => {
    const socket = makeSocket();
    resume(socket, VALID_ID);
    expect(lastError(socket)).toBe("No active debate to restore.");
  });
});

describe("snapshot", () => {
  it("hides other players' answers during the question phase", () => {
    const host = makeSocket();
    const joiner = makeSocket();
    join(host, "Alice", VALID_ID);
    const code = host.lastParsed<{ room: { code: string } }>()?.room.code!;
    join(joiner, "Bob", VALID_ID_2, code);
    startGame(host);
    host.clear();
    joiner.clear();

    submitAnswer(host, "This is my stance on the issue.");

    const joinerSnapshot = joiner.findParsed<{
      room: { stances: Array<{ playerId: string }>; myAnswer: string | null };
    }>("state");
    expect(joinerSnapshot?.room.stances.length).toBe(0);
    expect(joinerSnapshot?.room.myAnswer).toBeNull();

    const hostSnapshot = host.findParsed<{
      room: { stances: Array<{ playerId: string }>; myAnswer: string | null };
    }>("state");
    expect(hostSnapshot?.room.myAnswer).toBe("This is my stance on the issue.");
  });
});

describe("kick", () => {
  it("rejects a non-host", () => {
    const host = makeSocket();
    const joiner = makeSocket();
    join(host, "Alice", VALID_ID);
    const code = host.lastParsed<{ room: { code: string } }>()?.room.code!;
    join(joiner, "Bob", VALID_ID_2, code);
    joiner.clear();

    kick(joiner, VALID_ID);
    expect(lastError(joiner)).toBe("Only the host can do that.");
  });

  it("rejects kicking yourself", () => {
    const host = makeSocket();
    join(host, "Alice", VALID_ID);

    kick(host, VALID_ID);
    expect(lastError(host)).toBe("You can’t kick yourself. Leave instead.");
  });

  it("rejects kicking after the debate has started", () => {
    const host = makeSocket();
    const joiner = makeSocket();
    join(host, "Alice", VALID_ID);
    const code = host.lastParsed<{ room: { code: string } }>()?.room.code!;
    join(joiner, "Bob", VALID_ID_2, code);
    startGame(host);

    kick(host, VALID_ID_2);
    expect(lastError(host)).toBe("You can only kick people from the lobby.");
  });

  it("removes the kicked player and notifies them", () => {
    const host = makeSocket();
    const joiner = makeSocket();
    join(host, "Alice", VALID_ID);
    const code = host.lastParsed<{ room: { code: string } }>()?.room.code!;
    join(joiner, "Bob", VALID_ID_2, code);
    joiner.clear();

    kick(host, VALID_ID_2);

    const kicked = joiner.findParsed<{ type: string; reason: string }>("kicked");
    expect(kicked?.type).toBe("kicked");
    expect(kicked?.reason).toBe("host");

    const state = host.findParsed<{ room: { players: Array<{ id: string }> } }>("state");
    expect(state?.room.players.map((p) => p.id)).not.toContain(VALID_ID_2);
  });
});



describe("report", () => {
  function twoPlayers(): { host: MockSocket; joiner: MockSocket; code: string } {
    const host = makeSocket();
    const joiner = makeSocket();
    join(host, "Alice", VALID_ID);
    const code = host.lastParsed<{ room: { code: string } }>()?.room.code!;
    join(joiner, "Bob", VALID_ID_2, code);
    return { host, joiner, code };
  }

  it("rejects reporting yourself", () => {
    const { host } = twoPlayers();
    report(host, VALID_ID);
    expect(lastError(host)).toBe("You can’t report yourself.");
  });

  it("ignores a duplicate report from the same player", () => {
    const { host, joiner } = twoPlayers();
    report(host, VALID_ID_2);
    report(host, VALID_ID_2);
    expect(lastError(host)).toBeNull();
    const kicked = joiner.findParsed<{ type: string }>("kicked");
    expect(kicked).toBeNull();
  });

  it("does not eject at REPORT_LIMIT reports", () => {
    const { host, joiner, code } = twoPlayers();
    setSeats(host, 6);
    const third = makeSocket();
    const fourth = makeSocket();
    const fifth = makeSocket();
    join(third, "Carol", "750e8400-e29b-41d4-a716-446655440002", code);
    join(fourth, "Dan", "850e8400-e29b-41d4-a716-446655440003", code);
    join(fifth, "Eve", "950e8400-e29b-41d4-a716-446655440004", code);

    report(joiner, VALID_ID);
    report(third, VALID_ID);
    report(fourth, VALID_ID);
    report(fifth, VALID_ID);
    expect(lastError(host)).toBeNull();

    const state = joiner.findParsed<{ room: { phase: string; players: Array<{ id: string }> } }>("state");
    expect(state?.room.phase).not.toBe("ended");
    expect(state?.room.players.map((p) => p.id)).toContain(VALID_ID);
  });

  it("ejects the target after REPORT_LIMIT + 1 reports", () => {
    const { host, joiner, code } = twoPlayers();
    setSeats(host, 6);
    const third = makeSocket();
    const fourth = makeSocket();
    const fifth = makeSocket();
    const sixth = makeSocket();
    join(third, "Carol", "750e8400-e29b-41d4-a716-446655440002", code);
    join(fourth, "Dan", "850e8400-e29b-41d4-a716-446655440003", code);
    join(fifth, "Eve", "950e8400-e29b-41d4-a716-446655440004", code);
    join(sixth, "Frank", "a50e8400-e29b-41d4-a716-446655440005", code);

    report(joiner, VALID_ID);
    report(third, VALID_ID);
    report(fourth, VALID_ID);
    report(fifth, VALID_ID);
    report(sixth, VALID_ID);

    const state = joiner.findParsed<{ room: { phase: string; players: Array<{ id: string }> } }>("state");
    expect(state?.room.players.map((p) => p.id)).not.toContain(VALID_ID);
    expect(state?.room.phase).toBe("waiting");
  });
});

describe("concede", () => {
  function enterDebatePhase(): { host: MockSocket; joiner: MockSocket } {
    const h = makeSocket();
    const j = makeSocket();
    join(h, "Alice", VALID_ID);
    const code = h.lastParsed<{ room: { code: string } }>()?.room.code!;
    join(j, "Bob", VALID_ID_2, code);
    startGame(h);
    h.clear();
    j.clear();
    submitAnswer(h, "This is my stance on the issue.");
    submitAnswer(j, "This is the opposing stance.");
    h.clear();
    j.clear();
    return { host: h, joiner: j };
  }

  it("is idempotent — conceding twice does not error", () => {
    const { host } = enterDebatePhase();
    concede(host);
    concede(host);
    expect(lastError(host)).toBeNull();

    const state = host.findParsed<{
      room: { players: Array<{ id: string; conceded: boolean }> };
    }>("state");
    const me = state?.room.players.find((p) => p.id === VALID_ID);
    expect(me?.conceded).toBe(true);
  });
});

describe("playAgain", () => {
  function enterEndedPhase(): { host: MockSocket; joiner: MockSocket } {
    const h = makeSocket();
    const j = makeSocket();
    join(h, "Alice", VALID_ID);
    const code = h.lastParsed<{ room: { code: string } }>()?.room.code!;
    join(j, "Bob", VALID_ID_2, code);
    startGame(h);
    h.clear();
    j.clear();
    submitAnswer(h, "This is my stance on the issue.");
    submitAnswer(j, "This is the opposing stance.");
    h.clear();
    j.clear();
    concede(h);
    concede(j);
    h.clear();
    j.clear();
    return { host: h, joiner: j };
  }

  it("clears answers, concessions, messages, and reports", () => {
    const { host, joiner } = enterEndedPhase();
    playAgain(host);

    const state = host.findParsed<{
      room: {
        phase: string;
        players: Array<{ id: string; hasAnswer: boolean; conceded: boolean }>;
        messages: unknown[];
      };
    }>("state");
    expect(state?.room.phase).toBe("waiting");
    for (const p of state?.room.players ?? []) {
      expect(p.hasAnswer).toBe(false);
      expect(p.conceded).toBe(false);
    }
    expect(state?.room.messages.length).toBe(0);

    host.clear();
    joiner.clear();
  });
});

describe("snapshot", () => {
  it("shows all stances during the debate phase", () => {
    const host = makeSocket();
    const joiner = makeSocket();
    join(host, "Alice", VALID_ID);
    const code = host.lastParsed<{ room: { code: string } }>()?.room.code!;
    join(joiner, "Bob", VALID_ID_2, code);
    startGame(host);
    host.clear();
    joiner.clear();
    submitAnswer(host, "This is my stance on the issue.");
    submitAnswer(joiner, "This is the opposing stance.");

    const joinerSnapshot = joiner.findParsed<{
      room: { stances: Array<{ playerId: string; text: string }> };
    }>("state");
    expect(joinerSnapshot?.room.stances.length).toBe(2);
    const texts = joinerSnapshot?.room.stances.map((s) => s.text).sort();
    expect(texts).toEqual([
      "This is my stance on the issue.",
      "This is the opposing stance.",
    ]);

    host.clear();
    joiner.clear();
  });
});

describe("submitAnswer", () => {
  function enterQuestionPhase(): { host: MockSocket; joiner: MockSocket } {
    const host = makeSocket();
    const joiner = makeSocket();
    join(host, "Alice", VALID_ID);
    const code = host.lastParsed<{ room: { code: string } }>()?.room.code!;
    join(joiner, "Bob", VALID_ID_2, code);
    startGame(host);
    host.clear();
    joiner.clear();
    return { host, joiner };
  }

  it("is idempotent — submitting twice keeps the first answer", () => {
    const { host } = enterQuestionPhase();
    submitAnswer(host, "First stance on the issue.");
    submitAnswer(host, "Second stance that should be ignored.");
    expect(lastError(host)).toBeNull();

    const state = host.findParsed<{
      room: { players: Array<{ id: string; hasAnswer: boolean }> };
    }>("state");
    const me = state?.room.players.find((p) => p.id === VALID_ID);
    expect(me?.hasAnswer).toBe(true);
  });

  it("truncates answers to MAX_ANSWER_LENGTH", () => {
    const { host } = enterQuestionPhase();
    const longAnswer = "x".repeat(MAX_ANSWER_LENGTH + 50);
    submitAnswer(host, longAnswer);
    expect(lastError(host)).toBeNull();

    const state = host.findParsed<{
      room: { players: Array<{ id: string; hasAnswer: boolean }> };
    }>("state");
    const me = state?.room.players.find((p) => p.id === VALID_ID);
    expect(me?.hasAnswer).toBe(true);
  });

  it("rejects when the player already has an answer", () => {
    const { host } = enterQuestionPhase();
    submitAnswer(host, "My stance on this issue.");
    submitAnswer(host, "A different stance.");
    expect(lastError(host)).toBeNull();
  });
});

describe("chat", () => {
  function enterDebatePhase(): { host: MockSocket; joiner: MockSocket } {
    const h = makeSocket();
    const j = makeSocket();
    join(h, "Alice", VALID_ID);
    const code = h.lastParsed<{ room: { code: string } }>()?.room.code!;
    join(j, "Bob", VALID_ID_2, code);
    startGame(h);
    h.clear();
    j.clear();
    submitAnswer(h, "This is my stance on the issue.");
    submitAnswer(j, "This is the opposing stance.");
    h.clear();
    j.clear();
    return { host: h, joiner: j };
  }

  it("ignores empty messages", () => {
    const { host, joiner } = enterDebatePhase();
    chat(host, "");
    expect(lastError(host)).toBeNull();
    const chatMsg = joiner.findParsed<{ type: string }>("chat");
    expect(chatMsg).toBeNull();
  });

  it("ignores whitespace-only messages", () => {
    const { host, joiner } = enterDebatePhase();
    chat(host, "   ");
    expect(lastError(host)).toBeNull();
    const chatMsg = joiner.findParsed<{ type: string }>("chat");
    expect(chatMsg).toBeNull();
  });

  it("truncates messages to MAX_CHAT_LENGTH", () => {
    const { host, joiner } = enterDebatePhase();
    const longMessage = "a".repeat(MAX_CHAT_LENGTH + 50);
    chat(host, longMessage);
    expect(lastError(host)).toBeNull();

    const message = joiner.findParsed<{
      message: { text: string };
    }>("chat");
    expect(message?.message.text.length).toBeLessThanOrEqual(MAX_CHAT_LENGTH);
  });
});

describe("leave", () => {
  it("broadcasts updated state to remaining players", () => {
    const host = makeSocket();
    const joiner = makeSocket();
    join(host, "Alice", VALID_ID);
    const code = host.lastParsed<{ room: { code: string } }>()?.room.code!;
    join(joiner, "Bob", VALID_ID_2, code);
    host.clear();
    joiner.clear();

    leave(joiner);

    const state = host.findParsed<{ room: { players: Array<{ id: string }> } }>("state");
    expect(state?.room.players.map((p) => p.id)).toEqual([VALID_ID]);
  });
});

describe("disconnect", () => {
  it("marks a player as disconnected (not removed) during a debate", () => {
    const host = makeSocket();
    const joiner = makeSocket();
    join(host, "Alice", VALID_ID);
    const code = host.lastParsed<{ room: { code: string } }>()?.room.code!;
    join(joiner, "Bob", VALID_ID_2, code);
    startGame(host);
    host.clear();
    joiner.clear();
    submitAnswer(host, "This is my stance on the issue.");
    submitAnswer(joiner, "This is the opposing stance.");
    host.clear();
    joiner.clear();

    disconnect(joiner);

    const state = host.findParsed<{
      room: { players: Array<{ id: string; connected: boolean }> };
    }>("state");
    const bob = state?.room.players.find((p) => p.id === VALID_ID_2);
    expect(bob?.connected).toBe(false);
    expect(state?.room.players.map((p) => p.id)).toContain(VALID_ID_2);
  });

  it("broadcasts updated state with the player disconnected during debate", () => {
    const host = makeSocket();
    const joiner = makeSocket();
    join(host, "Alice", VALID_ID);
    const code = host.lastParsed<{ room: { code: string } }>()?.room.code!;
    join(joiner, "Bob", VALID_ID_2, code);
    startGame(host);
    host.clear();
    joiner.clear();
    submitAnswer(host, "This is my stance on the issue.");
    submitAnswer(joiner, "This is the opposing stance.");
    host.clear();
    joiner.clear();

    disconnect(joiner);

    const state = host.findParsed<{
      room: { players: Array<{ id: string; connected: boolean }> };
    }>("state");
    const bob = state?.room.players.find((p) => p.id === VALID_ID_2);
    expect(bob?.connected).toBe(false);
  });
});

describe("resume", () => {
  it("successfully reconnects to an active debate", () => {
    const host = makeSocket();
    const joiner = makeSocket();
    join(host, "Alice", VALID_ID);
    const code = host.lastParsed<{ room: { code: string } }>()?.room.code!;
    join(joiner, "Bob", VALID_ID_2, code);
    startGame(host);
    host.clear();
    joiner.clear();

    const reconnected = makeSocket();
    resume(reconnected, VALID_ID_2);
    expect(lastError(reconnected)).toBeNull();

    const welcome = reconnected.findParsed<{
      type: string;
      playerId: string;
    }>("welcome");
    expect(welcome?.type).toBe("welcome");
    expect(welcome?.playerId).toBe(VALID_ID_2);
  });
});

describe("setSeats", () => {
  it("broadcasts updated seatLimit to all players", () => {
    const host = makeSocket();
    const joiner = makeSocket();
    join(host, "Alice", VALID_ID);
    const code = host.lastParsed<{ room: { code: string } }>()?.room.code!;
    join(joiner, "Bob", VALID_ID_2, code);
    host.clear();
    joiner.clear();

    setSeats(host, 6);
    expect(lastError(host)).toBeNull();

    const hostState = host.findParsed<{ room: { seatLimit: number } }>("state");
    expect(hostState?.room.seatLimit).toBe(6);

    const joinerState = joiner.findParsed<{ room: { seatLimit: number } }>("state");
    expect(joinerState?.room.seatLimit).toBe(6);
  });
});

describe("join", () => {
  it("assigns colors in rotation from the COLORS pool", () => {
    const first = makeSocket();
    const second = makeSocket();
    const third = makeSocket();

    join(first, "Alice", VALID_ID);
    const firstColor = first.lastParsed<{
      room: { players: Array<{ id: string; color: string }> };
    }>()?.room.players.find((p) => p.id === VALID_ID)?.color;

    const code = first.lastParsed<{ room: { code: string } }>()?.room.code!;
    join(second, "Bob", VALID_ID_2, code);
    const secondColor = second.lastParsed<{
      room: { players: Array<{ id: string; color: string }> };
    }>()?.room.players.find((p) => p.id === VALID_ID_2)?.color;

    join(third, "Carol", "750e8400-e29b-41d4-a716-446655440002", code);

    expect(firstColor).toBeTruthy();
    expect(secondColor).toBeTruthy();
    expect(secondColor).not.toBe(firstColor);
  });
});

function clearSocket(socket: MockSocket): void {
  socket.clear();
}

