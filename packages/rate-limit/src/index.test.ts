import { describe, expect, it } from "vitest";
import { anonymousKey, decideWindow } from "./index.js";
describe("sliding-window helpers", () => {
  it("does not retain a raw IP and calculates retry time", () => { const now = 1_000_000; expect(anonymousKey("203.0.113.1", "secret")).not.toContain("203.0.113.1"); expect(decideWindow([now - 1], now, 1000, 1)).toEqual({ allowed: false, retryAfterSeconds: 1 }); });
});
