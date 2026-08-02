import { expect, test, type Locator, type Page } from "@playwright/test";
import { createTestApi } from "./helpers";
import type { TestApiClient } from "./fixtures";
import { createHmac, randomBytes } from "crypto";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || `http://localhost:${process.env.PORT || "8080"}`;

type IssueRecord = {
  id: string;
  title: string;
  status: string;
  assignee_type: string | null;
  assignee_id: string | null;
};

async function authedFetch(api: TestApiClient, path: string, init?: RequestInit) {
  const token = api.getToken();
  const workspaceSlug = api.getWorkspaceSlug();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((init?.headers as Record<string, string>) ?? {}),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (workspaceSlug) headers["X-Workspace-Slug"] = workspaceSlug;

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (!res.ok) {
    throw new Error(`${init?.method ?? "GET"} ${path} failed: ${res.status} ${await res.text()}`);
  }
  return res;
}

async function createProject(api: TestApiClient, title: string) {
  const res = await authedFetch(api, "/api/projects", {
    method: "POST",
    body: JSON.stringify({
      title,
      resources: [
        {
          resource_type: "github_repo",
          resource_ref: { url: `https://github.com/multica-ai/e2e-${Date.now()}.git` },
          label: "E2E repository",
        },
      ],
    }),
  });
  return (await res.json()) as { id: string; title: string };
}

async function getIssue(api: TestApiClient, id: string): Promise<IssueRecord> {
  const res = await authedFetch(api, `/api/issues/${id}`);
  return (await res.json()) as IssueRecord;
}

async function deleteProject(api: TestApiClient, id: string) {
  await authedFetch(api, `/api/projects/${id}`, { method: "DELETE" });
}

function makeCsrfToken(authToken: string) {
  const nonce = randomBytes(16);
  const sig = createHmac("sha256", authToken).update(nonce).digest("hex");
  return `${nonce.toString("hex")}.${sig}`;
}

function statusColumn(page: Page, title: string): Locator {
  const status = title === "Backlog" ? "backlog" : title === "Todo" ? "todo" : title;
  return page.getByTestId(`board-column-status:${status}`);
}

async function dragCardToColumn(page: Page, cardText: string, columnTitle: string) {
  const source = page.locator("[data-testid^='board-card-']", { hasText: cardText }).first();
  const targetColumn = statusColumn(page, columnTitle).getByTestId(`board-column-droppable-status:${columnTitle === "Backlog" ? "backlog" : "todo"}`);
  await expect(source).toBeVisible();
  await expect(targetColumn).toBeVisible();

  const sourceBox = await source.boundingBox();
  const targetBox = await targetColumn.boundingBox();
  if (!sourceBox || !targetBox) throw new Error("Could not resolve drag coordinates");

  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + 140, { steps: 12 });
  await page.mouse.up();
}

test.describe("Issue status state machine", () => {
  let api: TestApiClient;
  let projectId: string | null = null;

  test.beforeEach(async ({ page }) => {
    api = await createTestApi();
    const token = api.getToken();
    const workspaceSlug = api.getWorkspaceSlug();
    if (!token || !workspaceSlug) throw new Error("E2E login did not produce a token/workspace");
    await page.context().addCookies([
      {
        name: "multica_auth",
        value: token,
        url: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
        httpOnly: true,
        sameSite: "Lax",
      },
      {
        name: "multica_csrf",
        value: makeCsrfToken(token),
        url: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
        sameSite: "Lax",
      },
      {
        name: "multica_logged_in",
        value: "1",
        url: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
        sameSite: "Lax",
      },
    ]);
    await page.goto(`/${workspaceSlug}/issues`);
    await page.waitForURL(`**/${workspaceSlug}/issues`, { timeout: 10000 });
  });

  test.afterEach(async () => {
    if (projectId) {
      await deleteProject(api, projectId).catch(() => {});
      projectId = null;
    }
    await api.cleanup();
  });

  test("routes unassigned tasks to backlog and assigned tasks to todo", async ({ page }) => {
    const memberId = api.getUserId();
    if (!memberId) throw new Error("E2E user id was not captured");

    const project = await createProject(api, `E2E 状态机项目 ${Date.now()}`);
    projectId = project.id;

    const unassignedTitle = `E2E 未分配待规划 ${Date.now()}`;
    const assignedTitle = `E2E 已分配待办 ${Date.now()}`;

    const unassigned = await api.createIssue(unassignedTitle, {
      project_id: project.id,
      responsible_user_id: memberId,
      allow_duplicate: true,
    }) as IssueRecord;
    const assigned = await api.createIssue(assignedTitle, {
      project_id: project.id,
      responsible_user_id: memberId,
      assignee_type: "member",
      assignee_id: memberId,
      allow_duplicate: true,
    }) as IssueRecord;

    expect(unassigned.status).toBe("backlog");
    expect(assigned.status).toBe("todo");

    await page.reload();
    await expect(statusColumn(page, "Backlog").getByText(unassignedTitle)).toBeVisible();
    await expect(statusColumn(page, "Todo").getByText(assignedTitle)).toBeVisible();

    await dragCardToColumn(page, unassignedTitle, "Todo");
    await expect(page.getByText("Please assign the task first.")).toBeVisible({ timeout: 10000 });

    const blockedMove = await getIssue(api, unassigned.id);
    expect(blockedMove.status).toBe("backlog");
    expect(blockedMove.assignee_type).toBeNull();
    expect(blockedMove.assignee_id).toBeNull();

    await dragCardToColumn(page, assignedTitle, "Backlog");
    await expect(statusColumn(page, "Backlog").getByText(assignedTitle)).toBeVisible({ timeout: 10000 });

    const movedBack = await getIssue(api, assigned.id);
    expect(movedBack.status).toBe("backlog");
    expect(movedBack.assignee_type).toBeNull();
    expect(movedBack.assignee_id).toBeNull();
  });
});
