/**
 * 导入"编码任务拆分"工作流种子数据
 *
 * 使用 API 将 e2e/seed-data/coding-task-splitting.ts 中的模板
 * 导入到正在运行的应用中。
 *
 * 用法: node scripts/import-coding-split-seed.mjs
 *
 * 依赖: BACKEND_URL (默认 http://localhost:8081)
 */

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8081";
const API_BASE = `${BACKEND_URL}/api`;
const AUTH_BASE = `${BACKEND_URL}/auth`;

const E2E_EMAIL = "kdemo648@gmail.com";
const E2E_NAME = "kdemo648";
const DEV_CODE = "123456";

// ─────────────────────────────────────────────────────────────
// 种子数据
// ─────────────────────────────────────────────────────────────

const WORKFLOW = {
  title: "编码任务拆分",
  description:
    "将大型编码任务智能拆分为多个子任务并行执行。Agent 分析代码库结构后生成拆分方案，经人工审核后批量创建子任务，各子任务独立执行编码流程，最终汇总验证整体一致性。",
  status: "active",
  max_retries: 3,
  is_template: true,
};

const STAGES = [
  { ref: "analysis", name: "分析规划", description: "Agent 分析代码库结构和依赖关系，生成任务拆分方案", sort_order: 0 },
  { ref: "integration", name: "集成验证", description: "所有子任务完成后，验证集成结果的一致性并生成汇总报告", sort_order: 1 },
];

const NODES = [
  {
    ref: "codebase-analysis", stageRef: "analysis",
    title: "代码库分析",
    description: "Agent 分析当前代码库的模块结构、依赖关系和变更影响范围，产出代码库分析报告，为任务拆分提供上下文依据",
    position_x: 200, position_y: 200, sort_order: 0,
    worker_type: "agent", critic_type: "human",
    format_schema: {
      type: "object",
      properties: {
        modules_affected: { type: "array", items: { type: "object", properties: { name: { type: "string" }, path: { type: "string" }, change_scope: { type: "string", enum: ["full", "partial", "minimal"] }, dependencies: { type: "array", items: { type: "string" } } } } },
        estimated_complexity: { type: "string", enum: ["S", "M", "L", "XL"] },
        suggested_split_strategy: { type: "string" },
      },
      required: ["modules_affected", "estimated_complexity"],
    },
  },
  {
    ref: "task-splitting", stageRef: "analysis",
    title: "任务拆分",
    description: "根据代码库分析结果，智能生成子任务列表。Agent 产出拆分方案，人工审核确认后批量创建子 issue，各子任务并行执行编码 workflow",
    position_x: 600, position_y: 200, sort_order: 1,
    worker_type: "agent", critic_type: "human",
    format_schema: {
      type: "split",
      shape: "rectangle",
      template_id: "task-splitter",
      template_category: "logic",
      split_config: {
        sub_template_id: null,
        mode: "barrier",
        max_concurrency: 5,
        max_failures: 0,
      },
    },
  },
  {
    ref: "integration-check", stageRef: "integration",
    title: "集成检查",
    description: "所有子任务完成后，Agent 验证各子任务产出的一致性，检查接口兼容性、代码冲突和整体架构完整性",
    position_x: 200, position_y: 200, sort_order: 0,
    worker_type: "agent", critic_type: "human",
    format_schema: {
      type: "object",
      properties: {
        consistency_check: { type: "object", properties: { interface_compatibility: { type: "boolean" }, no_code_conflicts: { type: "boolean" }, architecture_integrity: { type: "boolean" } } },
        issues_found: { type: "array", items: { type: "object", properties: { description: { type: "string" }, severity: { type: "string", enum: ["critical", "major", "minor"] }, related_subtask: { type: "string" } } } },
        overall_status: { type: "string", enum: ["pass", "needs_fix", "fail"] },
      },
      required: ["consistency_check", "overall_status"],
    },
  },
  {
    ref: "summary-report", stageRef: "integration",
    title: "汇总报告",
    description: "生成完整的编码任务执行报告，包含各子任务的完成情况、代码变更摘要、测试覆盖率和遗留问题",
    position_x: 600, position_y: 200, sort_order: 1,
    worker_type: "agent", critic_type: "human",
    format_schema: {
      type: "object",
      properties: {
        subtask_summary: { type: "array", items: { type: "object", properties: { title: { type: "string" }, status: { type: "string" }, files_changed: { type: "number" }, test_coverage_pct: { type: "number" } } } },
        total_files_changed: { type: "number" },
        overall_test_coverage_pct: { type: "number" },
        open_issues: { type: "array", items: { type: "string" } },
        deployment_ready: { type: "boolean" },
      },
      required: ["subtask_summary", "deployment_ready"],
    },
  },
];

const EDGES = [
  { sourceRef: "codebase-analysis", targetRef: "task-splitting" },
  { sourceRef: "task-splitting", targetRef: "integration-check" },
  { sourceRef: "integration-check", targetRef: "summary-report", condition: { type: "check_passed" } },
];

// ─────────────────────────────────────────────────────────────
// 辅助函数
// ─────────────────────────────────────────────────────────────

