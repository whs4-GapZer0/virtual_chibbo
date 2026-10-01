import { NextResponse, type NextRequest } from "next/server";
export function proxy(request: NextRequest) { if (request.nextUrl.pathname.startsWith("/staff") || request.nextUrl.pathname.startsWith("/admin")) { return NextResponse.next({ headers: { "Cache-Control": "private, no-store" } }); } return NextResponse.next(); }
