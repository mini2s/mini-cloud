export function resolveCloudProxyBaseUrl(
  proxyBaseUrl: string,
  origin: string,
): string {
  const trustedOrigin = new URL(origin);
  const resolved = new URL(proxyBaseUrl, trustedOrigin);

  if (!["http:", "https:"].includes(resolved.protocol)) {
    throw new Error("Cloud proxy URL must use HTTP or HTTPS");
  }
  if (resolved.origin !== trustedOrigin.origin) {
    throw new Error("Cloud proxy URL must be same-origin");
  }

  return resolved.href.replace(/\/$/, "");
}