let token = null;
let workspaceSlug = null;

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function authFetch(path, init = {}) {
  const headers = { "Content-Type": "application/json", ...init.headers };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (workspaceSlug) headers["X-Workspace-Slug"] = workspaceSlug;
  const url = `${API_BASE}${path}`;
  console.log(`  ${init.method || "GET"} ${url}`);
  const res = await fetch(url, { ...init, headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  return res.json();
}

// ─────────────────────────────────────────────────────────────
// 认证流程
// ─────────────────────────────────────────────────────────────

async function login() {
  console.log("\n=== 认证 ===");

  console.log(`  发送验证码到 ${E2E_EMAIL}...`);
  const sendRes = await fetch(`${AUTH_BASE}/send-code`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: E2E_EMAIL }),
  });
  if (!sendRes.ok) {
    if (sendRes.status === 429) {
      console.log("  触发限流，等待 3 秒后重试...");
      await sleep(3000);
      const retryRes = await fetch(`${AUTH_BASE}/send-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: E2E_EMAIL }),
      });
      if (!retryRes.ok) throw new Error(`send-code retry failed: ${retryRes.status}`);
    } else {
      throw new Error(`send-code failed: ${sendRes.status}`);
    }
  }

  console.log(`  验证码: ${DEV_CODE}`);
  const verifyRes = await fetch(`${AUTH_BASE}/verify-code`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: E2E_EMAIL, code: DEV_CODE }),
  });
  if (!verifyRes.ok) {
    throw new Error(`verify-code failed: ${verifyRes.status}`);
  }
  const data = await verifyRes.json();
  token = data.token;
  console.log(`  ✓ 登录成功`);

  if (data.user?.name !== E2E_NAME) {
    await authFetch("/me", { method: "PATCH", body: JSON.stringify({ name: E2E_NAME }) });
  }

  const workspaces = await authFetch("/workspaces");
  const ws = workspaces.find((w) => w.slug === "demo111") || workspaces[0];
  if (!ws) throw new Error("没有找到可用工作区");
  workspaceSlug = ws.slug;
  console.log(`  ✓ 工作区: ${ws.name} (${ws.slug})`);
  return ws;
}

// ─────────────────────────────────────────────────────────────
// 数据导入
// ─────────────────────────────────────────────────────────────

async function importData() {
  console.log("\n=== 导入编码任务拆分模板 ===");

  // 1. 创建 Workflow
  console.log("\n--- 创建 Workflow ---");
  const workflow = await authFetch("/workflows", {
    method: "POST",
    body: JSON.stringify(WORKFLOW),
  });
  console.log(`  ✓ Workflow: ${workflow.title} (id: ${workflow.id})`);

  // 2. 创建 Stages
  console.log("\n--- 创建 Stages ---");
  const stageMap = new Map();
  for (const s of STAGES) {
    const stage = await authFetch(`/workflows/${workflow.id}/stages`, {
      method: "POST",
      body: JSON.stringify({ name: s.name, description: s.description, sort_order: s.sort_order }),
    });
    stageMap.set(s.ref, stage.id);
    console.log(`  ✓ Stage: ${s.name}`);
  }

  // 3. 创建 Nodes
  console.log("\n--- 创建 Nodes ---");
  const nodeMap = new Map();
  for (const n of NODES) {
    const body = {
      title: n.title,
      description: n.description,
      position_x: n.position_x,
      position_y: n.position_y,
      worker_type: n.worker_type,
      critic_type: n.critic_type,
    };
    if (n.format_schema) body.format_schema = n.format_schema;

    const node = await authFetch(`/workflows/${workflow.id}/nodes`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    nodeMap.set(n.ref, node.id);
    console.log(`  ✓ Node: ${n.title}`);

    // 分配到 Stage
    if (n.stageRef) {
      const stageId = stageMap.get(n.stageRef);
      if (stageId) {
        await authFetch(`/workflows/${workflow.id}/nodes/${node.id}/stage`, {
          method: "PUT",
          body: JSON.stringify({ stage_id: stageId }),
        });
      }
    }
  }

  // 4. 创建 Edges
  console.log("\n--- 创建 Edges ---");
  for (const e of EDGES) {
    const sourceId = nodeMap.get(e.sourceRef);
    const targetId = nodeMap.get(e.targetRef);
    if (!sourceId || !targetId) {
      console.warn(`  ⚠ 跳过边 ${e.sourceRef} -> ${e.targetRef} (节点不存在)`);
      continue;
    }
    const body = { source_node_id: sourceId, target_node_id: targetId };
    if (e.condition) body.condition = e.condition;
    await authFetch(`/workflows/${workflow.id}/edges`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    console.log(`  ✓ Edge: ${e.sourceRef} -> ${e.targetRef}`);
  }

  console.log("\n=== 导入完成 ===");
  console.log(`Template: ${workflow.title}`);
  console.log(`ID: ${workflow.id}`);
  console.log(`Stages: ${STAGES.length} | Nodes: ${NODES.length} | Edges: ${EDGES.length}`);
  console.log(`URL: http://localhost:3000/tasks/${workspaceSlug}/workflows/${workflow.id}`);

  // 5. 设置为 template（需要 status=active + can_manage_workflows）
  console.log("\n--- 设置为 Template ---");
  console.log("  ⚠ 创建 API 不支持 is_template，需手动完成以下步骤：");
  console.log(`     a) 连接数据库执行:`);
  console.log(`        UPDATE multica_workflow SET status='active', is_template=TRUE WHERE id='${workflow.id}';`);
  console.log(`        UPDATE multica_user SET can_manage_workflows=TRUE WHERE email='${E2E_EMAIL}';`);
  console.log(`     b) 或通过已授权的 workflow admin 在 UI 上操作`);
  console.log(`\n💡 使用说明:`);
  console.log(`  1. 在画布上选中"任务拆分"节点`);
  console.log(`  2. 在配置面板中设置 split_config.sub_template_id 为子任务使用的 workflow 模板 ID`);
  console.log(`  3. 可根据需要调整 mode (barrier/pipeline)、max_concurrency、max_failures`);
}

// ─────────────────────────────────────────────────────────────
// 运行
// ─────────────────────────────────────────────────────────────

async function main() {
  try {
    await login();
    await importData();
  } catch (err) {
    console.error(`\n❌ 导入失败: ${err.message}`);
    process.exit(1);
  }
}

main();
