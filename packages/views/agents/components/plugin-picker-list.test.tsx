// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { BuiltinPlugin } from "@multica/core/api/schemas";
import { PluginPickerList } from "./plugin-picker-list";

const figmaPlugin: BuiltinPlugin = {
  id: "figma",
  name: "Figma",
  description: "Design handoff",
  slug: "figma",
  version: "1.0.0",
  category: "design",
};

const githubPlugin: BuiltinPlugin = {
  id: "github",
  name: "GitHub",
  description: "Repository automation",
  slug: "github",
  version: "1.0.0",
  category: "development",
};

vi.mock("../../i18n", () => {
  const translations = {
    tab_body: {
      plugin: {
        picker: {
          search_placeholder: "Search plugins...",
          loading: "Loading plugins...",
          empty: "No plugins available",
          no_match: "No plugins match your search",
          builtin_section: "Built-in",
          cloud_section: "Cloud",
        },
      },
    },
  };
  return {
    useT: () => ({
      t: (selector: (value: typeof translations) => string) => selector(translations),
    }),
  };
});

describe("PluginPickerList", () => {
  it("reports controlled search input changes without filtering server results locally", () => {
    const onSearchChange = vi.fn();

    render(
      <PluginPickerList
        plugins={[figmaPlugin, githubPlugin]}
        selectedId={null}
        onSelect={vi.fn()}
        searchQuery="design"
        onSearchChange={onSearchChange}
      />,
    );

    expect(screen.getByText("Figma")).toBeInTheDocument();
    expect(screen.getByText("GitHub")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Search plugins..."), {
      target: { value: "github" },
    });

    expect(onSearchChange).toHaveBeenCalledWith("github");
  });

  it("shows the default empty state when there is no search", () => {
    render(
      <PluginPickerList
        plugins={[]}
        selectedId={null}
        onSelect={vi.fn()}
        searchQuery=""
        onSearchChange={vi.fn()}
      />,
    );

    expect(screen.getByText("No plugins available")).toBeInTheDocument();
  });

  it("shows the search empty state when the server returns no matches", () => {
    render(
      <PluginPickerList
        plugins={[]}
        selectedId={null}
        onSelect={vi.fn()}
        searchQuery="design"
        onSearchChange={vi.fn()}
      />,
    );

    expect(screen.getByText("No plugins match your search")).toBeInTheDocument();
  });

  it("selects plugin rows by id", () => {
    const onSelect = vi.fn();

    render(
      <PluginPickerList
        plugins={[figmaPlugin]}
        selectedId="figma"
        onSelect={onSelect}
        searchQuery=""
        onSearchChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Figma/i }));

    expect(onSelect).toHaveBeenCalledWith("figma");
  });
});
