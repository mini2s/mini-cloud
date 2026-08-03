# GitLab/GitHub 设置页整合 + 移除启用开关 — Implementation Plan (Spec A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把独立的「代码仓库」tab 整合进 GitLab/GitHub 两个平台 tab（按域名分流，两个 tab 常驻），并移除两个平台的「启用功能」总开关（前后端恒开）。

**Architecture:** 抽取共享 `RepositoriesSection`（按 `host` 分片、输入即分流）；`deriveGitlabSettings`/`deriveGitHubSettings` 的 `enabled` 恒 `true`；后端两个 autoLink 函数移除 master short-circuit（抽纯函数便于单测）；`settings-page` 移除 `code_platform` 显隐与 `repositories` tab。

**Tech Stack:** Go (Chi/sqlc), TypeScript (React + TanStack Query + Zustand), Vitest, i18n (en + zh-Hans with parity test).

**Spec:** [docs/superpowers/specs/2026-08-02-gitlab-repo-integration-design.md](../specs/2026-08-02-gitlab-repo-integration-design.md)

---

## Pre-flight

- [ ] **Create working branch (no upstream tracking):**

```bash
git switch --create feat/settings-repo-integration --no-track
git branch -vv   # confirm NO [origin/main]
```

---

## File Structure

**Backend (server/):**
- `internal/handler/gitlab.go` — refactor `workspaceGitlabAutoLinkEnabled` → extract pure `gitlabAutoLinkFromSettings`, drop master check
- `internal/handler/gitlab_test.go` (or new) — pure-fn unit test
- `internal/handler/github.go` — refactor `workspaceAutoLinkPRsEnabled` → extract pure `githubAutoLinkFromSettings`, drop master check
- `internal/handler/github_test.go` (or new) — pure-fn unit test

**Frontend (packages/):**
- `core/gitlab/settings.ts` — `enabled` always `true`
- `core/gitlab/settings.test.ts` — update assertions
- `core/github/settings.ts` — `enabled` always `true`
- `core/github/settings.test.ts` — update assertions
- **NEW** `views/settings/components/repositories-section.tsx` — shared, host-sharded section
- **NEW** `views/settings/components/repositories-section.test.tsx`
- **DELETE** `views/settings/components/repositories-tab.tsx` + `repositories-tab.test.tsx`
- `views/settings/components/gitlab-tab.tsx` — drop master switch, embed `<RepositoriesSection host="other" />`
- `views/settings/components/github-tab.tsx` — drop master switch, de-gate features, replace shortcut card with `<RepositoriesSection host="github" />`
- `views/settings/components/settings-page.tsx` — drop `code_platform` hiding + `repositories` tab
- `views/locales/en/settings.json` + `views/locales/zh-Hans/settings.json` — add/remove keys

---

## Task 1: Backend — GitLab autoLink drops master short-circuit

**Files:**
- Modify: `server/internal/handler/gitlab.go` (function at line 308)
- Test: `server/internal/handler/gitlab_test.go` (add test, or create if missing)

- [ ] **Step 1: Write the failing test**

Append to `server/internal/handler/gitlab_test.go` (create file with `package handler` header if it does not exist):

