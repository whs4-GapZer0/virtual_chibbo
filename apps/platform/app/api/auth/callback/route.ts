import { NextResponse } from "next/server";
import { exchangeAndVerifyAuthorizationCode, noStoreHeaders } from "@chibbo/auth";
import { loadConfig } from "@chibbo/config";
import { createStaffSession } from "../../../lib/runtime";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const config = loadConfig(); const url = new URL(request.url); const cookies = request.headers.get("cookie") ?? "";
  const getCookie = (name: string) => cookies.match(new RegExp(`(?:^|; )${name}=([^;]+)`))?.[1];
  const clear = (response: NextResponse) => { for (const name of ["chibbo_oidc_state", "chibbo_oidc_verifier", "chibbo_oidc_nonce"]) response.cookies.delete(name); return response; };
  try {
    if (!config.ENTRA_TENANT_ID || !config.ENTRA_CLIENT_ID || !config.ENTRA_CLIENT_SECRET || !url.searchParams.get("code") || !getCookie("chibbo_oidc_state") || url.searchParams.get("state") !== getCookie("chibbo_oidc_state") || !getCookie("chibbo_oidc_verifier") || !getCookie("chibbo_oidc_nonce")) throw new Error("OIDC callback rejected");
    const identity = await exchangeAndVerifyAuthorizationCode({ tenantId: config.ENTRA_TENANT_ID, clientId: config.ENTRA_CLIENT_ID, clientSecret: config.ENTRA_CLIENT_SECRET, origin: config.NEXT_PUBLIC_APP_ORIGIN }, { code: url.searchParams.get("code")!, verifier: decodeURIComponent(getCookie("chibbo_oidc_verifier")!), nonce: decodeURIComponent(getCookie("chibbo_oidc_nonce")!) });
    const session = await createStaffSession(identity); const response = NextResponse.redirect(new URL(session.principal.role === "platform-admin" ? "/admin/companies" : "/staff/applications", request.url));
    response.cookies.set("chibbo_session", session.token, { httpOnly: true, secure: process.env.NODE_ENV !== "test", sameSite: "lax", maxAge: 1800, path: "/" }); return clear(response);
  } catch { return clear(NextResponse.json({ error: "로그인을 완료하지 못했습니다." }, { status: 404, headers: noStoreHeaders() })); }
}
