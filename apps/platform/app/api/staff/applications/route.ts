import { NextResponse } from "next/server";
import { noStoreHeaders } from "@chibbo/auth";
import { listStaffApplications, resolveStaffSession } from "../../../lib/runtime";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { try { const token = request.headers.get("cookie")?.match(/(?:^|; )chibbo_session=([^;]+)/)?.[1]; const result = await listStaffApplications(await resolveStaffSession(token && decodeURIComponent(token))); return NextResponse.json(result.rows, { headers: noStoreHeaders() }); } catch { return NextResponse.json({ error: "not found" }, { status: 404, headers: noStoreHeaders() }); } }
