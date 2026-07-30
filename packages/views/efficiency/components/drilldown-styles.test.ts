import { describe, expect, it } from "vitest";
import {
  DRILLDOWN_LINK_CLASS,
  DRILLDOWN_ROW_CLASS,
  DRILLDOWN_TREE_ITEM_CLASS,
} from "./drilldown-styles";

describe("efficiency drill-down interaction styles", () => {
  it.each([
    ["row", DRILLDOWN_ROW_CLASS],
    ["link", DRILLDOWN_LINK_CLASS],
    ["tree item", DRILLDOWN_TREE_ITEM_CLASS],
  ])("gives %s controls pointer, hover, and keyboard focus feedback", (_, className) => {
    expect(className).toContain("cursor-pointer");
    expect(className).toMatch(/hover:/);
    expect(className).toMatch(/focus-visible:/);
  });

  it("uses the visible brand color for drill-down text links", () => {
    expect(DRILLDOWN_LINK_CLASS).toContain("text-brand");
    expect(DRILLDOWN_LINK_CLASS).toContain("decoration-brand");
    expect(DRILLDOWN_LINK_CLASS).toContain("hover:bg-brand/5");
  });
});
