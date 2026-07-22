# 交付物 repo 内路径与评审存储布局

| 日期 | 2026-07-22 |
|---|---|
| 分支 | `feat/deliverable-git-storage` |
| 关联 SoT | `design-docs/企业AI编程协作平台/multica基于git server实现交付物管理的设计方案.md` §3.2（本规范细化 / 修订之） |
| 状态 | 设计定稿，待实现授权 |

## 1. 动机

SoT §3.2 的 Gitea 拓扑四层（org / repo / inst / node-branch）全用 UUID 前 8 hex 派生。这在**长生命周期对象**（workspace / workflow / workflow-run）上是合理的——防改名漂移、防中文 escape。但落到 **repo 内部的 `nodes/` 目录与文件**时，纯 hex（`nodes/3b3c43b4/a1b2c3d4.md`）对在 Gitea UI 浏览仓库的人完全不可读。

本规范把"可读性"加到 repo 内部路径，并新增**评审意见的 git 归档存储**（SoT 未覆盖，评审原本只在 multica 云端）。三条原则：

1. repo 名 / 分支名仍 strict ASCII（Gitea 硬限），UUID 派生不变。
2. repo 内**目录 / 文件路径**放开 UTF-8（中文保留），用"序号 + 人类可读名"。
3. 评审意见在 multica UI 写，server 归档进 git 当**只读审计副本**；评审决定仍存 multica（§3.3 边界不变）。

## 2. 两套清洗规则

| 规则 | 适用 | 行为 |
|---|---|---|
| `escapeDefSlug`（已有，strict） | org / repo / inst / node 分支名 | 小写；非 `[a-z0-9._-]` → `_`；CJK → `_` |
| `sanitizePathSeg`（新增，轻清洗） | repo 内目录 / 文件名段 | 保留 CJK + 字母数字 + `.-_`；空格 / `/` / 控制符 / shell 特殊符（`` ` `` `$` `"` `<` `>` `|` `*` `?` `\` `[` `]` `{` `}` `(` `)` `~` `^` `&` `;`）→ `-`；合并连续 `-`；去首尾 `-`；结果空 → 返回 `""`（调用方回退） |

## 3. 完整路径层

```
t-<wsShort>/wf-<wfShort>                   org / repo（UUID，不变）
└── inst-<runShort>                         run 实例分支（UUID，不变）
    └── nodes/
        └── <NN>-<nodeTitle>-<nodeRunShort>/
            ├── <deliverableTitle>.md
            ├── <deliverableTitle>.md
            └── reviews/
                ├── <RR>-<reviewer>-通过.md
                └── <RR>-<reviewer>-驳回.md
```
临时分支（合并后删）：`node/<NN>-<nodeRunShort>`

示例：

```
t-6aacc277/wf-cd431ac0
└── inst-3b3c43b4
    └── nodes/
        └── 03-需求分析-3b3c43b4/
            ├── 设计文档.md
            ├── API规范.md
            └── reviews/
                ├── 01-张三-驳回.md
                └── 02-张三-通过.md
```

## 4. 各段细则

| 段 | 来源 | 规则 |
|---|---|---|
| `<NN>`（节点序号） | `workflow_node.sort_order` | 1-based，2 位 zero-pad（`03`）；run 启动冻结进 node-run；>99 节点扩宽 |
| `<nodeTitle>` | `workflow_node.title` | `sanitizePathSeg`；空 → 省略段，目录退化为 `<NN>-<nodeRunShort>` |
| `<nodeRunShort>` | `workflow_node_run.id` 前 8 hex | 定位本次执行；与现有 `DeliverablePath` 一致（**待确认**是否改用 node 定义 ID） |
| `<deliverableTitle>` | `workflow_node_deliverable.title` | `sanitizePathSeg`；**不加 ID 后缀**，原名即文件名 |
| `<RR>`（评审轮次） | 该 node-run 的评审动作计数 | 1-based，2 位 zero-pad（`01`） |
| `<reviewer>` | 评审人（member 名） | `sanitizePathSeg`；空 → member short id |
| verdict | 评审决定 | `approved → 通过`、`rejected → 驳回`；机读 enum 进 frontmatter |

## 5. 评审文件格式

`reviews/<RR>-<reviewer>-<verdict>.md`，frontmatter + body：

```markdown
---
round: 1
verdict: rejected            # approved | rejected
reviewer: 张三
reviewer_member: <member short>
reviewed_at: 2026-07-22T10:30:00Z
node_run: 3b3c43b4
deliverables: [设计文档, API规范]
submission: http://localhost:23000/t-6aacc277/wf-cd431ac0/pulls/2
---
## 评审意见
<submission.review_comment 原文>
```

## 6. 落盘机制

- **时机**：每次 `ReviewNodeRun` 动作（approve / reject）后，server 用 admin token 把该轮 review 文件提交到 **inst 分支**。
- **幂等**：同 (node-run, round) 重写 = no-op。
- **决定归属**：approve / rejected 仍以 multica DB 为准（SoT §3.3：人当 critic、无 daemon 也能合 PR）；git 只存意见文本 + 结构化元数据。
- **commit author** = workspace bot；frontmatter 记真实 critic（归属不靠 git author，同交付物提交原则）。
- **中间态**：`rejected` 那轮写 review 时交付物尚未合入 inst（还在开 PR），inst 会短暂"有 review、无交付物"；approve 合并后 inst 齐全。

## 7. 假设与边界

- **评审粒度 = 节点级**：一个 node-run 一轮一条 review 文件（一个总 verdict + 一段意见），文件不带交付物前缀。DB 虽按 submission（每交付物）逐一评，但若同一轮各交付物 verdict 一致（常态），归并为节点级一条；若不一致（罕见），差异写进 body，文件名取该轮主导 verdict。**此项需确认**：评审是节点级（一轮一个总决定）还是按交付物逐一出 verdict？
- **同名碰撞**：同一 node 内两个交付物清洗后同名 → 第二个起追加 `-<deliverableShort>` 区分。
- **node 目录保留 `<nodeRunShort>`**（跨 run / 节点防重）；**交付物文件不加 ID**（node 目录内已隔离，原名足够）。

## 8. 与 SoT 的差异（修订 §3.2）

| 项 | SoT 原值 | 本规范 |
|---|---|---|
| node 分支 | `node/<node_run.id 前8hex>` | `node/<NN>-<nodeRunShort>` |
| repo 内交付物路径 | 未细化（实现为 `nodes/<short>/<short>.md`） | `nodes/<NN>-<title>-<nodeRunShort>/<deliverableTitle>.md` |
| 评审存储 | 无（评审只在 multica 云端） | 新增：意见归档到 `nodes/<node>/reviews/` |

## 9. 未决

1. **"Node ID"**：用 node-run ID（默认，定位本次执行）还是 node 定义 ID？
2. **评审粒度**：节点级 vs 按交付物逐一——决定 review 文件是否需要交付物维度（影响第 7 节假设）。
3. **归档**：本规范并回 SoT design-doc §3.2，还是留在 multica specs 独立维护？
