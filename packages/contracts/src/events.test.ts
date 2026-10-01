import { describe, expect, it } from "vitest";
import { EVENT_SOURCE_POLICY, EventScope } from "./index.js";
describe("event ownership", () => {
  it("maps every source to exactly one allowed primary scope", () => {
    for (const policy of Object.values(EVENT_SOURCE_POLICY)) expect(EventScope.parse(policy.scope)).toBe(policy.scope);
  });
  it("keeps CloudTrail and flow logs on different instances", () => {
    expect(EVENT_SOURCE_POLICY["resume-s3-cloudtrail"].scope).toBe("recruitment-platform");
    expect(EVENT_SOURCE_POLICY["vpc-flow-logs"].scope).toBe("asset-management");
  });
});
