import { describe, it, expect } from "vitest";
import { censorText } from "./censor";

describe("censorText", () => {
  it("censors forbidden words", () => {
    const result = censorText("what the fuck is going on");
    expect(result.text).toBe("what the **** is going on");
    expect(result.hit).toBe(true);
  });

  it("reports no hit for clean text", () => {
    const result = censorText("hello world");
    expect(result.text).toBe("hello world");
    expect(result.hit).toBe(false);
  });
});