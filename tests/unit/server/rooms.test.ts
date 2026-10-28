import { describe, it, expect } from "vitest";
import { sanitizeNickPublic, validPlayerIdPublic } from "../../../server/rooms";

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