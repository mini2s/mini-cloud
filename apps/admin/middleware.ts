import { NextResponse, type NextRequest } from "next/server";

// Routes proxied to the Go backend at REMOTE_API_URL (default localhost:8080).
// Keeping this list explicit (rather than catching /* ) avoids proxying Next's
// own /_next assets and page routes.
const proxyPrefixes = ["/api/", "/auth/", "/uploads/"];
const proxyExact = ["/ws"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const shouldProxy =
    proxyPrefixes.some((p) => pathname.startsWith(p)) ||
    proxyExact.includes(pathname);

  if (!shouldProxy) {
    return NextResponse.next();
  }

  // Read backend URL from runtime env (falls back to dev default).
  const remoteApiUrl = process.env.REMOTE_API_URL || "http://localhost:8080";
  const url = new URL(pathname + request.nextUrl.search, remoteApiUrl);
  return NextResponse.rewrite(url);
}

export const config = {
  // Match all paths except Next internals; the function above filters further.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
