import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import type { ClientMessage, RoomState, ServerMessage } from "../../shared/protocol";

// ---------------------------------------------------------------------------
// End-to-end tests — full stack over a real WebSocket against a running server
// (see tests/support/e2eGlobalSetup.ts).
// ---------------------------------------------------------------------------

const URL = `ws://localhost:${Number(process.env.E2E_PORT ?? 3001)}/ws`;

/** A real WebSocket client that records every server message. */
class Client {
  readonly playerId: string;
  readonly messages: ServerMessage[] = [];
  private socket!: WebSocket;
  private waiters: Array<() => void> = [];

  private constructor(playerId: string) {
    this.playerId = playerId;
  }

  static async connect(playerId: string = randomUUID()): Promise<Client> {
    const client = new Client(playerId);
    await client.open();
    return client;
  }

  private open(): Promise<void> {
    this.socket = new WebSocket(URL);
    this.socket.on("message", (raw) => {
      this.messages.push(JSON.parse(String(raw)) as ServerMessage);
      for (const wake of this.waiters.splice(0)) wake();
    });
    return new Promise((resolve, reject) => {
      this.socket.once("open", () => resolve());
      this.socket.once("error", reject);
    });
  }

  send(message: ClientMessage): void {
    this.socket.send(JSON.stringify(message));
  }

  /** Resolves with the first message (received from now on) matching `match`. */
  next<T extends ServerMessage>(match: (m: ServerMessage) => m is T, timeout?: number): Promise<T>;
  next(match: (m: ServerMessage) => boolean, timeout?: number): Promise<ServerMessage>;
  next(match: (m: ServerMessage) => boolean, timeout = 5_000): Promise<ServerMessage> {
    const start = this.messages.length;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timed out waiting for message")), timeout);
      const check = () => {
        const hit = this.messages.slice(start).find(match);
        if (hit) {
          clearTimeout(timer);
          resolve(hit);
        } else {
          this.waiters.push(check);
        }
      };
      check();
    });
  }

  /** Waits for a state broadcast whose room satisfies `match`. */
  async state(match: (room: RoomState) => boolean): Promise<RoomState> {
    const msg = await this.next((m) => m.type === "state" && match(m.room));
    return (msg as Extract<ServerMessage, { type: "state" }>).room;
  }

  close(): Promise<void> {
    if (this.socket.readyState === WebSocket.CLOSED) return Promise.resolve();
    return new Promise((resolve) => {
      this.socket.once("close", () => resolve());
      this.socket.close();
    });
  }
}

const open: Client[] = [];

async function client(playerId?: string): Promise<Client> {
  const c = await Client.connect(playerId);
  open.push(c);
  return c;
}

afterEach(async () => {
  await Promise.all(open.splice(0).map((c) => c.close()));
});

type Welcome = Extract<ServerMessage, { type: "welcome" }>;
const isWelcome = (m: ServerMessage): m is Welcome => m.type === "welcome";

/** Host creates a room and a guest joins it by code. */
async function lobby(): Promise<{ host: Client; guest: Client; code: string }> {
  const host = await client();
  const hostWelcome = host.next(isWelcome);
  host.send({ type: "join", nickname: "Alice", playerId: host.playerId });
  const code = (await hostWelcome).room.code;

  const guest = await client();
  const guestWelcome = guest.next(isWelcome);
  const hostSeesGuest = host.state((r) => r.players.length === 2);
  guest.send({ type: "join", nickname: "Bob", playerId: guest.playerId, roomCode: code });
  await Promise.all([guestWelcome, hostSeesGuest]);
  return { host, guest, code };
}

async function startQuestion(host: Client, guest: Client): Promise<void> {
  const ready = Promise.all([host, guest].map((c) => c.state((r) => r.phase === "question")));
  host.send({ type: "start" });
  await ready;
}

async function startDebate(host: Client, guest: Client): Promise<void> {
  await startQuestion(host, guest);
  const ready = Promise.all([host, guest].map((c) => c.state((r) => r.phase === "debate")));
  host.send({ type: "submit_answer", text: "Homework builds discipline." });
  guest.send({ type: "submit_answer", text: "Homework steals family time." });
  await ready;
}

