import { describe, expect, it, vi } from "vitest";
import {
  MockWebSocket,
  createMockSocket,
  WebSocketStates,
} from "../../support/mockSocket";
import { makePlayer, makeRoom } from "../../support/helpers";

// ---------------------------------------------------------------------------
// Integration spec backlog — rooms.ts in-process, mocked WebSocket + timers.
//
// These suites are intentionally skipped until the rooms module is refactored
// to expose testable seams (e.g. an in-process `createRoom`/`applyMessage`
// surface that doesn't require a bound port). Each `describe.skip` block is an
// executable requirement awaiting implementation.
// ---------------------------------------------------------------------------

describe.skip("rooms.join", () => {
  it("assigns a color, marks the host, and broadcasts state to the joiner", () => {
    // Arrange: empty room, mock socket
    // Act: apply join message
    // Assert: player appears in snapshot, hostId set when first, state sent
    expect(true).toBe(true);
  });

  it("rejects a nickname that is empty or too long", () => {
    expect(true).toBe(true);
  });

  it("caps enrollment at seatLimit and rejects further joins", () => {
    expect(true).toBe(true);
  });

  it("reuses a reconnecting player's existing seat instead of adding a duplicate", () => {
    expect(true).toBe(true);
  });
});

describe.skip("rooms.gameFlow", () => {
  it("host start transitions waiting -> question and picks a non-repeated question", () => {
    expect(true).toBe(true);
  });

  it("question timer expiry advances question -> debate", () => {
    vi.useFakeTimers();
    expect(true).toBe(true);
    vi.useRealTimers();
  });

  it("debate timer expiry advances debate -> ended", () => {
    expect(true).toBe(true);
  });

  it("submitting an answer reveals only the viewer's stance during question phase", () => {
    expect(true).toBe(true);
  });
});

describe.skip("rooms.moderation", () => {
  it("host kick removes the player and notifies them with reason host", () => {
    expect(true).toBe(true);
  });

  it("reports beyond REPORT_LIMIT auto-kick the reported player", () => {
    expect(true).toBe(true);
  });

  it("disconnect during waiting removes the player; during debate starts the reconnect grace", () => {
    expect(true).toBe(true);
  });

  it("reconnect grace expiry forfeits the player and ends the room if below MIN_PLAYERS", () => {
    expect(true).toBe(true);
  });
});

describe.skip("MockWebSocket contract", () => {
  it("records sent messages and reports readyState", () => {
    const socket = createMockSocket();
    socket.send('{"type":"welcome"}');
    expect(socket.readyState).toBe(WebSocketStates.OPEN);
    expect(socket.lastSent).toBe('{"type":"welcome"}');
    socket.close();
    expect(socket.readyState).toBe(WebSocketStates.CLOSED);
  });
});
