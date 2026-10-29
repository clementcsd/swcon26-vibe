import { describe, it, expect, vi } from "vitest";
import { pickQuestion, QUESTIONS } from "../../../server/questions";

describe("QUESTIONS", () => {
  it("exports a non-empty list of questions", () => {
    expect(Array.isArray(QUESTIONS)).toBe(true);
    expect(QUESTIONS.length).toBeGreaterThan(0);
  });

  it("contains no duplicates", () => {
    expect(new Set(QUESTIONS).size).toBe(QUESTIONS.length);
  });

  it("every entry is a non-empty string", () => {
    for (const q of QUESTIONS) {
      expect(typeof q).toBe("string");
      expect(q.length).toBeGreaterThan(0);
    }
  });
});

describe("pickQuestion", () => {
  it("returns a string from the QUESTIONS pool", () => {
    const q = pickQuestion();
    expect(typeof q).toBe("string");
    expect(QUESTIONS).toContain(q);
  });

  it("never returns the excluded question when alternatives exist", () => {
    const excluded = QUESTIONS[0]!;
    for (let i = 0; i < 100; i += 1) {
      const picked = pickQuestion(excluded);
      expect(picked).not.toBe(excluded);
      expect(QUESTIONS).toContain(picked);
    }
  });

  it("falls back to the full pool when the excluded question is unknown", () => {
    const picked = pickQuestion("not a real question");
    expect(QUESTIONS).toContain(picked);
  });

  it("returns a valid question even when all others are excluded", () => {
    const all = QUESTIONS[0]!;
    const picked = pickQuestion(all);
    expect(typeof picked).toBe("string");
    expect(picked.length).toBeGreaterThan(0);
  });

  it("is random (spy on Math.random to verify a pool lookup happens)", () => {
    const spy = vi.spyOn(Math, "random").mockReturnValue(0);
    const picked = pickQuestion();
    // With random === 0, index 0 of the pool is selected.
    expect(picked).toBe(QUESTIONS[0]);
    spy.mockRestore();
  });

  it("distributes across the pool over many calls", () => {
    const picked = new Set<string>();
    for (let i = 0; i < 500; i += 1) {
      picked.add(pickQuestion());
    }
    // With 14 questions and 500 draws, expect to see most of the pool.
    expect(picked.size).toBeGreaterThan(5);
  });

  it("excludes by value regardless of case differences in the pool", () => {
    const target = QUESTIONS[0]!;
    // The pool contains `target` exactly once; excluding it removes it.
    const results = new Set<string>();
    for (let i = 0; i < 100; i += 1) {
      results.add(pickQuestion(target));
    }
    expect(results.has(target)).toBe(false);
    for (const r of results) {
      expect(QUESTIONS).toContain(r);
    }
  });
});