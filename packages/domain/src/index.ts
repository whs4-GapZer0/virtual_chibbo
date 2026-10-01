import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const APPLICATION_STATUSES = ["draft_upload", "submitted", "reviewing", "accepted", "rejected"] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];
const transitions: Record<ApplicationStatus, readonly ApplicationStatus[]> = { draft_upload: ["submitted"], submitted: ["reviewing"], reviewing: ["accepted", "rejected"], accepted: [], rejected: [] };
export function assertTransition(from: ApplicationStatus, to: ApplicationStatus): void { if (!transitions[from].includes(to)) throw new Error(`invalid application transition: ${from} -> ${to}`); }
export function generateDeletionSecret(): string { return randomBytes(32).toString("base64url"); }
export function hashDeletionSecret(secret: string, pepper: string): string { return createHmac("sha256", pepper).update(secret).digest("hex"); }
export function matchesDeletionSecret(secret: string, expectedHex: string, pepper: string): boolean { const actual = Buffer.from(hashDeletionSecret(secret, pepper), "hex"); const expected = Buffer.from(expectedHex, "hex"); return actual.length === expected.length && timingSafeEqual(actual, expected); }
export function opaqueObjectKey(intentId: string): string { if (!/^[0-9a-f-]{36}$/i.test(intentId)) throw new Error("invalid upload intent id"); return `quarantine/${intentId}`; }
export type DraftCapability = { intentId: string; companyId: string; expiresAt: number };
export function signDraftCapability(capability: DraftCapability, secret: string): string { const payload = Buffer.from(JSON.stringify(capability)).toString("base64url"); const signature = createHmac("sha256", secret).update(payload).digest("base64url"); return `${payload}.${signature}`; }
export function verifyDraftCapability(token: string, secret: string, now = Date.now()): DraftCapability { const [payload, signature, ...extra] = token.split("."); if (!payload || !signature || extra.length) throw new Error("invalid draft capability"); const expected = createHmac("sha256", secret).update(payload).digest("base64url"); if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw new Error("invalid draft capability"); const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as DraftCapability; if (!/^[0-9a-f-]{36}$/i.test(parsed.intentId) || !/^[0-9a-f-]{36}$/i.test(parsed.companyId) || !Number.isInteger(parsed.expiresAt) || parsed.expiresAt < now) throw new Error("expired draft capability"); return parsed; }
