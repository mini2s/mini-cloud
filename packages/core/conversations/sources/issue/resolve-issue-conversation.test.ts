import { describe, expect, it } from "vitest";
import { resolveCloudProxyBaseUrl } from "./resolve-issue-conversation";

describe("resolveCloudProxyBaseUrl", () => {
  it("resolves a relative proxy URL against the trusted origin", () => {
    expect(
      resolveCloudProxyBaseUrl(
        "/cloud-api/cloud/device/device-1/proxy",
        "https://multica.example.test",
      ),
    ).toBe(
      "https://multica.example.test/cloud-api/cloud/device/device-1/proxy",
    );
  });

  it("rejects cross-origin and non-HTTP proxy URLs", () => {
    expect(() =>
      resolveCloudProxyBaseUrl(
        "https://attacker.example.test/proxy",
        "https://multica.example.test",
      ),
    ).toThrow("same-origin");
    expect(() =>
      resolveCloudProxyBaseUrl(
        "file:///tmp/proxy",
        "https://multica.example.test",
      ),
    ).toThrow("HTTP or HTTPS");
  });
});
