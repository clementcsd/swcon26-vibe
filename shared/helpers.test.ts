import { describe, it, expect } from "vitest";
import { pickQuestion } from "../server/questions";
import { sanitizeNickPublic, validPlayerIdPublic } from "../server/rooms";

describe("pickQuestion", () => {
  it("returns a question from the pool", () => {
    const q = pickQuestion();
    expect(typeof q).toBe("string");
    expect(q.length).toBeGreaterThan(0);
  });

  it("never returns the excluded question", () => {
    const excluded = pickQuestion();
    const other = pickQuestion(excluded);
    expect(other).not.toBe(excluded);
  });
});

describe("sanitizeNickPublic", () => {
  it("trims and collapses whitespace", () => {
    expect(sanitizeNickPublic("  hello   world  ")).toBe("hello world");
  });

  it("truncates to max length", () => {
    expect(sanitizeNickPublic("a".repeat(50))).toBe("a".repeat(16));
  });
});

describe("validPlayerIdPublic", () => {
  it("accepts a valid uuid", () => {
    expect(validPlayerIdPublic("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
  });
});