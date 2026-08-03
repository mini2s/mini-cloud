import { afterEach, describe, expect, it, vi } from "vitest";
import { createCostrictDeviceTransport } from "./costrict-device-transport";

afterEach(() => {
  document.cookie = "zgsmAdminToken=; path=/; max-age=0";
});

describe("CoStrict device transport", () => {
  it("adds the browser session token for cross-cluster device requests", async () => {
    document.cookie = "zgsmAdminToken=session-token; path=/";
    const fetchMock = vi.fn().mockResolvedValue(new Response(null));
    const transport = createCostrictDeviceTransport(fetchMock);

    await transport("https://cluster.example.com/cloud/device/device-1/proxy", {
      headers: { Accept: "application/json" },
    });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get("Authorization")).toBe("Bearer session-token");
    expect(headers.get("Accept")).toBe("application/json");
  });

  it("does not replace an explicitly supplied authorization header", async () => {
    document.cookie = "zgsmAdminToken=session-token; path=/";
    const fetchMock = vi.fn().mockResolvedValue(new Response(null));
    const transport = createCostrictDeviceTransport(fetchMock);

    await transport("/costrict-api/cloud/device/device-1/proxy", {
      headers: { Authorization: "Bearer explicit-token" },
    });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(init.headers).get("Authorization")).toBe(
      "Bearer explicit-token",
    );
  });
});
