import { NextResponse } from "next/server";
import { noStoreHeaders } from "@chibbo/auth";
import { getStaffApplication, resolveStaffSession } from "../../../../lib/runtime";
export const dynamic = "force-dynamic";
export async function GET(request: Request, { params }: { params: Promise<{ applicationId: string }> }) { try { const token = request.headers.get("cookie")?.match(/(?:^|; )chibbo_session=([^;]+)/)?.[1]; const result = await getStaffApplication(await resolveStaffSession(token && decodeURIComponent(token)), (await params).applicationId); return NextResponse.json(result, { headers: noStoreHeaders() }); } catch { return NextResponse.json({ error: "not found" }, { status: 404, headers: noStoreHeaders() }); } }
