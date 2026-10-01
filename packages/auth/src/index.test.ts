import { describe, expect, it } from "vitest";
import { createOidcValue, oidcIssuer, pkceChallenge, validateOidcClaims } from "./index.js";
describe("OIDC boundary helpers", () => {
  it("binds token claims to issuer, audience, tenant and nonce", () => {
    const tenant = "00000000-0000-4000-8000-000000000001"; const client = "00000000-0000-4000-8000-000000000002"; const nonce = createOidcValue();
    expect(validateOidcClaims({ tid: tenant, oid: "00000000-0000-4000-8000-000000000003", iss: oidcIssuer(tenant), aud: client, nonce }, { tenantId: tenant, clientId: client, issuer: oidcIssuer(tenant), nonce })).toEqual({ tid: tenant, oid: "00000000-0000-4000-8000-000000000003" });
    expect(() => validateOidcClaims({ tid: tenant, oid: "00000000-0000-4000-8000-000000000003", iss: oidcIssuer(tenant), aud: client, nonce: "wrong" }, { tenantId: tenant, clientId: client, issuer: oidcIssuer(tenant), nonce })).toThrow();
    expect(pkceChallenge("verifier")).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
