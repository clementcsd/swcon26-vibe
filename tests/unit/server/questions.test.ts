import { describe, it, expect } from "vitest";
import { pickQuestion } from "../../../server/questions";

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
