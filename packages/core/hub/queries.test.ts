import { describe, expect, it } from "vitest";
import type { CapabilityItem } from "../types/hub";
import { sortHubItems } from "./queries";

function makeItem(overrides: Partial<CapabilityItem>): CapabilityItem {
  return {
    id: "id",
    registryId: "registry",
    slug: "slug",
    itemType: "skill",
    name: "name",
    description: "",
    category: "cat",
    version: "1.0.0",
    content: "",
    visibility: "public",
    status: "published",
    createdBy: "user",
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("sortHubItems", () => {
  it("returns items unchanged when sort is undefined", () => {
    const items = [makeItem({ id: "a" }), makeItem({ id: "b" })];
    expect(sortHubItems(items, undefined, undefined)).toBe(items);
  });

  it("sorts by favoriteCount descending by default", () => {
    const items = [
      makeItem({ id: "low", favoriteCount: 1 }),
      makeItem({ id: "high", favoriteCount: 10 }),
      makeItem({ id: "mid", favoriteCount: 5 }),
    ];
    expect(sortHubItems(items, "favoriteCount", undefined).map((i) => i.id)).toEqual([
      "high",
      "mid",
      "low",
    ]);
  });

  it("sorts by experienceScore ascending when order is asc", () => {
    const items = [
      makeItem({ id: "high", experienceScore: 9 }),
      makeItem({ id: "low", experienceScore: 2 }),
      makeItem({ id: "mid", experienceScore: 5 }),
    ];
    expect(sortHubItems(items, "experienceScore", "asc").map((i) => i.id)).toEqual([
      "low",
      "mid",
      "high",
    ]);
  });

  it("sorts by updatedAt ISO strings", () => {
    const items = [
      makeItem({ id: "old", updatedAt: "2024-01-01T00:00:00Z" }),
      makeItem({ id: "new", updatedAt: "2024-06-01T00:00:00Z" }),
      makeItem({ id: "mid", updatedAt: "2024-03-01T00:00:00Z" }),
    ];
    expect(sortHubItems(items, "updatedAt", "desc").map((i) => i.id)).toEqual([
      "new",
      "mid",
      "old",
    ]);
    expect(sortHubItems(items, "updatedAt", "asc").map((i) => i.id)).toEqual([
      "old",
      "mid",
      "new",
    ]);
  });

  it("puts items missing the sort field last regardless of direction", () => {
    const items = [
      makeItem({ id: "missing" }),
      makeItem({ id: "high", experienceScore: 9 }),
      makeItem({ id: "low", experienceScore: 1 }),
    ];
    expect(sortHubItems(items, "experienceScore", "desc").map((i) => i.id)).toEqual([
      "high",
      "low",
      "missing",
    ]);
    expect(sortHubItems(items, "experienceScore", "asc").map((i) => i.id)).toEqual([
      "low",
      "high",
      "missing",
    ]);
  });

  it("does not mutate the input array", () => {
    const items = [
      makeItem({ id: "b", favoriteCount: 1 }),
      makeItem({ id: "a", favoriteCount: 2 }),
    ];
    const snapshot = [...items];
    sortHubItems(items, "favoriteCount", "desc");
    expect(items).toEqual(snapshot);
  });
});