describe("lobby flow", () => {
  it("two clients connect, host creates a room, second client joins by code", async () => {
    const { host, guest, code } = await lobby();

    expect(code).toMatch(/^[A-Z2-9]{4}$/);
    const guestWelcome = guest.messages.find(isWelcome)!;
    expect(guestWelcome.playerId).toBe(guest.playerId);
    expect(guestWelcome.room.code).toBe(code);
    expect(guestWelcome.room.hostId).toBe(host.playerId);
    expect(guestWelcome.room.phase).toBe("waiting");
    expect(guestWelcome.room.players.map((p) => p.nickname)).toEqual(["Alice", "Bob"]);
  });

  it("host starts the game; both clients receive the question and a timer", async () => {
    const { host, guest } = await lobby();
    const before = Date.now();
    const states = Promise.all([host, guest].map((c) => c.state((r) => r.phase === "question")));
    host.send({ type: "start" });
    const [hostRoom, guestRoom] = await states;

    expect(hostRoom!.question.length).toBeGreaterThan(0);
    expect(guestRoom!.question).toBe(hostRoom!.question);
    // 5-minute answer phase, give or take clock skew between processes.
    expect(guestRoom!.phaseEndsAt! - before).toBeGreaterThan(4 * 60 * 1000);
    expect(guestRoom!.phaseEndsAt! - before).toBeLessThanOrEqual(5 * 60 * 1000 + 2_000);
  });

  it("both players submit answers; debate phase reveals all stances", async () => {
    const { host, guest } = await lobby();
    await startQuestion(host, guest);

    host.send({ type: "submit_answer", text: "Homework builds discipline." });
    const hostOnly = await host.state((r) => r.myAnswer !== null);
    expect(hostOnly.phase).toBe("question");
    expect(hostOnly.stances.map((s) => s.playerId)).toEqual([host.playerId]);

    const debate = guest.state((r) => r.phase === "debate");
    guest.send({ type: "submit_answer", text: "Homework steals family time." });
    const room = await debate;
    expect(room.stances.map((s) => s.text).sort()).toEqual([
      "Homework builds discipline.",
      "Homework steals family time.",
    ]);
  });

  it("chat messages flow during debate and are censored when they contain forbidden words", async () => {
    const { host, guest } = await lobby();
    await startDebate(host, guest);

    const clean = guest.next((m) => m.type === "chat");
    host.send({ type: "chat", text: "Hello Bob" });
    const received = (await clean) as Extract<ServerMessage, { type: "chat" }>;
    expect(received.message.text).toBe("Hello Bob");
    expect(received.message.playerId).toBe(host.playerId);

    const censored = guest.next((m) => m.type === "chat");
    const warning = host.next((m) => m.type === "censored");
    host.send({ type: "chat", text: "this is shit" });
    expect(((await censored) as Extract<ServerMessage, { type: "chat" }>).message.text).toBe("this is ****");
    expect(((await warning) as Extract<ServerMessage, { type: "censored" }>).warning).toContain(
      "forbidden words",
    );
    expect(guest.messages.some((m) => m.type === "censored")).toBe(false);
  });

  it("a disconnected player can resume within the reconnect grace period", async () => {
    const { host, guest } = await lobby();
    await startDebate(host, guest);

    const dropped = host.state((r) => r.players.some((p) => p.id === guest.playerId && !p.connected));
    await guest.close();
    await dropped;

    const back = await client(guest.playerId);
    const welcome = back.next(isWelcome);
    const restored = host.state((r) => r.players.every((p) => p.connected));
    back.send({ type: "resume", playerId: guest.playerId });

    const room = (await welcome).room;
    expect(room.phase).toBe("debate");
    expect(room.stances).toHaveLength(2);
    await restored;
    expect(host.messages.some((m) => m.type === "opponent_left")).toBe(false);
  });

  it("play again resets the room to waiting for connected players", async () => {
    const { host, guest, code } = await lobby();
    await startDebate(host, guest);

    const ended = Promise.all([host, guest].map((c) => c.state((r) => r.phase === "ended")));
    host.send({ type: "concede" });
    guest.send({ type: "concede" });
    const [endedRoom] = await ended;
    expect(endedRoom!.consensus).toBe(true);

    const waiting = guest.state((r) => r.phase === "waiting");
    host.send({ type: "play_again" });
    const room = await waiting;
    expect(room.code).toBe(code);
    expect(room.question).toBe("");
    expect(room.stances).toEqual([]);
    expect(room.messages).toEqual([]);
    expect(room.players.map((p) => p.id)).toEqual([host.playerId, guest.playerId]);
    expect(room.players.every((p) => !p.hasAnswer && !p.conceded)).toBe(true);
  });
});
