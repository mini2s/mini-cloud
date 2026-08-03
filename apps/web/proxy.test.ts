import { afterEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { proxy } from "./proxy";

vi.mock("next/server", () => ({
  NextResponse: {
    next: vi.fn(() => "next"),
    rewrite: vi.fn((url: URL) => url),
  },
}));

function request(pathname: string, search = ""): NextRequest {
  return {
    nextUrl: { pathname, search },
  } as unknown as NextRequest;
}

describe("web runtime proxy", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("proxies a configured relative API base path to the remote origin", () => {
    vi.stubEnv("REMOTE_API_URL", "https://zgsmtest.cn:30443");
    vi.stubEnv("NEXT_PUBLIC_API_URL", "/workflow-backend");

    proxy(request("/workflow-backend/api/config", "?source=local"));

    expect(NextResponse.rewrite).toHaveBeenCalledWith(
      new URL(
        "https://zgsmtest.cn:30443/workflow-backend/api/config?source=local",
      ),
    );
  });

  it("preserves a path prefix configured on REMOTE_API_URL", () => {
    vi.stubEnv(
      "REMOTE_API_URL",
      "https://zgsmtest.cn:30443/workflow-backend",
    );
    vi.stubEnv("NEXT_PUBLIC_API_URL", "");

    proxy(request("/api/config"));

    expect(NextResponse.rewrite).toHaveBeenCalledWith(
      new URL("https://zgsmtest.cn:30443/workflow-backend/api/config"),
    );
  });

  it("proxies cloud session requests to the remote API", () => {
    vi.stubEnv("REMOTE_API_URL", "https://zgsmtest.cn:30443");
    vi.stubEnv("NEXT_PUBLIC_API_URL", "/workflow-backend");

    proxy(
      request(
        "/cloud-api/cloud/device/device-1/proxy/api/v1/events",
        "?cursor=event-1",
      ),
    );

    expect(NextResponse.rewrite).toHaveBeenCalledWith(
      new URL(
        "https://zgsmtest.cn:30443/cloud-api/cloud/device/device-1/proxy/api/v1/events?cursor=event-1",
      ),
    );
  });

  it("maps CoStrict workspace APIs to the external cloud API", () => {
    vi.stubEnv("COSTRICT_API_URL", "https://costrict.example.com/root");

    proxy(request("/costrict-api/api/devices", "?status=online"));

    expect(NextResponse.rewrite).toHaveBeenCalledWith(
      new URL(
        "https://costrict.example.com/root/cloud-api/api/devices?status=online",
      ),
    );
  });

  it("uses the deployed CoStrict service when no local upstream is configured", () => {
    vi.stubEnv("COSTRICT_API_URL", "");

    proxy(request("/costrict-api/api/workspaces"));

    expect(NextResponse.rewrite).toHaveBeenCalledWith(
      new URL("https://zgsm.sangfor.com/cloud-api/api/workspaces"),
    );
  });

  it("supports an environment-specific CoStrict cloud API prefix", () => {
    vi.stubEnv("COSTRICT_API_URL", "https://costrict.example.com");
    vi.stubEnv("COSTRICT_CLOUD_API_PREFIX", "/cloud-api");

    proxy(request("/costrict-api/api/workspaces"));

    expect(NextResponse.rewrite).toHaveBeenCalledWith(
      new URL("https://costrict.example.com/cloud-api/workspaces"),
    );
  });

  it("maps CoStrict device requests to the deployed public gateway", () => {
    vi.stubEnv("COSTRICT_API_URL", "https://costrict.example.com");

    proxy(
      request(
        "/costrict-api/cloud/device/device-1/proxy/api/v1/events",
        "?cursor=event-1",
      ),
    );

    expect(NextResponse.rewrite).toHaveBeenCalledWith(
      new URL(
        "https://costrict.example.com/cloud-api/cloud/device/device-1/proxy/api/v1/events?cursor=event-1",
      ),
    );
  });

  it("supports an internal CoStrict target with an unprefixed device route", () => {
    vi.stubEnv("COSTRICT_API_URL", "http://cloud.internal:8080");
    vi.stubEnv("COSTRICT_DEVICE_PROXY_PREFIX", "/cloud/device");

    proxy(
      request(
        "/costrict-api/cloud/device/device-1/proxy/api/v1/conversations",
      ),
    );

    expect(NextResponse.rewrite).toHaveBeenCalledWith(
      new URL(
        "http://cloud.internal:8080/cloud/device/device-1/proxy/api/v1/conversations",
      ),
    );
  });

  it("maps CoStrict v2 APIs to the cloud dashboard", () => {
    vi.stubEnv("COSTRICT_API_URL", "https://costrict.example.com");

    proxy(request("/costrict-api/api/v2/models"));

    expect(NextResponse.rewrite).toHaveBeenCalledWith(
      new URL("https://costrict.example.com/cloud-dashboard/v2/models"),
    );
  });
});