```go
package handler

import "testing"

func TestGitlabAutoLinkFromSettings(t *testing.T) {
	tests := []struct {
		name string
		raw  string
		want bool
	}{
		{"empty settings -> off", ``, false},
		{"sub-flag on, master off -> still on (master no longer short-circuits)", `{"gitlab_enabled":false,"gitlab_auto_link_enabled":true}`, true},
		{"sub-flag on, master on -> on", `{"gitlab_enabled":true,"gitlab_auto_link_enabled":true}`, true},
		{"sub-flag off -> off", `{"gitlab_auto_link_enabled":false}`, false},
		{"sub-flag absent -> off (default off)", `{"gitlab_enabled":false}`, false},
		{"garbage json -> off", `{not json`, false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := gitlabAutoLinkFromSettings([]byte(tc.raw)); got != tc.want {
				t.Errorf("gitlabAutoLinkFromSettings(%s) = %v, want %v", tc.raw, got, tc.want)
			}
		})
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && go test ./internal/handler/ -run TestGitlabAutoLinkFromSettings -v`
Expected: FAIL — `undefined: gitlabAutoLinkFromSettings`.

- [ ] **Step 3: Refactor to extract the pure function and drop the master check**

In `server/internal/handler/gitlab.go`, replace the body of `workspaceGitlabAutoLinkEnabled` (lines ~304–324) with a pure helper + thin wrapper. The new code:

```go
// gitlabAutoLinkFromSettings reports whether the workspace allows GitLab
// webhook auto-linking, based purely on the settings JSONB. The historical
// master `gitlab_enabled` switch is intentionally NOT consulted — the feature
// is always on; only the opt-in auto-link sub-flag gates this side-effect.
func gitlabAutoLinkFromSettings(raw []byte) bool {
	if len(raw) == 0 {
		return false
	}
	var s struct {
		GitlabAutoLinkEnabled *bool `json:"gitlab_auto_link_enabled"`
	}
	if err := json.Unmarshal(raw, &s); err != nil {
		return false
	}
	return s.GitlabAutoLinkEnabled != nil && *s.GitlabAutoLinkEnabled
}

// workspaceGitlabAutoLinkEnabled reports whether the workspace allows the
// GitLab webhook to create issue-MR link rows. Auto-link defaults to off
// unless the sub-flag is explicitly enabled.
func (h *Handler) workspaceGitlabAutoLinkEnabled(ctx context.Context, workspaceID pgtype.UUID) bool {
	ws, err := h.Queries.GetWorkspace(ctx, workspaceID)
	if err != nil {
		return false
	}
	return gitlabAutoLinkFromSettings(ws.Settings)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && go test ./internal/handler/ -run TestGitlabAutoLinkFromSettings -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/internal/handler/gitlab.go server/internal/handler/gitlab_test.go
git commit -m "refactor(gitlab): drop master short-circuit from auto-link gate"
```

---

## Task 2: Backend — GitHub autoLink drops master short-circuit

**Files:**
- Modify: `server/internal/handler/github.go` (function at line 1000)
- Test: `server/internal/handler/github_test.go` (add test, or create if missing)

- [ ] **Step 1: Write the failing test**

Append to `server/internal/handler/github_test.go` (create with `package handler` if missing):

```go
package handler

import "testing"

func TestGithubAutoLinkFromSettings(t *testing.T) {
	tests := []struct {
		name string
		raw  string
		want bool
	}{
		{"empty settings -> on (default on)", ``, true},
		{"sub-flag on, master off -> still on (master no longer short-circuits)", `{"github_enabled":false,"github_auto_link_prs_enabled":true}`, true},
		{"sub-flag off -> off", `{"github_auto_link_prs_enabled":false}`, false},
		{"sub-flag absent -> on (default on)", `{"github_enabled":false}`, true},
		{"garbage json -> on", `{not json`, true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := githubAutoLinkFromSettings([]byte(tc.raw)); got != tc.want {
				t.Errorf("githubAutoLinkFromSettings(%s) = %v, want %v", tc.raw, got, tc.want)
			}
		})
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && go test ./internal/handler/ -run TestGithubAutoLinkFromSettings -v`
Expected: FAIL — `undefined: githubAutoLinkFromSettings`.

- [ ] **Step 3: Refactor to extract the pure function and drop the master check**

In `server/internal/handler/github.go`, replace `workspaceAutoLinkPRsEnabled` (lines ~1000–1019) with:

```go
// githubAutoLinkFromSettings reports whether the workspace allows GitHub
// webhook auto-linking, based purely on the settings JSONB. The master
// `github_enabled` switch is intentionally NOT consulted — the feature is
// always on; auto-link defaults to on unless explicitly disabled.
func githubAutoLinkFromSettings(raw []byte) bool {
	if len(raw) == 0 {
		return true
	}
	var s struct {
		GitHubAutoLinkPRsEnabled *bool `json:"github_auto_link_prs_enabled"`
	}
	if err := json.Unmarshal(raw, &s); err != nil {
		return true
	}
	if s.GitHubAutoLinkPRsEnabled == nil {
		return true
	}
	return *s.GitHubAutoLinkPRsEnabled
}

func (h *Handler) workspaceAutoLinkPRsEnabled(ctx context.Context, workspaceID pgtype.UUID) bool {
	ws, err := h.Queries.GetWorkspace(ctx, workspaceID)
	if err != nil {
		return true
	}
	return githubAutoLinkFromSettings(ws.Settings)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && go test ./internal/handler/ -run TestGithubAutoLinkFromSettings -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/internal/handler/github.go server/internal/handler/github_test.go
git commit -m "refactor(github): drop master short-circuit from auto-link gate"
```

---

## Task 3: Frontend — deriveGitlabSettings enabled always true

**Files:**
- Modify: `packages/core/gitlab/settings.ts`
- Test: `packages/core/gitlab/settings.test.ts`

- [ ] **Step 1: Update the failing test first**

Replace the body of `packages/core/gitlab/settings.test.ts` with assertions reflecting `enabled` always `true`:

```ts
import { describe, expect, it } from "vitest";
import type { Workspace } from "../types";
import { deriveGitlabSettings } from "./settings";

function ws(settings: Record<string, unknown>): Pick<Workspace, "settings"> {
  return { settings };
}

describe("deriveGitlabSettings", () => {
  it("enabled is always true (master switch removed)", () => {
    expect(deriveGitlabSettings(null).enabled).toBe(true);
    expect(deriveGitlabSettings(ws({})).enabled).toBe(true);
    // Even an explicit historical gitlab_enabled:false no longer disables.
    expect(deriveGitlabSettings(ws({ gitlab_enabled: false })).enabled).toBe(true);
  });

  it("autoLink defaults off and follows its sub-flag independently", () => {
    expect(deriveGitlabSettings(null).autoLinkMRs).toBe(false);
    expect(deriveGitlabSettings(ws({ gitlab_auto_link_enabled: true })).autoLinkMRs).toBe(true);
    // master off no longer forces autoLink off
    expect(
      deriveGitlabSettings(ws({ gitlab_enabled: false, gitlab_auto_link_enabled: true })).autoLinkMRs,
    ).toBe(true);
  });

  it("mrSidebar follows its sub-flag independently", () => {
    expect(deriveGitlabSettings(ws({ gitlab_mr_sidebar_enabled: true })).mrSidebar).toBe(true);
    expect(
      deriveGitlabSettings(ws({ gitlab_enabled: false, gitlab_mr_sidebar_enabled: true })).mrSidebar,
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @multica/core exec vitest run gitlab/settings.test.ts`
Expected: FAIL — old impl still returns `enabled:false` for `gitlab_enabled:false`.

- [ ] **Step 3: Update the implementation**

Replace the body of `deriveGitlabSettings` in `packages/core/gitlab/settings.ts`:

```ts
export function deriveGitlabSettings(
  workspace: Pick<Workspace, "settings"> | null | undefined,
): GitlabDerivedSettings {
  const s = (workspace?.settings ?? {}) as Record<string, unknown>;
  // The master `gitlab_enabled` switch has been removed — the feature is
  // always on. Historical gitlab_enabled values are ignored.
  return {
    enabled: true,
    mrSidebar: s.gitlab_mr_sidebar_enabled === true,
    autoLinkMRs: s.gitlab_auto_link_enabled === true,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @multica/core exec vitest run gitlab/settings.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/gitlab/settings.ts packages/core/gitlab/settings.test.ts
git commit -m "refactor(gitlab): make derived enabled flag always true"
```

---

## Task 4: Frontend — deriveGitHubSettings enabled always true

**Files:**
- Modify: `packages/core/github/settings.ts`
- Test: `packages/core/github/settings.test.ts`

- [ ] **Step 1: Update the failing test first**

Replace the body of `packages/core/github/settings.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { deriveGitHubSettings } from "./settings";
import type { Workspace } from "../types";

function ws(settings: Record<string, unknown>): Pick<Workspace, "settings"> {
  return { settings };
}

describe("deriveGitHubSettings", () => {
  it("enabled is always true (master switch removed)", () => {
    expect(deriveGitHubSettings(null).enabled).toBe(true);
    expect(deriveGitHubSettings(ws({})).enabled).toBe(true);
    expect(deriveGitHubSettings(ws({ github_enabled: false })).enabled).toBe(true);
  });

  it("sub-flags keep their default-on semantics independently of master", () => {
    expect(deriveGitHubSettings(null)).toMatchObject({ prSidebar: true, coAuthor: true, autoLinkPRs: true });
    expect(deriveGitHubSettings(ws({ github_pr_sidebar_enabled: false })).prSidebar).toBe(false);
    expect(deriveGitHubSettings(ws({ co_authored_by_enabled: false })).coAuthor).toBe(false);
    expect(deriveGitHubSettings(ws({ github_auto_link_prs_enabled: false })).autoLinkPRs).toBe(false);
    // master off no longer forces sub-flags off
    expect(
      deriveGitHubSettings(ws({ github_enabled: false, github_pr_sidebar_enabled: true })).prSidebar,
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @multica/core exec vitest run github/settings.test.ts`
Expected: FAIL.

- [ ] **Step 3: Update the implementation**

Replace the body of `deriveGitHubSettings` in `packages/core/github/settings.ts`:

```ts
export function deriveGitHubSettings(
  workspace: Pick<Workspace, "settings"> | null | undefined,
): GitHubSettings {
  const s = (workspace?.settings ?? {}) as Record<string, unknown>;
  // The master `github_enabled` switch has been removed — the feature is
  // always on. Historical github_enabled values are ignored.
  return {
    enabled: true,
    prSidebar: s.github_pr_sidebar_enabled !== false,
    coAuthor: s.co_authored_by_enabled !== false,
    autoLinkPRs: s.github_auto_link_prs_enabled !== false,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @multica/core exec vitest run github/settings.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/github/settings.ts packages/core/github/settings.test.ts
git commit -m "refactor(github): make derived enabled flag always true"
```

---

## Task 5: Frontend — extract RepositoriesSection (host-sharded, input-routed)

**Files:**
- Create: `packages/views/settings/components/repositories-section.tsx`
- Create: `packages/views/settings/components/repositories-section.test.tsx`
- Delete (after section works): `packages/views/settings/components/repositories-tab.tsx`, `repositories-tab.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `packages/views/settings/components/repositories-section.test.tsx`. It mirrors the old `repositories-tab.test.tsx` mock pattern, adds host-sharding + routing assertions:

```tsx
import type { ReactNode } from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nProvider } from "@multica/core/i18n/react";
import enCommon from "../../locales/en/common.json";
import enSettings from "../../locales/en/settings.json";

const mockUpdateWorkspace = vi.hoisted(() => vi.fn());
const workspaceRef = vi.hoisted(() => ({
  current: {
    id: "workspace-1",
    name: "Test Workspace",
    slug: "test-workspace",
    repos: [] as { url: string }[],
  },
}));
const membersRef = vi.hoisted(() => ({
  current: [{ user_id: "user-1", role: "owner" as const }],
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: membersRef.current }),
  useQueryClient: () => ({ setQueryData: vi.fn() }),
}));
vi.mock("@multica/core/hooks", () => ({ useWorkspaceId: () => "workspace-1" }));
vi.mock("@multica/core/paths", () => ({ useCurrentWorkspace: () => workspaceRef.current }));
vi.mock("@multica/core/workspace/queries", () => ({
  memberListOptions: () => ({ queryKey: ["members"], queryFn: vi.fn() }),
  workspaceKeys: { list: () => ["workspaces"] },
}));
vi.mock("@multica/core/api", () => ({ api: { updateWorkspace: mockUpdateWorkspace } }));
vi.mock("@multica/core/auth", () => {
  const useAuthStore = Object.assign(
    (sel?: (s: { user: { id: string } }) => unknown) =>
      sel ? sel({ user: { id: "user-1" } }) : { user: { id: "user-1" } },
    { getState: () => ({ user: { id: "user-1" } }) },
  );
  return { useAuthStore };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { RepositoriesSection } from "./repositories-section";

const TEST_RESOURCES = { en: { common: enCommon, settings: enSettings } };
function I18nWrapper({ children }: { children: ReactNode }) {
  return <I18nProvider locale="en" resources={TEST_RESOURCES}>{children}</I18nProvider>;
}

describe("RepositoriesSection host sharding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    membersRef.current = [{ user_id: "user-1", role: "owner" }];
  });

  it("host='github' only renders github.com repos", () => {
    workspaceRef.current = {
      ...workspaceRef.current,
      repos: [
        { url: "https://github.com/org/a" },
        { url: "https://gitlab.example.com/org/b" },
      ],
    };
    render(<RepositoriesSection host="github" />, { wrapper: I18nWrapper });
    expect(screen.getByText("https://github.com/org/a")).toBeTruthy();
    expect(screen.queryByText("https://gitlab.example.com/org/b")).toBeNull();
  });

  it("host='other' only renders non-github repos", () => {
    workspaceRef.current = {
      ...workspaceRef.current,
      repos: [
        { url: "https://github.com/org/a" },
        { url: "https://gitlab.example.com/org/b" },
      ],
    };
    render(<RepositoriesSection host="other" />, { wrapper: I18nWrapper });
    expect(screen.getByText("https://gitlab.example.com/org/b")).toBeTruthy();
    expect(screen.queryByText("https://github.com/org/a")).toBeNull();
  });

  it("adding a URL of the OTHER host saves it and it disappears from this view (input routing)", async () => {
    const user = userEvent.setup();
    workspaceRef.current = { ...workspaceRef.current, repos: [] };
    mockUpdateWorkspace.mockImplementation(async (_id: string, payload: { repos: { url: string }[] }) => {
      workspaceRef.current = { ...workspaceRef.current, repos: payload.repos };
      return workspaceRef.current;
    });

    render(<RepositoriesSection host="github" />, { wrapper: I18nWrapper });
    await user.click(screen.getByRole("button", { name: /Add repository/ }));
    await user.type(screen.getByRole("textbox"), "https://gitlab.example.com/org/routed");
    await user.click(screen.getByRole("button", { name: /^Save$/ }));

    await waitFor(() => {
      expect(mockUpdateWorkspace).toHaveBeenCalledWith("workspace-1", {
        repos: [{ url: "https://gitlab.example.com/org/routed" }],
      });
    });
    // The routed-away URL is not visible in the github view.
    expect(screen.queryByText("https://gitlab.example.com/org/routed")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @multica/views exec vitest run settings/components/repositories-section.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the component**

Create `packages/views/settings/components/repositories-section.tsx`. This is the old `repositories-tab.tsx` logic, changed to: accept `host`, filter display by `repoHost`, save the full array, and on save detect routed-away additions for the toast.

```tsx
"use client";

import { useEffect, useState } from "react";
import { Save, Plus, Trash2, Pencil, X } from "lucide-react";
import { Input } from "@multica/ui/components/ui/input";
import { Button } from "@multica/ui/components/ui/button";
import { Card, CardContent } from "@multica/ui/components/ui/card";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@multica/core/auth";
import { useWorkspaceId } from "@multica/core/hooks";
import { useCurrentWorkspace } from "@multica/core/paths";
import { memberListOptions, workspaceKeys } from "@multica/core/workspace/queries";
import { api } from "@multica/core/api";
import type { Workspace, WorkspaceRepo } from "@multica/core/types";
import { useT } from "../../i18n";

/** Host bucket inferred from a repo URL. Mirrors server-side githubRepoCount /github\.com/i. */
export function repoHost(url: string): "github" | "other" {
  return /github\.com/i.test(url) ? "github" : "other";
}

function dropAndShiftIndex(set: Set<number>, removed: number): Set<number> {
  const next = new Set<number>();
  set.forEach((i) => {
    if (i === removed) return;
    next.add(i > removed ? i - 1 : i);
  });
  return next;
}

export interface RepositoriesSectionProps {
  host: "github" | "other";
}

export function RepositoriesSection({ host }: RepositoriesSectionProps) {
  const { t } = useT("settings");
  const user = useAuthStore((s) => s.user);
  const workspace = useCurrentWorkspace();
  const wsId = useWorkspaceId();
  const qc = useQueryClient();
  const { data: members = [] } = useQuery(memberListOptions(wsId));

  const allRepos = workspace?.repos ?? [];
  const [repos, setRepos] = useState<WorkspaceRepo[]>(allRepos);
  const [editingIndices, setEditingIndices] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);

  const currentMember = members.find((m) => m.user_id === user?.id) ?? null;
  const canManageWorkspace = currentMember?.role === "owner" || currentMember?.role === "admin";

  useEffect(() => {
    setRepos(allRepos);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace]);

  // Visible slice: only entries whose host bucket matches this section.
  const visible = repos
    .map((r, index) => ({ r, index }))
    .filter(({ r }) => repoHost(r.url) === host);

  const dirty = repos !== allRepos;

  const handleSave = async () => {
    if (!workspace) return;
    setSaving(true);
    try {
      // Detect newly-added URLs that routed away to the other host bucket.
      const before = new Set(allRepos.map((r) => r.url));
      const routedAway = repos.some(
        (r) => !before.has(r.url) && repoHost(r.url) !== host,
      );
      const updated = await api.updateWorkspace(workspace.id, { repos });
      qc.setQueryData(workspaceKeys.list(), (old: Workspace[] | undefined) =>
        old?.map((ws) => (ws.id === updated.id ? updated : ws)),
      );
      setEditingIndices(new Set());
      toast.success(
        routedAway
          ? t(($) => $.repositories.routed_to_other_tab)
          : t(($) => $.repositories.toast_saved),
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t(($) => $.repositories.toast_save_failed));
    } finally {
      setSaving(false);
    }
  };

  const handleAddRepo = () => {
    const nextIndex = repos.length;
    setRepos([...repos, { url: "" }]);
    setEditingIndices(new Set(editingIndices).add(nextIndex));
  };

  const handleRemoveRepo = (index: number) => {
    setRepos(repos.filter((_, i) => i !== index));
    setEditingIndices(dropAndShiftIndex(editingIndices, index));
  };

  const handleRepoChange = (index: number, value: string) => {
    setRepos(repos.map((r, i) => (i === index ? { ...r, url: value } : r)));
  };

  const handleEditRepo = (index: number) => {
    setEditingIndices(new Set(editingIndices).add(index));
  };

  const handleCancelEdit = (index: number) => {
    const savedUrl = allRepos[index]?.url;
    if (savedUrl === undefined) {
      handleRemoveRepo(index);
      return;
    }
    setRepos(repos.map((r, i) => (i === index ? { ...r, url: savedUrl } : r)));
    const next = new Set(editingIndices);
    next.delete(index);
    setEditingIndices(next);
  };

  if (!workspace) return null;

  return (
    <section className="space-y-4">
      <h2 className="text-sm font-semibold">{t(($) => $.repositories.section_title)}</h2>
      <Card>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            {t(($) => $.repositories.description)}
          </p>

          {visible.length === 0 && (
            <p className="text-xs text-muted-foreground italic">
              {t(($) => $.repositories.empty)}
            </p>
          )}

          {visible.map(({ r, index }) => {
            const isEditing = editingIndices.has(index);
            return (
              <div key={index} className="group flex items-center gap-2">
                {isEditing ? (
                  <Input
                    type="text"
                    value={r.url}
                    onChange={(e) => handleRepoChange(index, e.target.value)}
                    disabled={!canManageWorkspace}
                    placeholder={t(($) => $.repositories.url_placeholder)}
                    className="flex-1 min-w-0 text-sm"
                  />
                ) : (
                  <div
                    className="flex-1 min-w-0 truncate rounded-md border bg-muted/50 px-3 py-2 font-mono text-xs text-muted-foreground"
                    title={r.url}
                  >
                    {r.url || t(($) => $.repositories.url_empty)}
                  </div>
                )}
                {canManageWorkspace && (
                  <div
                    className={
                      isEditing
                        ? "flex shrink-0 items-center gap-0.5"
                        : "flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100"
                    }
                  >
                    {!isEditing && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t(($) => $.repositories.edit_aria)}
                        className="text-muted-foreground hover:text-foreground"
                        onClick={() => handleEditRepo(index)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    {isEditing && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t(($) => $.repositories.cancel_aria)}
                        className="text-muted-foreground hover:text-foreground"
                        onClick={() => handleCancelEdit(index)}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t(($) => $.repositories.delete_aria)}
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => handleRemoveRepo(index)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </div>
            );
          })}

          {canManageWorkspace && (
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <Button variant="outline" size="sm" onClick={handleAddRepo}>
                <Plus className="h-3 w-3" />
                {t(($) => $.repositories.add)}
              </Button>
              <div className="flex items-center gap-3">
                {!dirty && repos.length > 0 && (
                  <span className="text-xs text-muted-foreground">
                    {t(($) => $.repositories.saved_hint)}
                  </span>
                )}
                <Button size="sm" onClick={handleSave} disabled={saving || !dirty}>
                  <Save className="h-3 w-3" />
                  {saving ? t(($) => $.repositories.saving) : t(($) => $.repositories.save)}
                </Button>
              </div>
            </div>
          )}

          {!canManageWorkspace && (
            <p className="text-xs text-muted-foreground">
              {t(($) => $.repositories.manage_hint)}
            </p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
```

> Note: the old `repositories-tab.tsx` used `isDirty(local, saved)` comparing URLs element-wise. Here `dirty = repos !== allRepos` is sufficient because every edit produces a new array reference via `setRepos(map/filter)`. Keep that invariant (never mutate `repos` in place).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @multica/views exec vitest run settings/components/repositories-section.test.tsx`
Expected: PASS.

- [ ] **Step 5: Delete the old tab + test**

```bash
git rm packages/views/settings/components/repositories-tab.tsx
git rm packages/views/settings/components/repositories-tab.test.tsx
```

- [ ] **Step 6: Commit**

```bash
git add packages/views/settings/components/repositories-section.tsx packages/views/settings/components/repositories-section.test.tsx
git commit -m "feat(settings): extract host-sharded RepositoriesSection"
```

---

## Task 6: Frontend — GitlabTab: drop master switch, embed section

**Files:**
- Modify: `packages/views/settings/components/gitlab-tab.tsx`
- Test: `packages/views/settings/components/gitlab-tab.test.tsx` (create if missing; otherwise the change is covered by removal of master-switch assertions)

- [ ] **Step 1: Edit the component**

In `packages/views/settings/components/gitlab-tab.tsx`:

(a) Remove the now-unused master-switch state machinery. Delete the `type SettingsKey = "gitlab_enabled";` line, and the `savingKey` state + `persistSetting` function entirely (their only caller was the master switch).

(b) Simplify the `configured` derivation (line ~78–80) to drop `flags.enabled`:

```ts
const configured =
  gitlabSettings?.configured === true || hasAccessToken;
```

(c) Delete the entire master-switch `<section>` (the Card with `<Switch id="gitlab-master" ...>`), currently lines ~163–191.

(d) Add the import and embed the section after the connection section, inside the outer `<div className="space-y-8">`, just before the closing `</div>`:

```tsx
import { RepositoriesSection } from "./repositories-section";
```

and at the end of the returned tree (after the connection `</section>`):

```tsx
      <RepositoriesSection host="other" />
```

(e) Since `deriveGitlabSettings` is still imported but only `flags.enabled` was used (now dropped), if `flags` becomes unused, replace `const flags = deriveGitlabSettings(workspace);` — remove it and remove the import if nothing else uses it. (Tokens `gitlab_mr_sidebar_enabled`/`gitlab_auto_link_enabled` are not rendered here, so `flags` is now unused — remove both the `const flags` line and the `deriveGitlabSettings` import.)

- [ ] **Step 2: Verify typecheck + existing tests**

Run: `pnpm --filter @multica/views exec vitest run settings/components/gitlab-tab.test.tsx 2>/dev/null; pnpm --filter @multica/views exec tsc --noEmit`
Expected: no references to removed symbols. If a `gitlab-tab.test.tsx` exists and asserts on the master switch / `gitlab_enabled`, delete those assertions (the switch is gone).

- [ ] **Step 3: Commit**

```bash
git add packages/views/settings/components/gitlab-tab.tsx
git commit -m "feat(gitlab-tab): drop master switch, embed code repositories section"
```

---

## Task 7: Frontend — GitHubTab: drop master switch, de-gate features, embed section

**Files:**
- Modify: `packages/views/settings/components/github-tab.tsx`
- Test: `packages/views/settings/components/github-tab.test.tsx`

- [ ] **Step 1: Update the test (remove master-switch assertions, add section presence)**

In `packages/views/settings/components/github-tab.test.tsx`, delete the following `it` blocks that assert master-switch behavior (they no longer apply):
- `"folds the non-dev hint into the master switch description …"`
- `"does not show the hint once the master switch is off"`
- `"disables every feature switch when the master switch is off"`
- `"flipping the master switch off persists github_enabled=false …"`
- `"repositories shortcut navigates to the repositories tab"`

Add a new test verifying the embedded section replaces the shortcut:

```tsx
  it("embeds the GitHub repositories section instead of a shortcut link", () => {
    render(<GitHubTab />, { wrapper: I18nWrapper });
    // Shortcut link is gone.
    expect(screen.queryByRole("button", { name: /Manage repositories/ })).toBeNull();
    // The section's add button is present.
    expect(screen.getByRole("button", { name: /Add repository/ })).toBeTruthy();
  });

  it("feature switches are editable by an admin (no master gate)", () => {
    render(<GitHubTab />, { wrapper: I18nWrapper });
    const switches = screen.getAllByRole("switch");
    // No master switch anymore; every switch is a feature toggle and enabled for the owner.
    for (const sw of switches) {
      expect(sw.getAttribute("aria-disabled") !== "true" && !sw.hasAttribute("disabled")).toBe(true);
    }
  });
```

Also delete the now-unused mock `mockNavPush` and the `useNavigation` mock's `push` usage if no remaining test uses navigation (the disconnect test does not push). If `mockNavPush` is still referenced elsewhere, leave it.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @multica/views exec vitest run settings/components/github-tab.test.tsx`
Expected: FAIL — new assertions fail (shortcut still present / master switch still gates features).

- [ ] **Step 3: Edit the component**

In `packages/views/settings/components/github-tab.tsx`:

(a) `SettingsKey` type: remove `"github_enabled" |` (keep the three feature keys).

(b) Delete the entire master-switch `<section>` (Card with `<Switch id="github-master" ...>`), lines ~139–167.

(c) De-gate the three `FeatureRow` `disabled` props: change each `!canManage || !flags.enabled || savingKey === "..."` to `!canManage || savingKey === "..."`.

(d) Remove the repositories shortcut `<section>` (Card with the `ExternalLink` "Manage repositories" button + `githubRepoCount`), lines ~313–337. Also delete the `githubRepoCount`, `repositoriesHref`, and the `ExternalLink` import if now unused.

(e) Embed the section after the Features section:

```tsx
import { RepositoriesSection } from "./repositories-section";
```

and after the Features `</section>`:

```tsx
      <RepositoriesSection host="github" />
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @multica/views exec vitest run settings/components/github-tab.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/views/settings/components/github-tab.tsx packages/views/settings/components/github-tab.test.tsx
git commit -m "feat(github-tab): drop master switch, de-gate features, embed repositories section"
```

---

## Task 8: Frontend — settings-page: tabs always visible, drop repositories tab

**Files:**
- Modify: `packages/views/settings/components/settings-page.tsx`
- Test: `packages/views/settings/components/settings-page.test.tsx`

- [ ] **Step 1: Update the test**

In `packages/views/settings/components/settings-page.test.tsx`:

(a) Change the mock for the deleted `repositories-tab` to mock the new section is unnecessary (settings-page no longer imports it). Remove line `vi.mock("./repositories-tab", …)`.

(b) Replace the existing `it(...)` with one asserting BOTH platform tabs are visible regardless of `code_platform`, and the repositories tab is gone:

```tsx
  it("shows both GitHub and GitLab tabs for every workspace (no code_platform hiding), no repositories tab", () => {
    workspaceRef.current = {
      id: "workspace-1",
      name: "Test Workspace",
      slug: "test-workspace",
      repos: [],
      settings: { code_platform: "github" },
    };
    render(<SettingsPage />, { wrapper: TestWrapper });
    const tabList = screen.getByRole("tablist");
    expect(within(tabList).getByRole("tab", { name: "GitHub" })).toBeTruthy();
    expect(within(tabList).getByRole("tab", { name: "GitLab" })).toBeTruthy();
    expect(within(tabList).queryByRole("tab", { name: "Repositories" })).toBeNull();
  });

  it("?tab=repositories falls back to the default tab (no such route)", () => {
    const navigation: NavigationAdapter = {
      pathname: "/test-workspace/settings",
      searchParams: new URLSearchParams("tab=repositories"),
      push: vi.fn(),
      replace: vi.fn(),
      back: vi.fn(),
      getShareableUrl: (path) => `https://example.test${path}`,
    };
    render(
      <I18nProvider locale="en" resources={TEST_RESOURCES}>
        <NavigationProvider value={navigation}><SettingsPage /></NavigationProvider>
      </I18nProvider>,
    );
    // Default tab (profile) content area is active; repositories is not a valid tab.
    expect(screen.getByText("Profile content")).toBeTruthy();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @multica/views exec vitest run settings/components/settings-page.test.tsx`
Expected: FAIL — old code hides GitLab when `code_platform=github`.

- [ ] **Step 3: Edit settings-page.tsx**

(a) Remove `RepositoriesTab` import (line ~28) and its `<TabsContent value="repositories">` (line ~204).

(b) Remove `repositories` from `WORKSPACE_TAB_KEYS` (line ~59), `WORKSPACE_TAB_VALUES` (line ~68), `WORKSPACE_TAB_ICONS` (line ~77). Remove the `FolderGit2` import from lucide-react (line ~10) if now unused.

(c) Remove the `codePlatform` derivation (lines ~111–114) and change `visibleWorkspaceTabs` (lines ~116–120) to:

```ts
  const visibleWorkspaceTabs = WORKSPACE_TAB_KEYS;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @multica/views exec vitest run settings/components/settings-page.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/views/settings/components/settings-page.tsx packages/views/settings/components/settings-page.test.tsx
git commit -m "feat(settings): always show both platform tabs, remove repositories tab"
```

---

## Task 9: i18n — add/remove keys (en + zh-Hans in sync)

**Files:**
- Modify: `packages/views/locales/en/settings.json`
- Modify: `packages/views/locales/zh-Hans/settings.json`

- [ ] **Step 1: Remove dead keys from BOTH locale files**

Delete these keys (the `section_master`/`master_description_*`/shortcut/`code_platform_*` entries):

Under `"gitlab"`: `section_master`, `master_description_on`, `master_description_off`.
Under `"github"`: `section_master`, `master_description_on`, `master_description_off`, `section_repositories`, `repositories_shortcut_label`, `repositories_shortcut_link`.
Under `"page.tabs"`: `repositories`.
Under `"repositories"`: `code_platform_label`, `platform_changed`, `platform_save_failed`.

- [ ] **Step 2: Add the routed-away toast key to BOTH locale files**

Under `"repositories"`, add:

en:
```json
    "routed_to_other_tab": "Saved. Repositories are sorted into each platform tab by domain — check the other platform tab if you don't see one here.",
```

zh-Hans:
```json
    "routed_to_other_tab": "已保存。仓库按域名自动归入对应平台标签页——在这里看不到的，请到另一个平台标签页查看。",
```

- [ ] **Step 3: Verify parity + views tests still resolve keys**

Run: `pnpm --filter @multica/views exec vitest run locales/parity`
Expected: PASS (en and zh-Hans key sets match).

- [ ] **Step 4: Commit**

```bash
git add packages/views/locales/en/settings.json packages/views/locales/zh-Hans/settings.json
git commit -m "chore(i18n): drop master/shortcut/code_platform keys, add routed_to_other_tab"
```

---

## Task 10: Full verification

- [ ] **Step 1: Typecheck everything**

Run: `pnpm typecheck`
Expected: no errors. Pay attention to any leftover `flags.enabled` / `gitlab_enabled` / `github_enabled` references in `packages/`.

- [ ] **Step 2: Grep for leftover gated references**

Run: `grep -rn "flags.enabled\|gitlab_enabled\|github_enabled" packages/views packages/core`
Expected: only `packages/core/{gitlab,github}/settings.test.ts` (asserting the value is ignored) — no UI gating references. If any UI file still reads these, remove the dead branch.

- [ ] **Step 3: Run all TS tests**

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 4: Run Go tests for the handler package**

Run: `cd server && go test ./internal/handler/ -run 'TestGitlabAutoLinkFromSettings|TestGithubAutoLinkFromSettings' -v`
Expected: PASS (pure-fn tests, no DB needed).

- [ ] **Step 5: Final commit if any cleanup**

If steps 1–2 surfaced cleanup, commit it:

```bash
git add -A
git commit -m "chore(settings): cleanup leftover master-switch references"
```

- [ ] **Step 6: Inspect branch state**

```bash
git branch -vv   # confirm still NOT tracking origin/main
git log --oneline -15
```

---

## Self-Review (completed by plan author)

- **Spec coverage:** §1 (RepositoriesSection + routing) → Task 5; §2 (tab 常驻 + code_platform) → Task 8; §3 frontend恒开 → Tasks 3,4,6,7; §4 后端恒开 → Tasks 1,2; §5 布局 → Tasks 6,7; §6 i18n → Task 9. All spec sections mapped.
- **Placeholder scan:** no TBD/TODO; every code step shows the code.
- **Type consistency:** `repoHost`, `RepositoriesSection({host})`, `routed_to_other_tab` key used consistently across Task 5/9 and consumed in Task 6/7. `gitlabAutoLinkFromSettings`/`githubAutoLinkFromSettings` pure fns match their tests.
