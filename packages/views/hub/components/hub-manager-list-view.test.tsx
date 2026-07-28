import { describe, expect, it, vi } from "vitest"
import { screen } from "@testing-library/react"
import type { ComponentProps } from "react"
import { renderWithI18n } from "../../test/i18n"
import type { CapabilityItem } from "@multica/core/types/hub"
import { HubManagerListView } from "./hub-manager-list-view"

const item: CapabilityItem = {
  id: "item-1",
  registryId: "registry-1",
  slug: "test-skill",
  itemType: "skill",
  name: "Test Skill",
  description: "A skill used by the manager list tests",
  category: "testing",
  version: "1.0.0",
  content: "# Test Skill",
  visibility: "public",
  status: "published",
  favoriteCount: 3,
  favorited: true,
  createdBy: "user-1",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-02T00:00:00Z",
}

function renderList(overrides: Partial<ComponentProps<typeof HubManagerListView>> = {}) {
  return renderWithI18n(
    <HubManagerListView
      items={[item]}
      selected={new Set()}
      onToggleRow={vi.fn()}
      onTogglePage={vi.fn()}
      {...overrides}
    />,
  )
}

describe("HubManagerListView", () => {
  it("hides select-all and row checkboxes when selection is disabled", () => {
    renderList({ selectable: false })

    expect(screen.queryAllByRole("checkbox")).toHaveLength(0)
  })

  it("keeps subscribe controls available without owner-only actions", () => {
    renderList({ selectable: false, onFav: vi.fn() })

    expect(screen.getAllByRole("button", { name: /Unsubscribe/ }).length).toBeGreaterThan(0)
    expect(screen.queryByText("Delete capability")).toBeNull()
    expect(screen.queryByText("Edit capability")).toBeNull()
  })

  it("shows selection and owner-only actions for created items", () => {
    renderList({
      onFav: vi.fn(),
      onEdit: vi.fn(),
      onDelete: vi.fn(),
    })

    expect(screen.queryAllByRole("checkbox")).toHaveLength(2)
    expect(screen.getByText("Delete capability")).toBeTruthy()
    expect(screen.getByText("Edit capability")).toBeTruthy()
  })
})
