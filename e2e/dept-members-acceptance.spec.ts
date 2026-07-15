import { expect, test } from "@playwright/test";
import { TestApiClient } from "./fixtures";

type DeptSyncCounts = {
  counts: {
    departmentSearch: number;
    departmentUsers: number;
    userSearch: number;
    userDepartments: number;
  };
  users: Array<{ username: string; user_id: string; universal_id: string }>;
};

async function getDeptSyncCounts(): Promise<DeptSyncCounts> {
  const res = await fetch("http://127.0.0.1:18099/__counts");
  if (!res.ok) {
    throw new Error(`dept-sync mock counts failed: ${res.status}`);
  }
  return res.json() as Promise<DeptSyncCounts>;
}

test.describe("dept member acceptance", () => {
  test("adds a searched dept user from submitted snapshot without remote resolve", async ({ page }) => {
    test.setTimeout(90_000);

    const api = new TestApiClient();
    await api.login("e2e@multica.ai", "E2E User");
    const workspace = await api.ensureWorkspace("E2E Workspace", "e2e-workspace");
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const browserLogin = await page.evaluate(async () => {
      const res = await fetch("/auth/verify-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "e2e@multica.ai", code: "888888" }),
      });
      return { ok: res.ok, status: res.status, text: await res.text() };
    });
    expect(browserLogin.ok, browserLogin.text).toBe(true);

    const { users } = await getDeptSyncCounts();
    const deptUser = users[0];
    if (!deptUser) {
      throw new Error("dept-sync mock returned no users");
    }

    await page.goto(`/${workspace.slug}/members`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /^Members \(\d+\)$/ })).toBeVisible();

    await page.getByPlaceholder(/employee name/i).fill(deptUser.user_id);
    await expect(page.getByText(`${deptUser.username}(${deptUser.user_id})`)).toBeVisible();
    await page.getByRole("checkbox", { name: new RegExp(deptUser.username) }).check();

    const beforeAdd = await getDeptSyncCounts();
    await page.getByRole("button", { name: /add selected/i }).click();

    const main = page.getByRole("main");
    await expect(main.getByText("Added 1 members. Skipped 0.")).toBeVisible();
    await expect(main.getByText(`${deptUser.username}(${deptUser.user_id})`)).toBeVisible();

    const afterAdd = await getDeptSyncCounts();
    expect(afterAdd.counts.userSearch).toBe(beforeAdd.counts.userSearch);
    expect(afterAdd.counts.userDepartments).toBe(beforeAdd.counts.userDepartments);
  });
});
