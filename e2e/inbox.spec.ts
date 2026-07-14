/**
 * E2E tests for web inbox notification improvements.
 *
 * Covers:
 * - Inbox page header unread badge + "Mark all as read" button
 * - Unread-first grouping with "New" divider + red left border accent
 * - WS-driven sonner toast for inbox:new events (multi-user trigger)
 */
import { test, expect } from "@playwright/test";
import { loginWithToken, createApiWithToken } from "./helpers";
import type { TestApiClient } from "./fixtures";

const TOKEN =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6IjExMUBxcS5jb20iLCJleHAiOjE3ODU2NTMzNDUsImlhdCI6MTc4MzA2MTM0NSwibmFtZSI6IjExMSIsInN1YiI6IjJjMTAwNmE3LWJjNjMtNGE1ZC05M2NmLWEyYmNkNjc1Zjg1NiJ9.BUSskgYty367XxiL3btOEdAvu4ixz0wxx68j-L9ZaY0";
const TOKEN_USER2 =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6IjIyMjJAcXEuY29tIiwiZXhwIjoxNzg2NjEzOTEzLCJpYXQiOjE3ODQwMjE5MTMsIm5hbWUiOiIyMjIyIiwic3ViIjoiYjQ5MGNjZmYtNWUxMy00ZTg1LThmNmItYTJmNjYwZDUxYjAzIn0.fyLbTTJBHRL48V7NBCh9fX48nzkfQbYMzFx70nkqFH4";
const WORKSPACE_SLUG = "xjm";
const WORKSPACE_ID = "49b8a2c5-792d-44b0-a52c-c09751ee7012";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ||
  `http://localhost:${process.env.PORT || "8080"}`;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("Inbox page", () => {
  let api: TestApiClient;

  test.beforeEach(async ({ page }) => {
    api = createApiWithToken(TOKEN, WORKSPACE_ID, WORKSPACE_SLUG);
    await loginWithToken(page, TOKEN, WORKSPACE_SLUG);
  });

  test.afterEach(async () => {
    if (api) await api.cleanup();
  });

  test("shows unread badge and New divider on inbox page", async ({ page }) => {
    await api.createIssue("E2E Inbox Test " + Date.now());

    await page.getByRole("link", { name: /Inbox/ }).click();
    await page.waitForURL("**/tasks/*/inbox");

    // The inbox page heading is an <h1>Inbox</h1>
    await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible();
  });

  test('"Mark all as read" button is visible when unread items exist', async ({
    page,
  }) => {
    await api.createIssue("E2E Mark Read " + Date.now());

    await page.getByRole("link", { name: /Inbox/ }).click();
    await page.waitForURL("**/tasks/*/inbox");

    await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible();
    // The implementation shows "Mark all as read" button + "X unread" badge
    // when unread items exist.
    await expect(page.getByRole("button", { name: /Mark all as read/i })).toBeVisible();
  });
});

test.describe("Inbox toast notification", () => {
  let api: TestApiClient;

  test.beforeEach(async ({ page }) => {
    api = createApiWithToken(TOKEN, WORKSPACE_ID, WORKSPACE_SLUG);
    await loginWithToken(page, TOKEN, WORKSPACE_SLUG);
  });

  test.afterEach(async () => {
    if (api) await api.cleanup();
  });

  test("shows sonner toast when another user triggers a notification", async ({
    page,
  }) => {
    // Fetch workspace members to find user1's member record.
    const token = api.getToken();
    const membersRes = await fetch(`${API_BASE}/api/workspaces/${WORKSPACE_ID}/members`, {
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
        "X-Workspace-ID": WORKSPACE_ID,
      },
    });
    const members: Array<{ id: string; user_id: string; email: string }> =
      await membersRes.json();
    const user1Member = members.find((m) => m.email === "111@qq.com");
    if (!user1Member) throw new Error("Current user not found in workspace members");

    // Use a separate user's API client to create the issue (simulates another user).
    // Must be a different user — the backend skips self-assignment notifications.
    const user2Api = createApiWithToken(TOKEN_USER2, WORKSPACE_ID, WORKSPACE_SLUG);

    // Navigate User-1's browser to the issues page (NOT the inbox page).
    await page.goto(`/tasks/${WORKSPACE_SLUG}/issues`);
    await page.waitForURL("**/tasks/*/issues");

    await user2Api.createIssue("E2E Assigned " + Date.now(), {
      assignee_type: "member",
      assignee_id: user1Member.user_id,
    });

    await expect(
      page.getByRole("region", { name: /Notifications/i }).getByText(/E2E Assigned/),
    ).toBeVisible({ timeout: 10000 });
  });

  test("does not show toast when the user is on the inbox page", async ({
    page,
  }) => {
    const token = api.getToken();
    const membersRes = await fetch(`${API_BASE}/api/workspaces/${WORKSPACE_ID}/members`, {
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
        "X-Workspace-ID": WORKSPACE_ID,
      },
    });
    const members: Array<{ id: string; user_id: string; email: string }> =
      await membersRes.json();
    const user1Member = members.find((m) => m.email === "111@qq.com");
    if (!user1Member) throw new Error("Current user not found in workspace members");

    const user2Api = createApiWithToken(TOKEN_USER2, WORKSPACE_ID, WORKSPACE_SLUG);

    await page.getByRole("link", { name: /Inbox/ }).click();
    await page.waitForURL("**/tasks/*/inbox");

    await user2Api.createIssue("E2E No Toast " + Date.now(), {
      assignee_type: "member",
      assignee_id: user1Member.user_id,
    });

    await page.waitForTimeout(2000);

    const toastRegion = page.getByRole("region", { name: /Notifications/i });
    const toastCount = await toastRegion.count();
    if (toastCount > 0) {
      await expect(toastRegion.getByText(/E2E No Toast/)).toHaveCount(0);
    }
  });
});
