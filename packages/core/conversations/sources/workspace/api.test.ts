import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchCostrictDevices,
  fetchCostrictWorkspaces,
} from "./api";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CoStrict workspace API", () => {
  it("loads and normalizes devices through the isolated web proxy", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          devices: [
            {
              id: "record-1",
              deviceId: "device-1",
              label: "Laptop",
              status: "online",
              canUpdate: true,
              latestVersion: "2.0.0",
              clusterAPIURL: null,
            },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchCostrictDevices()).resolves.toEqual([
      expect.objectContaining({
        id: "record-1",
        deviceId: "device-1",
        displayName: "Laptop",
        status: "online",
        canUpdate: true,
        latestVersion: "2.0.0",
      }),
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      "/costrict-api/api/devices",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("loads workspace directories without conflating them with Multica workspaces", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            workspaces: [
              {
                id: "costrict-workspace-1",
                name: "Repository",
                deviceId: "record-1",
                deviceUniqueId: "device-1",
                directories: [
                  {
                    id: "directory-1",
                    workspaceId: "costrict-workspace-1",
                    path: "/work/repository",
                    isDefault: true,
                  },
                ],
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );

    await expect(fetchCostrictWorkspaces()).resolves.toEqual([
      expect.objectContaining({
        id: "costrict-workspace-1",
        deviceId: "record-1",
        directories: [
          expect.objectContaining({ path: "/work/repository" }),
        ],
      }),
    ]);
  });

  it("degrades malformed collections to an empty list", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ devices: [{ id: null }] }), {
          status: 200,
        }),
      ),
    );

    await expect(fetchCostrictDevices()).resolves.toEqual([]);
  });

  it("keeps valid records when another record is malformed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            devices: [
              { id: null },
              {
                id: "record-2",
                deviceId: "device-2",
                displayName: "Desktop",
                clusterAPIURL: "not-a-strict-url-but-preserved",
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );

    await expect(fetchCostrictDevices()).resolves.toEqual([
      expect.objectContaining({
        id: "record-2",
        clusterAPIURL: "not-a-strict-url-but-preserved",
      }),
    ]);
  });

  it("fills a missing nested directory workspace id from its parent", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            workspaces: [
              {
                id: "workspace-2",
                name: "Repository",
                directories: [{ id: "directory-2", path: "/repo" }],
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );

    await expect(fetchCostrictWorkspaces()).resolves.toEqual([
      expect.objectContaining({
        directories: [
          expect.objectContaining({ workspaceId: "workspace-2" }),
        ],
      }),
    ]);
  });
});
