import { describe, expect, it } from "vitest";
import { companyHue, daysLeft, deadlineLabel } from "./format";

describe("deadline formatting", () => {
  const now = new Date("2026-10-05T13:00:00Z"); // 22:00 KST on Oct 5
  it("counts calendar days in Korea time", () => {
    expect(daysLeft("2026-10-05T14:59:00Z", now)).toBe(0); // 23:59 KST same day
    expect(daysLeft("2026-10-05T15:30:00Z", now)).toBe(1); // 00:30 KST next day
    expect(daysLeft(null, now)).toBeNull();
  });
  it("marks deadlines within a week as soon", () => {
    expect(deadlineLabel("2026-10-12T05:00:00Z", now)).toEqual({ text: "D-7", soon: true });
    expect(deadlineLabel("2026-10-13T05:00:00Z", now)).toEqual({ text: "D-8", soon: false });
    expect(deadlineLabel("2026-10-05T14:00:00Z", now)).toEqual({ text: "오늘 마감", soon: true });
    expect(deadlineLabel(null, now)).toEqual({ text: "상시채용", soon: false });
  });
  it("derives a stable hue from the company slug", () => {
    expect(companyHue("alpha-works")).toBe(companyHue("alpha-works"));
    expect(companyHue("alpha-works")).toBeGreaterThanOrEqual(0);
    expect(companyHue("alpha-works")).toBeLessThan(360);
  });
});
