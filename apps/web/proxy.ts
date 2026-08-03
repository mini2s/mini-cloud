import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Runtime-proxy routes: these rewrites are evaluated on every request so
// REMOTE_API_URL can be overridden at runtime (e.g. via Helm extraEnv)
// without rebuilding the image. Static rewrites (/docs) stay in next.config.ts.
const proxyPrefixes = ["/api/", "/auth/", "/cloud-api/", "/uploads/"];
const proxyExact = ["/ws"];
const efficiencyProxyPrefix = "/kanban/api";
const costrictProxyPrefix = "/costrict-api";

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

function costrictUpstreamPath(pathname: string): string {
  const path = pathname.slice(costrictProxyPrefix.length) || "/";
  const cloudApiPrefix =
    process.env.COSTRICT_CLOUD_API_PREFIX || "/cloud-api/api";
  const cloudDashboardPrefix =
    process.env.COSTRICT_CLOUD_DASHBOARD_PREFIX || "/cloud-dashboard";
  const deviceProxyPrefix =
    process.env.COSTRICT_DEVICE_PROXY_PREFIX || "/cloud-api/cloud/device";

  // Device routes use a dedicated public gateway prefix. Internal cloud
  // targets can override this back to `/cloud/device` via runtime env.
  if (path === "/cloud/device" || path.startsWith("/cloud/device/")) {
    return path.replace(/^\/cloud\/device/, deviceProxyPrefix);
  }

  if (path === "/cloud" || path.startsWith("/cloud/")) {
    return path.replace(/^\/cloud/, cloudApiPrefix);
  }

  if (path === "/api/v2" || path.startsWith("/api/v2/")) {
    return path.replace(/^\/api/, cloudDashboardPrefix);
  }

  if (path === "/api" || path.startsWith("/api/")) {
    return path.replace(/^\/api/, cloudApiPrefix);
  }

  return path;
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const apiBasePath = configuredApiBasePath();

  if (
    pathname === costrictProxyPrefix ||
    pathname.startsWith(`${costrictProxyPrefix}/`)
  ) {
    // This namespace mirrors the original CoStrict frontend proxy without
    // colliding with Multica's own `/api` and `/cloud-api` routes.
    const costrictApiUrl =
      process.env.COSTRICT_API_URL || "https://zgsm.sangfor.com";

    return NextResponse.rewrite(
      buildRemoteUrl(
        costrictApiUrl,
        costrictUpstreamPath(pathname),
        request.nextUrl.search,
      ),
    );
  }

  if (
    pathname === efficiencyProxyPrefix ||
    pathname.startsWith(`${efficiencyProxyPrefix}/`)
  ) {
    // The efficiency dashboard remains a separately deployed service. Keep
    // its historical browser-facing prefix stable while forwarding only the
    // suffix after `/kanban/api` to the configured service API root.
    const efficiencyApiUrl =
      process.env.EFFICIENCY_API_URL ||
      "https://zgsm.sangfor.com/kanban/api";
    const upstreamPath = pathname.slice(efficiencyProxyPrefix.length) || "/";

    return NextResponse.rewrite(
      buildRemoteUrl(efficiencyApiUrl, upstreamPath, request.nextUrl.search),
    );
  }

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
    process.env.REMOTE_API_URL || "https://zgsm.sangfor.com/workflow-backend";

  const url = buildRemoteUrl(
    remoteApiUrl,
    pathname,
    request.nextUrl.search,
  );

  return NextResponse.rewrite(url);
}
