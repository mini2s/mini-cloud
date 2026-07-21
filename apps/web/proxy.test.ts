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
});
