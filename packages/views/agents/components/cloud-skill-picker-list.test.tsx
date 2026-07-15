// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import type { CatalogSkill } from "@multica/core/types";
import { renderWithI18n } from "../../test/i18n";
import { CloudSkillPickerList } from "./cloud-skill-picker-list";

const searchSkill: CatalogSkill = {
  id: "search-skill",
  name: "Web Search",
  description: "Search the public web",
  slug: "search",
  version: "2.0.0",
  category: "web",
};

const gitSkill: CatalogSkill = {
  id: "git-skill",
  name: "Git Helper",
  description: "Operate git repositories",
  slug: "git",
  version: "1.0.0",
  category: "dev",
};

describe("CloudSkillPickerList", () => {
  it("reports controlled search input changes without filtering server results locally", () => {
    const onSearchChange = vi.fn();

    renderWithI18n(
      <CloudSkillPickerList
        skills={[searchSkill, gitSkill]}
        selectedIds={new Set()}
        onToggle={vi.fn()}
        searchQuery="web"
        onSearchChange={onSearchChange}
      />,
    );

    // Both server-supplied rows render even though the local search box says
    // "web" — the caller is responsible for server-side search, not this list.
    expect(screen.getByText("Web Search")).toBeInTheDocument();
    expect(screen.getByText("Git Helper")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Search skills"), {
      target: { value: "git" },
    });

    expect(onSearchChange).toHaveBeenCalledWith("git");
  });

  it("shows the default empty state when the catalog returns no items and search is blank", () => {
    renderWithI18n(
      <CloudSkillPickerList
        skills={[]}
        selectedIds={new Set()}
        onToggle={vi.fn()}
        searchQuery=""
        onSearchChange={vi.fn()}
      />,
    );

    expect(screen.getByText("No skills available")).toBeInTheDocument();
  });

  it("shows the no-match state when the catalog returns no items for a non-empty search", () => {
    renderWithI18n(
      <CloudSkillPickerList
        skills={[]}
        selectedIds={new Set()}
        onToggle={vi.fn()}
        searchQuery="nonexistent"
        onSearchChange={vi.fn()}
      />,
    );

    expect(
      screen.getByText("No skills match your search"),
    ).toBeInTheDocument();
  });

  it("toggles selection on row click and reflects selected state via aria-pressed", () => {
    const onToggle = vi.fn();

    renderWithI18n(
      <CloudSkillPickerList
        skills={[searchSkill]}
        selectedIds={new Set(["search-skill"])}
        onToggle={onToggle}
        searchQuery=""
        onSearchChange={vi.fn()}
      />,
    );

    const row = screen.getByRole("button", { name: /Web Search/i });
    expect(row).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(row);
    expect(onToggle).toHaveBeenCalledWith(searchSkill);
  });

  it("shows the loading state while the catalog query is pending", () => {
    renderWithI18n(
      <CloudSkillPickerList
        skills={[]}
        selectedIds={new Set()}
        onToggle={vi.fn()}
        loading
        searchQuery=""
        onSearchChange={vi.fn()}
      />,
    );

    expect(screen.getByText("Searching…")).toBeInTheDocument();
  });
});
