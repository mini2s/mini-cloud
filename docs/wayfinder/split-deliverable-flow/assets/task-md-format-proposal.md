# task.md 格式契约（定稿）

> 对应 ticket: `docs/wayfinder/split-deliverable-flow/tickets/03-task-md-format-contract.md`
> 已锁定约束（charting 决策）：每条子任务 = 标题 + 描述 + 依赖 + 建议指派人（仅人类成员）；workflow 不进文档；人在 Gitea 纯文本编辑器手改 → 格式必须容错、报错指到行。
> 定稿决议（2026-01-27 react 通过）：① 结构 = 标题节语法（裸 `key: value` 元数据行，不用列表项）；② key 必填，不做自动派生；③ 指派人显示名/邮箱双写法 + 三类歧义全部报错指行；④ 报错 = 行号+建议的编号列表 + 422 JSON details。

## 1. 结构选型：标题节语法（已定稿）

| 候选 | 手改容错 | Gitea 渲染 | 解析容错 | 结论 |
|---|---|---|---|---|
| **标题节语法**（每个子任务一个 `## task:` 节） | 好——字段就是纯文本行 | 好——合法 markdown，目录/分节/列表全渲染 | 好——逐行解析，错误可指行 | ✅ 定稿 |
| frontmatter（每任务一个 YAML 块） | 差——缩进敏感，textarea 里极易写坏 | 一般 | 差——YAML 报错定位不友好 | ❌ |
| 表格 | 差——对齐地狱，长描述塞不进单元格 | 好 | 一般 | ❌ |

## 2. 完整样例（3 个子任务，串并行混合依赖）

```markdown
# 拆分计划：迁移所有仓库到新 CI

> 本文件由拆分 agent 生成，可直接编辑；approve 时以本文档最新内容为准。

## task: 迁移 user-service 的 CI 配置
key: user-service-ci
assignee: 张三

为 user-service 仓库编写新 CI 流水线配置：

- 创建 `.ci/pipeline.yml`，包含 build / test / lint 三个阶段
- 缓存策略沿用现有 node_modules 缓存
- 验收：PR 触发流水线全绿

## task: 迁移 order-service 的 CI 配置
key: order-service-ci
assignee: zhangsan@corp.com

同 user-service 的结构。注意：集成测试依赖 docker-compose，runner 需预装。

## task: 迁移 infra 仓库并切换流量
key: infra-cutover
assignee: 李四
depends-on: user-service-ci, order-service-ci

前两个仓库迁移完成后：

1. 更新 infra 仓库的 CI 模板引用
2. 灰度切换 10% 流量观察 24h
3. 全量切换并关闭旧 CI
```

并行（user/order 同时跑）+ 串行（infra 等前两个）的 DAG 由 `depends-on` 表达；无 `depends-on` 的行即无依赖。

## 3. 解析规则（逐条）

1. `# `（H1，可选）= 计划标题，仅展示。
2. `## task: <标题>` 开始一个子任务。容忍：`task`/`任务`/`子任务` 关键字、全角冒号 `：`、大小写不敏感。标题 trim 后必填。
3. 标题行之下的**元数据块**：连续的 `字段: 值` 行，遇空行或非字段行结束。承认字段仅三个：
   - `key`（必填）——稳定 key，见 §4
   - `assignee`（必填）——建议指派人，见 §5
   - `depends-on`（可选）——逗号分隔的 key 列表
4. 元数据块之后到下一个 `## task:` 或文末 = **描述正文**（自由 markdown，trim 后必填非空）。
5. 元数据块位置出现「形似字段但未识别」的行（匹配 `^[A-Za-z][\w-]*:` 但不是三个承认字段）→ **报错并给拼写建议**（如 `keys:` → 「你是想写 key 吗？」）。
6. 任何不匹配 task 前缀的 H2 标题 → **报错**「无法识别的节标题」（防止 `## tasl:` 写坏后被静默吞掉、整个子任务消失）。H3 及以下是描述正文的合法组成部分。
7. 扫描节标题时跳过围栏代码块（```` ``` ````）内的内容——描述里可以放心贴含 `##` 的示例代码。
8. 首个 `## task:` 之前的内容（除 H1）= 计划说明，保留展示但不参与解析。
9. 上限：50 个子任务（沿用现有 ApproveSplit 上限）。

