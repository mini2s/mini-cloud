import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Runtime-proxy routes: these rewrites are evaluated on every request so
// REMOTE_API_URL can be overridden at runtime (e.g. via Helm extraEnv)
// without rebuilding the image. Static rewrites (/docs) stay in next.config.ts.
const proxyPrefixes = ["/api/", "/auth/", "/cloud-api/", "/uploads/"];
const proxyExact = ["/ws"];

function configuredApiBasePath(): string | undefined {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (!apiUrl?.startsWith("/") || apiUrl === "/") return undefined;
  return apiUrl.replace(/\/+$/, "");
}

function buildRemoteUrl(
  remoteApiUrl: string,
  pathname: string,
  search: string,
): URL {
  const url = new URL(remoteApiUrl);
  const remoteBasePath =
    url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, "");

  url.pathname = `${remoteBasePath}${pathname}`;
  url.search = search;
  url.hash = "";
  return url;
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const apiBasePath = configuredApiBasePath();

  const shouldProxy =
    proxyPrefixes.some((p) => pathname.startsWith(p)) ||
    proxyExact.includes(pathname) ||
    (apiBasePath !== undefined &&
      (pathname === apiBasePath ||
        pathname.startsWith(`${apiBasePath}/`)));

  if (!shouldProxy) {
    return NextResponse.next();
  }

  // Read backend URL from runtime env (falls back to the build-time default).
  const remoteApiUrl =
    process.env.REMOTE_API_URL || "http://localhost:8080";

  const url = buildRemoteUrl(
    remoteApiUrl,
    pathname,
    request.nextUrl.search,
  );

  return NextResponse.rewrite(url);
}
