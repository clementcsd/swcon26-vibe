import { describe, it, expect } from "vitest";
import * as protocol from "../../../shared/protocol";

describe("protocol constants", () => {
  it("question phase is 5 minutes", () => {
    expect(protocol.QUESTION_MS).toBe(5 * 60 * 1000);
  });

  it("debate phase is 15 minutes", () => {
    expect(protocol.DEBATE_MS).toBe(15 * 60 * 1000);
  });

  it("reconnect grace is 8 seconds", () => {
    expect(protocol.RECONNECT_MS).toBe(8 * 1000);
  });

  it("requires at least 2 players", () => {
    expect(protocol.MIN_PLAYERS).toBe(2);
  });

  it("caps at 10 players", () => {
    expect(protocol.MAX_PLAYERS).toBe(10);
  });

  it("default lobby size is 4", () => {
    expect(protocol.DEFAULT_SEATS).toBe(4);
  });

  it("max answer length is 600", () => {
    expect(protocol.MAX_ANSWER_LENGTH).toBe(600);
  });

  it("max chat length is 280", () => {
    expect(protocol.MAX_CHAT_LENGTH).toBe(280);
  });

  it("nickname limit is 16", () => {
    expect(protocol.MAX_NICKNAME_LENGTH).toBe(16);
  });

  it("report threshold is 4", () => {
    expect(protocol.REPORT_LIMIT).toBe(4);
  });
});