## 4. 稳定 key 规则

- 格式：`^[a-z0-9][a-z0-9-]{0,62}$`（小写字母/数字/连字符，字母开头），文档内**唯一**，必填。
- 用途：① `depends-on` 的引用目标；② 物化幂等键——approve 后写入 split task 行的 `draft_key` 列（现有 `(node_run_id, draft_key)` 部分唯一索引直接提供防重）。
- agent 生成时从标题 slug 化；人手增子任务时需自起一个不冲突的 key（报错信息里带示例）。

## 5. 指派人规则（仅人类成员）

- 写法二选一：**显示名**（`assignee: 张三`）或**邮箱**（`assignee: zhangsan@corp.com`）。含 `@` 按邮箱精确匹配，否则按显示名匹配（去空格、大小写不敏感）。
- 匹配规则与报错：
  - 无匹配 → 「指派人「X」未匹配到工作区成员，可写显示名或邮箱」
  - 多名成员同显示名 → 「「张三」匹配到 2 名成员（zhangsan@corp.com、zhang.san@corp.com），请改用邮箱」
  - 匹配到 agent/squad 名 → 「指派人只能是工作区的人类成员」
- approve 时刻统一硬校验（已锁定决策）：任何一条失败则整体拒绝 approve。

## 6. 依赖规则

- 逗号分隔的 key 列表；允许前向引用（全文解析完后统一校验）。
- 校验（复用 `validateSplitTaskGraph`）：未知 key → 报错并建议最接近的已定义 key；自依赖 → 报错；环 → 报错并指出环上的 key。

## 7. 报错格式（approve 时刻 422）

人类可读渲染（Multica 端展示）：

> **task.md 解析失败（3 个问题）**
> 1. 第 12 行：未知字段「keys」，你是想写「key」吗？
> 2. 第 27 行：指派人「李四」未匹配到工作区成员，可写显示名或邮箱
> 3. 第 34 行：依赖的 key「user-servcie-ci」不存在，你是否指「user-service-ci」（第 5 行定义）？

机器可读载荷（前端可逐行高亮）：

```json
{
  "code": "invalid_task_md",
  "error": "task.md 解析失败（3 个问题）",
  "details": [
    {"line": 12, "field": "keys", "message": "未知字段「keys」，你是想写「key」吗？"},
    {"line": 27, "field": "assignee", "message": "指派人「李四」未匹配到工作区成员，可写显示名或邮箱"},
    {"line": 34, "field": "depends-on", "message": "依赖的 key「user-servcie-ci」不存在，你是否指「user-service-ci」（第 5 行定义）？"}
  ]
}
```

## 8. approve 时刻校验流水线

① 结构解析（§3，行号错误）→ ② 字段语义（key 格式/唯一、标题/描述非空、50 条上限）→ ③ 依赖图（§6）→ ④ 指派人硬校验（§5，查工作区成员）→ 全部通过 → 快照入库（内容 + node 分支 ref + blob SHA）。

## 9. 定稿决议

1. 结构 = 标题节语法，元数据为裸 `key: value` 行（不用 `-` 列表项）。
2. key 必填：缺省报错并带示例，不做标题自动派生。
3. 指派人：显示名/邮箱双写法；无匹配/重名/非人类三类异常全部报错指行、拒绝 approve（不静默降级）。
4. 报错：编号列表（行号+原因+建议）人类可读版 + 422 `details: [{line, field, message}]` 机器可读版；一次返回全部问题。
