import { NextResponse } from "next/server";
import { noStoreHeaders, requireSameOrigin } from "@chibbo/auth";
import { loadConfig } from "@chibbo/config";
import { z } from "zod";
import { listAdminMemberships, manageMembership, resolveStaffSession } from "../../../../../lib/runtime";
export const dynamic = "force-dynamic";
export async function GET(request: Request, { params }: { params: Promise<{ companyId: string }> }) { try { const token = request.headers.get("cookie")?.match(/(?:^|; )chibbo_session=([^;]+)/)?.[1]; return NextResponse.json(await listAdminMemberships(await resolveStaffSession(token && decodeURIComponent(token)), (await params).companyId), { headers: noStoreHeaders() }); } catch { return NextResponse.json({ error: "not found" }, { status: 404, headers: noStoreHeaders() }); } }
const MembershipInput = z.object({ tenantId: z.string().uuid(), objectId: z.string().uuid(), role: z.enum(["company-manager", "platform-admin"]), active: z.boolean() });
export async function PUT(request: Request, { params }: { params: Promise<{ companyId: string }> }) { try { requireSameOrigin(request.headers.get("origin"), loadConfig().NEXT_PUBLIC_APP_ORIGIN); const token = request.headers.get("cookie")?.match(/(?:^|; )chibbo_session=([^;]+)/)?.[1]; const input = MembershipInput.parse(await request.json()); return NextResponse.json(await manageMembership(await resolveStaffSession(token && decodeURIComponent(token)), { companyId: (await params).companyId, ...input }), { headers: noStoreHeaders() }); } catch (error) { const status = (error as Error & { status?: number }).status; return NextResponse.json({ error: "not found" }, { status: status === 403 ? 403 : 404, headers: noStoreHeaders() }); } }
