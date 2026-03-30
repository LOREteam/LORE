import { NextResponse } from "next/server";

// API routes now enforce their own per-route limits. Keep middleware passive so
// chat polling and analytics refreshes do not hit an extra global throttle.
export function middleware() {
  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*"],
};
