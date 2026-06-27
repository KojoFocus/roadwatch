import { NextRequest, NextResponse } from "next/server";
import { getIronSession }           from "iron-session";
import type { SessionData }          from "@/types";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Only protect /admin routes (except /admin/login)
  if (pathname.startsWith("/admin") && pathname !== "/admin/login") {
    const response = NextResponse.next();

    const session = await getIronSession<SessionData>(request, response, {
      password:    process.env.SESSION_SECRET as string,
      cookieName:  "rw_admin_session",
    });

    if (!session.isLoggedIn || !session.admin) {
      return NextResponse.redirect(new URL("/admin/login", request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*"],
};
