import { test, expect } from "@playwright/test";
import { loginAsDefault } from "../helpers";

// Builtin agent 项目经理 binds plugin_name=cospowers-task-planning, but its
// plugin_id is a stale reference-env UUID (migration 124) that 404s in the
// current catalog. After the by-slug fallback (useBoundPlugin) + the backend
// list fix (ListBuiltinPlugins → /api/items?type=plugin), the agent detail
// page must render the bound plugin, NOT the "已失效" banner.
test("builtin agent plugin renders via slug fallback (not 已失效)", async ({ page }) => {
  const slug = await loginAsDefault(page);
  // 项目经理 builtin agent (fixed UUID from migration 124).
  await page.goto(`/${slug}/agents/4348e20d-eadc-4095-ac7a-cd480e927375`);

  // The stale banner reads "已失效（xxxxxxxx）...该插件已从市场中移除...".
  // It must NOT appear once the list carries the plugin and the hook falls
  // back to plugin_name.
  await expect(page.getByText("已失效")).not.toBeVisible({ timeout: 20000 });

  // Visual proof: dump a screenshot for manual confirmation.
  await page.screenshot({ path: "plugin-agent-detail.png", fullPage: true });
});
