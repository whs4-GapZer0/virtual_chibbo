import { NextResponse } from "next/server";
import { noStoreHeaders } from "@chibbo/auth";
import { listAdminCompanies, resolveStaffSession } from "../../../lib/runtime";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { try { const token = request.headers.get("cookie")?.match(/(?:^|; )chibbo_session=([^;]+)/)?.[1]; return NextResponse.json(await listAdminCompanies(await resolveStaffSession(token && decodeURIComponent(token))), { headers: noStoreHeaders() }); } catch { return NextResponse.json({ error: "not found" }, { status: 404, headers: noStoreHeaders() }); } }
