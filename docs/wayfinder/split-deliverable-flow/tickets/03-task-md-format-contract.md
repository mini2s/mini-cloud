---
wayfinder: ticket
title: task.md 格式契约样例与解析校验规则
type: prototype
status: closed
assignee: wayfinder-session
blocked_by: []
resolved: 2026-01-27
---

## Question

task.md 的精确格式契约：让人在 Gitea web 编辑器里手写/修改都顺手，同时服务端能确定性解析。需要产出一个可供人 react 的具体样例 + 解析/校验规则草案。

已锁定的约束（见 [Charting 决策记录](00-charting-decisions.md)）：

- 每条子 issue 字段：标题 + 描述 + 依赖关系 + 建议指派人（仅人类成员）
- 指派人必须可被服务端按工作区成员解析（display name / email）
- 依赖关系须支持 DAG 表达，解析后过现有 `validateSplitTaskGraph`（无环、无未知依赖、无自依赖）
- 人在 Gitea 纯文本编辑器里手改 → 格式必须容错、错误信息能指到行
- workflow 不进文档

需要定下的开放点：

1. 结构选型：frontmatter 块（YAML）vs 标题节语法（`## 子任务: xxx` + 字段行）vs 表格——给出推荐与 1 个完整样例（≥3 个子任务、含串并行依赖）
2. 每条子任务的稳定 key（幂等/依赖引用用）怎么表达与生成
3. 指派人写法（`assignee: 张三` 还是 `assignee: zhangsan@corp.com`）与歧义处理规则
4. 解析器的错误报告格式（行号 + 原因），供 approve 时刻返回给人
5. 描述正文的边界（markdown 正文到下一个子任务标题为止？）

产出：格式样例文件 + 规则草案，链接到本 ticket（`docs/wayfinder/split-deliverable-flow/assets/task-md-format-proposal.md`），与人逐点 react 后定稿。

## Resolution

定稿文档：[task-md-format-proposal.md](../assets/task-md-format-proposal.md)（含完整样例、解析规则 9 条、字段规则、报错目录、approve 校验流水线）。逐点 react 结果：

1. **结构 = 标题节语法**：每个子任务一个 `## task: 标题` 节；元数据为节首裸 `key: value` 行（`key`/`assignee`/`depends-on` 三个承认字段）；描述正文到下一节或文末。容错护栏：字段名拼错报错给建议、坏 H2 标题报错不静默吞任务、围栏代码块跳过。
2. **key 必填**：`^[a-z0-9][a-z0-9-]{0,62}$`，文档内唯一；兼作物化幂等键（写 split task 行 draft_key 列）。缺省报错带示例，不做标题自动派生。
3. **指派人双写法**：含 @ 按邮箱精确匹配，否则按显示名匹配；无匹配/重名/匹配到非人类 → 全部报错指行并拒绝 approve（不静默降级）。
4. **报错格式**：编号列表（行号+原因+建议）+ 422 `details: [{line, field, message}]`；一次返回全部问题。
