import { createHash, randomBytes } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
export type StaffPrincipal = { tenantId: string; objectId: string; companyId?: string; role: "company-manager" | "platform-admin"; membershipVersion: number };
export function requireCompanyPrincipal(principal: StaffPrincipal, companyId: string): void { if (principal.role !== "company-manager" || principal.companyId !== companyId) { const error = new Error("not found"); (error as Error & { status: number }).status = 404; throw error; } }
export function noStoreHeaders(): HeadersInit { return { "Cache-Control": "private, no-store", "Vary": "Cookie" }; }
export type VerifiedOidcClaims = { tid: string; oid: string; iss: string; aud: string; nonce?: string };
export type OidcConfig = { tenantId: string; clientId: string; clientSecret: string; origin: string };
export function createOidcValue(): string { return randomBytes(32).toString("base64url"); }
export function pkceChallenge(verifier: string): string { return createHash("sha256").update(verifier).digest("base64url"); }
export function oidcIssuer(tenantId: string): string { return `https://login.microsoftonline.com/${tenantId}/v2.0`; }
export function requireSameOrigin(requestOrigin: string | null, expectedOrigin: string): void { if (!requestOrigin || requestOrigin !== expectedOrigin) throw Object.assign(new Error("invalid origin"), { status: 403 }); }
export function validateOidcClaims(claims: VerifiedOidcClaims, expected: { tenantId: string; clientId: string; issuer: string; nonce: string }): Pick<VerifiedOidcClaims, "tid" | "oid"> { if (claims.tid !== expected.tenantId || claims.aud !== expected.clientId || claims.iss !== expected.issuer || claims.nonce !== expected.nonce || !/^[0-9a-f-]{36}$/i.test(claims.oid)) throw new Error("invalid OIDC identity"); return { tid: claims.tid, oid: claims.oid }; }
export async function exchangeAndVerifyAuthorizationCode(config: OidcConfig, input: { code: string; verifier: string; nonce: string }): Promise<Pick<VerifiedOidcClaims, "tid" | "oid">> {
  const issuer = oidcIssuer(config.tenantId);
  const tokenResponse = await fetch(`${issuer}/oauth2/v2.0/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, grant_type: "authorization_code", code: input.code, redirect_uri: `${config.origin}/api/auth/callback`, code_verifier: input.verifier }) });
  if (!tokenResponse.ok) throw new Error("OIDC code exchange failed");
  const body = await tokenResponse.json() as { id_token?: string };
  if (!body.id_token) throw new Error("OIDC response did not contain an ID token");
  const jwks = createRemoteJWKSet(new URL(`${issuer}/discovery/v2.0/keys`));
  const verified = await jwtVerify(body.id_token, jwks, { issuer, audience: config.clientId, algorithms: ["RS256"] });
  return validateOidcClaims({ tid: String(verified.payload.tid ?? ""), oid: String(verified.payload.oid ?? ""), iss: String(verified.payload.iss ?? ""), aud: Array.isArray(verified.payload.aud) ? String(verified.payload.aud[0] ?? "") : String(verified.payload.aud ?? ""), nonce: typeof verified.payload.nonce === "string" ? verified.payload.nonce : undefined }, { tenantId: config.tenantId, clientId: config.clientId, issuer, nonce: input.nonce });
}
export type Membership = StaffPrincipal & { active: boolean };
export function principalFromMembership(membership: Membership | undefined): StaffPrincipal { if (!membership?.active) { const error = new Error("not found"); (error as Error & { status: number }).status = 404; throw error; } return { tenantId: membership.tenantId, objectId: membership.objectId, companyId: membership.companyId, role: membership.role, membershipVersion: membership.membershipVersion }; }
export function createOpaqueSessionToken(): string { return randomBytes(32).toString("base64url"); }
export function hashSessionToken(token: string): string { return createHash("sha256").update(token).digest("hex"); }
