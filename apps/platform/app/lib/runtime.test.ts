import { describe, expect, it } from "vitest";
import { noStoreHeaders, requireSameOrigin } from "@chibbo/auth";
describe("staff API safety contracts", () => {
  it("requires exact origin for cookie-authenticated writes", () => { expect(() => requireSameOrigin("https://wrong.example", "https://chibbo.example")).toThrow(); expect(() => requireSameOrigin(null, "https://chibbo.example")).toThrow(); expect(() => requireSameOrigin("https://chibbo.example", "https://chibbo.example")).not.toThrow(); });
  it("marks staff responses as private no-store", () => expect(noStoreHeaders()).toMatchObject({ "Cache-Control": "private, no-store", Vary: "Cookie" }));
});
