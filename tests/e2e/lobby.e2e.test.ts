import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// End-to-end spec backlog — full stack over a real WebSocket.
//
// These suites require a running server (`npm start`) and are intentionally
// skipped until a browser/WS harness is wired up. Each block is a requirement
// awaiting implementation.
// ---------------------------------------------------------------------------

describe.skip("lobby flow", () => {
  it("two clients connect, host creates a room, second client joins by code", () => {
    expect(true).toBe(true);
  });

  it("host starts the game; both clients receive the question and a timer", () => {
    expect(true).toBe(true);
  });

  it("both players submit answers; debate phase reveals all stances", () => {
    expect(true).toBe(true);
  });

  it("chat messages flow during debate and are censored when they contain forbidden words", () => {
    expect(true).toBe(true);
  });

  it("a disconnected player can resume within the reconnect grace period", () => {
    expect(true).toBe(true);
  });

  it("play again resets the room to waiting for connected players", () => {
    expect(true).toBe(true);
  });
});
