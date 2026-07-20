import { mkdir, writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { loginAsDefault } from "./helpers";

test("verify workflow role create to edit", async ({ page }) => {
  const caseId = process.env.MULTICA_CASE_ID ?? "workflow-role-create-edit";
  const artifactDir =
    process.env.MULTICA_ARTIFACT_DIR ?? `${process.cwd()}/artifacts/e2e/${caseId}`;
  const roleName = `E2E UI Role ${caseId}`;
  const roleDescription = "Created through the workflow role settings UI.";
  const updatedName = `${roleName} Updated`;
  const updatedDescription =
    "Edited through the workflow role settings UI and verified after reload.";
  const consoleErrors: string[] = [];
  const apiEvidence: Record<string, unknown> = {};

  await mkdir(artifactDir, { recursive: true });
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  const slug = await loginAsDefault(page);
  await page.goto(`/tasks/${slug}/settings?tab=roles`);
  await page.waitForURL("**/tasks/*/settings?tab=roles");
  await expect(
    page.getByRole("heading", { name: /Workflow Roles|Workflow 角色/ }),
  ).toBeVisible();
  await page.screenshot({ path: `${artifactDir}/01-roles-initial.png`, fullPage: true });

  let createdRoleId = "";
  try {
    await page.locator("#workflow-role-name").fill(roleName);
    await page.locator("#workflow-role-description").fill(roleDescription);
    const createResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes("/workflow-roles") &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: /Create role|创建角色/ }).click();
    const createResponse = await createResponsePromise;
    apiEvidence.create = { url: createResponse.url(), status: createResponse.status() };
    expect(createResponse.ok()).toBeTruthy();

    const createdRow = page.locator("article").filter({ hasText: roleName });
    await expect(createdRow).toContainText(roleDescription);
    await page.screenshot({ path: `${artifactDir}/02-role-created.png`, fullPage: true });

    const workspaces = await page.evaluate(async () => {
      const response = await fetch("/api/workspaces", { credentials: "include" });
      if (!response.ok) throw new Error(`workspace readback failed: ${response.status}`);
      return response.json();
    });
    const workspace = (workspaces as Array<{ id: string; slug: string }>).find(
      (item) => item.slug === slug,
    );
    expect(workspace).toBeTruthy();

    const createdRoles = await page.evaluate(async (workspaceId) => {
      const response = await fetch(`/api/workspaces/${workspaceId}/workflow-roles`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error(`role readback failed: ${response.status}`);
      return response.json();
    }, workspace!.id);
    const createdRoleList = Array.isArray(createdRoles) ? createdRoles : createdRoles.roles;
    const createdRole = createdRoleList.find(
      (role: { name: string }) => role.name === roleName,
    );
    expect(createdRole).toMatchObject({
      name: roleName,
      description: roleDescription,
      is_builtin: false,
    });
    createdRoleId = createdRole.id;
    apiEvidence.createdReadback = createdRole;

    await createdRow.getByRole("button", { name: /Edit|编辑/ }).click();
    await createdRow.getByLabel(/Role name|角色名称/).fill(updatedName);
    await createdRow.getByLabel(/Responsibilities|职责描述/).fill(updatedDescription);
    const updateResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes(`/workflow-roles/${createdRoleId}`) &&
        response.request().method() === "PUT",
    );
    await createdRow.getByRole("button", { name: /Update role|更新角色/ }).click();
    const updateResponse = await updateResponsePromise;
    apiEvidence.update = { url: updateResponse.url(), status: updateResponse.status() };
    expect(updateResponse.ok()).toBeTruthy();

    const updatedRow = page.locator("article").filter({ hasText: updatedName });
    await expect(updatedRow).toContainText(updatedDescription);
    await page.reload();
    await expect(page.locator("article").filter({ hasText: updatedName })).toContainText(
      updatedDescription,
    );
    await page.screenshot({ path: `${artifactDir}/03-role-after-reload.png`, fullPage: true });
  } finally {
    if (createdRoleId) {
      const cleanupRow = page.locator("article").filter({ hasText: updatedName });
      if (await cleanupRow.count()) {
        await cleanupRow.getByRole("button", { name: /Delete|删除/ }).click();
        const deleteResponsePromise = page.waitForResponse(
          (response) =>
            response.url().includes(`/workflow-roles/${createdRoleId}`) &&
            response.request().method() === "DELETE",
        );
        await page
          .getByRole("alertdialog")
          .getByRole("button", { name: /Delete|删除/ })
          .click();
        const deleteResponse = await deleteResponsePromise;
        apiEvidence.cleanup = { url: deleteResponse.url(), status: deleteResponse.status() };
        expect(deleteResponse.ok()).toBeTruthy();
      }
    }
    await writeFile(
      `${artifactDir}/api-evidence.json`,
      `${JSON.stringify(apiEvidence, null, 2)}\n`,
    );
    await writeFile(
      `${artifactDir}/console-errors.json`,
      `${JSON.stringify(consoleErrors, null, 2)}\n`,
    );
  }
});
