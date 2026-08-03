import type { CloudProxyTransport } from "@multica/core/conversations";

const AUTH_TOKEN_COOKIE = "zgsmAdminToken";

export function readCostrictAuthToken(): string {
  if (typeof document === "undefined") return "";
  const match = document.cookie.match(
    new RegExp(`(?:^|;\\s*)${AUTH_TOKEN_COOKIE}=([^;]+)`),
  );
  return match?.[1] ?? "";
}

export function createCostrictDeviceTransport(
  fetchImpl: typeof fetch = globalThis.fetch,
): CloudProxyTransport {
  return (url, init) => {
    const headers = new Headers(init?.headers);
    const token = readCostrictAuthToken();
    if (token && !headers.has("Authorization")) {
      headers.set("Authorization", `Bearer ${token}`);
    }
    return fetchImpl(url, { ...init, headers });
  };
}
