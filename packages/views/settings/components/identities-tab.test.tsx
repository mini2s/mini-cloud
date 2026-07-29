import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithI18n } from "../../test/i18n";
import { IdentitiesTab } from "./identities-tab";

const state = vi.hoisted(() => ({
  identities: { data: undefined as unknown, isLoading: false },
}));

vi.mock("@multica/core/channels", () => ({
  useIdentities: () => state.identities,
  channelKeys: { identities: () => ["channels", "identities"] },
}));

vi.mock("@tanstack/react-query", async (orig) => {
  const actual = await orig();
  return {
    ...(actual as object),
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  };
});

vi.mock("@multica/core/auth", () => ({
  useAuthStore: (sel: (s: { logout: () => void }) => unknown) => sel({ logout: vi.fn() }),
}));

vi.mock("@multica/core/api", () => ({
  api: {
    startIdentityBind: vi.fn(),
    unbindIdentity: vi.fn(),
    confirmMerge: vi.fn(),
    cancelMerge: vi.fn(),
  },
}));

function setIdentities(list: unknown[]) {
  state.identities = { data: list, isLoading: false };
}

describe("IdentitiesTab", () => {
  it("renders a bind button for each unbound provider when no identities exist", () => {
    setIdentities([]);
    renderWithI18n(<IdentitiesTab />);

    // All three providers unbound → three Bind buttons.
    expect(screen.getAllByRole("button", { name: "Bind" })).toHaveLength(3);
  });

  it("renders an unbind button for bound providers", () => {
    setIdentities([
      { provider: "github", displayName: "gh_user", email: null, phone: null, isPrimary: true, lastLoginAt: null },
    ]);
    renderWithI18n(<IdentitiesTab />);

    expect(screen.getByText("GitHub")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Unbind" })).toHaveLength(1);
    // idtrust + phone still unbound → 2 bind buttons.
    expect(screen.getAllByRole("button", { name: "Bind" })).toHaveLength(2);
  });

  it("disables unbind when only one bound identity remains", () => {
    setIdentities([
      { provider: "github", displayName: "gh", email: null, phone: null, isPrimary: true, lastLoginAt: null },
    ]);
    renderWithI18n(<IdentitiesTab />);

    const unbindBtn = screen.getByRole("button", { name: "Unbind" });
    expect(unbindBtn).toBeDisabled();
  });

  it("shows a spinner while identities are loading", () => {
    state.identities = { data: undefined, isLoading: true };
    const { container } = renderWithI18n(<IdentitiesTab />);

    // The loading spinner (Loader2 with animate-spin) renders while loading.
    expect(container.querySelector(".animate-spin")).toBeTruthy();
  });

  it("shows Chinese copy under the zh-Hans locale", () => {
    setIdentities([]);
    renderWithI18n(<IdentitiesTab />, { locale: "zh-Hans" });

    expect(screen.getByText("身份绑定")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "绑定" })).toHaveLength(3);
  });
});
