# 子任务拆分与展示——设计访谈完整记录

> 基于 `docs/workflows/dag.md` 的 32 轮设计访谈，覆盖 36 个问题，每项含选项对比、竞品参考与决策依据。
> 精简版见 `docs/workflows/dag-design-decisions.md`。

---

## 问题 1：拆分触发的边界

<details open>
<summary><b>结论：C → 后修正为配置驱动</b></summary>

**原始选项**：
- A) 模板预定义静态拆分节点，执行时按固定逻辑拆分
- B) Agent 运行时动态决定拆不拆、拆几个
- C) 两者结合——模板声明哪些节点可拆分，Agent 决定实际粒度

**初始决策**：C（模板声明意图 + Agent 决定粒度）

**修正**：后续访谈中用户明确纠正——不使用 Agent 拆分，改为固定配置驱动。拆分节点在模板中预配置，执行时引擎确定性展开。

**修正后结论**：节点激活后无条件执行 + 可选 `condition` 表达式 + 可选 `require_approval` 审批开关。

**竞品参考**：n8n 走配置驱动（Execute Workflow 节点），Dify 的拆分是静态的分组折叠，FlowGram 的 Loop 容器也是配置驱动。三家均不依赖 Agent 做拆分决策。

**理由**：Agent 参与拆分决策引入了不可复现性——同样的模板、同样的输入，两次执行可能产出不同的子任务。拆分应该是确定性的，让模板作者在设计时就能预测运行时行为。
</details>

---

## 问题 2：拆分结果如何影响父 DAG 拓扑

<details open>
<summary><b>结论：C（barrier / pipeline 混合）</b></summary>

**选项**：
- A) fan-out/fan-in：下游被阻塞，全完成才继续
- B) pipeline：每个子任务独立走完，父节点出边复制给每个子
- C) 混合模式，模板配置 `strategy: "barrier" | "pipeline"`

**决策**：C

**竞品参考**：n8n 的 Execute Workflow 可以选 "Wait for sub-workflow to finish"（barrier） 或 fire-and-forget（pipeline）。Dify 的并行节点默认 barrier。FlowGram 的 Loop 是 barrier 模式。

**理由**：
- 有些场景（并行代码审查→汇总）需要全部完成再继续
- 有些场景（对每个依赖仓库分别发 PR）每个子任务独立走完全流程更合理
- 如果只能选一种，两种场景总有一个被伤害。显式声明策略成本很小（一个枚举），灵活性能覆盖两类核心场景
</details>

---

## 问题 3：子 Workflow 的模板来源

<details open>
<summary><b>初始结论：C → 与 Q15 统一修正为 B</b></summary>

**原始选项**：
- A) 父节点绑定同一模板
- B) Agent 动态选择
- C) 父模板内联子 DAG 片段

**初始决策**：C（子图是父模板的内联扩展）

**修正**：与 Q15 统一后改为 B——拆分节点引用已有独立模板（`child_template_id`），不再内联定义子图。

**最终理由**：引用已有模板最大复用现有模板体系（`is_template`、`source_template_id`、克隆逻辑），子模板可被多个拆分节点复用，编辑隔离，可独立版本管理。内联子图需要在模板编辑器中引入"画布中的画布"，交互复杂度指数增长。
</details>

---

## 问题 4：嵌套深度限制

<details open>
<summary><b>结论：C（模板级可配置上限 + 运行时降级）</b></summary>

**选项**：
- A) 硬限制（如 3 层）
- B) 无限制 + 软约束
- C) 模板级 `max_depth` + 运行时降级/告警

**决策**：C，默认深度 3

**竞品参考**：
- n8n：无硬限制，靠用户设计逻辑 + Agent `maxIterations` + 内存/执行时间作为软约束。支持真正的递归子工作流（Towers of Hanoi 示例）
- Dify：硬限制 5 层（`WORKFLOW_CALL_MAX_DEPTH`），可 env 配置。不支持递归。并行嵌套限 3 层（`WORKFLOW_PARALLEL_DEPTH_LIMIT`）

**理由**：
- A 过于僵硬——复杂场景确实需要更深层级
- B 有风险——无限嵌套可能导致执行爆炸（指数级子任务），也增加了调试和理解难度
- C 给了模板作者控制权，默认 3 层覆盖绝大多数场景。Dify 的硬限制和 n8n 的灵活性各取一半
</details>

---

## 问题 5：运行时实例与模板的隔离机制

<details open>
<summary><b>结论：B（版本引用）</b></summary>

**选项**：
- A) 快照复制（snapshot）
- B) 版本引用（version pinning）
- C) 混合——结构快照 + 逻辑版本引用

**决策**：B

**理由**：
- A 的完整快照最简单，但 Workflow 运行期间模板迭代多版后，快照变成"活化石"，审计追溯困难
- C 引入了"部分热更新"概念，增加了复杂度但收益有限
- B 是业界验证过的模式（Temporal、Airflow 都走版本引用）：模板是活的，版本是不可变的，关系清晰，审计友好
</details>

---

## 问题 6：子 DAG 的默认展示模式

<details open>
<summary><b>结论：A（扁平主图 + 聚合摘要）</b></summary>

**选项**：
- A) 扁平主图 + 聚合徽章，点击展开
- B) 全展开内联视图
- C) 上下文自适应

**决策**：A

**理由**：
- B 的"全展开"在 3 层嵌套 × 每个拆分 5 个子任务时画布上可能有几十上百个节点，信息过载
- C 的"自适应"让用户无法预测界面——每次打开同一 Workflow 展开状态不同，增加认知负担
- A 是渐进式信息披露的标准模式：先给全貌，按需深入。Grafana、Jaeger、GitHub Actions 矩阵构建都这样干
</details>

---

## 问题 7：拆分节点的汇总状态计算规则

<details open>
<summary><b>结论：C（策略跟随汇聚策略）</b></summary>

**选项**：
- A) 最差优先（pessimistic）
- B) 多数决（majority）
- C) 跟随 Q2 的汇聚策略

**决策**：C

**理由**：
- `barrier` 节点天然意味着"一个都不能少" → 有任一失败 = 节点失败（最差优先）
- `pipeline` 节点意味着"各走各的" → 子任务失败不传染父节点，多数决更合理
- 同一个策略枚举（barrier / pipeline）同时决定拓扑行为和状态颜色，用户心智模型一致
</details>

---

## 问题 8：展开子 DAG 的交互模式

<details open>
<summary><b>结论：B（原地展开/折叠）</b></summary>

**选项**：
- A) 浮层/侧面板
- B) 原地内联展开/折叠
- C) 面包屑 navigation drill-down

**竞品参考**：
- **n8n**：Execute Workflow 是黑盒节点。双击打开属性面板而非子图。社区要求 drill-down 三年未果。子工作流 = 跳转到独立页面
- **Dify**：发布工具 = 跳转页面（黑盒）。节点分组 = 原地展开折叠——分组是全栈抽象（含输入/输出契约），展开后嵌套渲染
- **Coze（FlowGram）**：容器节点（Container Node）。Loop 节点支持完整展开/折叠：折叠态 54px 紧凑条，展开态 225px 子画布。完全原地操作，没有面包屑。子画布用 BlockStart/BlockEnd 标记边界

**决策**：B

**理由**：
- A 的浮层在 3 层嵌套时需要"浮层套浮层"，交互灾难
- C 的面包屑 drill-down 三个竞品无一采用——用户从未离开主画布，不需要"返回"
- B 是三个竞品的一致方向：FlowGram 的容器模式是最成熟的参考实现。折叠态足够紧凑不会画布爆炸，展开态保留上下文
</details>

---

## 问题 9：子任务状态的实时传播机制

<details open>
<summary><b>结论：C（WS + Query Cache 失效）</b></summary>

**选项**：
- A) 轮询
- B) 显式事件推送/订阅
- C) 数据库触发器 + 缓存失效

**决策**：C

**理由**：
- A 的轮询在已有 WebSocket 架构的 Multica 中是倒退
- B 的显式订阅机制引入了新的耦合——父 Workflow 需要显式知道子 Issue 的存在并订阅它们。拆分是动态的，订阅管理会很复杂
- C 利用了已有的 TanStack Query + WS 失效机制（CLAUDE.md 明确说了 WS events invalidate queries）。子 Issue 状态变化 → WS 广播 `issue:updated` → 父 Workflow 的汇总查询自动失效 → 重取重新计算。不需要新增任何通道，完全复用现有架构
</details>

---

## 问题 10：子任务失败时的处理策略

<details open>
<summary><b>结论：C（策略驱动 + 子层独立重试）</b></summary>

**选项**：
- A) 自动重试
- B) 人工介入
- C) 策略驱动：barrier 阻断、pipeline 独立

**决策**：C

**关键补充**：每个子 Issue 自身可以独立配置重试策略（子 Workflow 模板的 `retry_policy`），重试是子层面的行为，不影响父的汇聚判断。父节点只看子 Issue 的**终态**（重试耗尽后仍失败 → 就是失败）。

**理由**：
- A 只处理了重试，没回答"重试耗尽后怎么办"
- B 的"暂停等人工"对于 pipeline 模式过于激进——一个子任务失败应该不阻塞整条线
- C 最灵活：barrier → 一个失败阻断全部，pipeline → 单独标记失败通知相关人
</details>

---

## 问题 11：Agent 拆分决策的输入与约束

<details open>
<summary><b>❌ 作废</b></summary>

原讨论了 Agent 拆分时的约束（维度指令、`max_splits`、资源配额），后因修正为配置驱动而作废。
</details>

---

## 问题 12：子 Issue 的创建时机与可见性

<details open>
<summary><b>结论：A（一次性批量创建）</b></summary>

**选项**：
- A) 一次性批量创建
- B) 懒加载/流式创建
- C) 批量预创建 + 流式补充

**决策**：A

**理由**：
- B 的流式创建带来了不确定性——父 DAG 的结构在执行过程中动态变化，展示和调试都很难
- C 引入了 `pending_split` 这种中间态，增加了 Issue 状态机的复杂度。"先占坑再填坑"用户体验不友好（看到 10 个空白 Issue 然后一个个消失）
- A 最简洁：配置解析 → 拆分计划 → 批量创建 → 开始调度。创建后结构稳定，不会在执行中变形
</details>

---

## 问题 13：拆分节点的折叠态与展开态分别展示什么信息

<details open>
<summary><b>结论：C（折叠态带关键子任务摘要）</b></summary>

**选项**：
- A) 折叠态最简（仅名称 + 徽章）
- B) 折叠态带迷你进度条
- C) 折叠态带关键子任务摘要（如 `✅ 前端修复 · ❌ 后端部署 · +3 进行中`）

**决策**：C

**理由**：
- A 太稀疏——只看 `3/5` 不知道哪 3 个完成了，需要展开才能获取信息，违背"聚合显示关键进展"的原始需求
- B 的进度条对于小数量（5 个子任务）信息密度不如直接文字摘要
- C 在折叠态就给出有意义的上下文——最近的事件摘要让用户一眼判断"进展顺利吗？"
</details>

---

## 问题 14：父子 Issue 的数据关联模型

<details open>
<summary><b>结论：B（独立关联表）</b></summary>

**选项**：
- A) 单向引用（子 Issue `parent_issue_id`）
- B) 独立关联表 `workflow_node_splits`
- C) 新增 `workflow_split_decision` 中间实体

**现有实现基础**：代码库已有 `parent_issue_id`（父子树查询）+ `(origin_type, origin_id)`（运行时溯源）。文档称"双向关联"，实际是单向引用 + 溯源指针。

**决策**：B

**理由**：
- A 把结构化查询压在 `parent_issue_id + metadata->>'split_node_id'` 上，性能差
- C 增加了额外的中间实体层级，改变了 origin 的语义
- B 最干净：关联表是拆分事件的独立事实记录，不改变现有 Issue 和 NodeRun 模型。两个方向查询都有索引支持。PostgreSQL + sqlc 天然适配
</details>

---

## 问题 15：拆分子 DAG 片段在模板中的定义方式

<details open>
<summary><b>最终结论：与 Q3 统一为 B（引用已有模板）</b></summary>

**与 Q3 的矛盾调和**：
- Q3 初始选了 C（内联子 DAG 片段）→ 子图是父模板的一部分
- Q15 选了 B（引用已有模板）→ 子图是独立模板
- 两个选择语义冲突

**调和过程**：
- 统一走 B（引用模板）：子模板可复用、编辑隔离、版本独立管理、已有模板体系零改动
- 统一走 C（内联片段）：自包含、复制父模板时子图自动带走，但牺牲复用性

**最终决策**：统一走 B。子模板可被多个拆分节点引用，可独立版本控制。不引入"画布中的画布"编辑体验。

**竞品参考**：n8n 就是引用已有 workflow（Execute Workflow 节点选择目标 workflow）。Dify 的发布工具也是引用模式。
</details>

---

## 问题 16：父节点到子模板的参数传递

<details open>
<summary><b>结论：A → 修正为 B（静态/表达式二选一）</b></summary>

**原始选项**：
- A) 子模板声明固定输入槽，调用者填值
- B) 继承父上下文 + 增量覆盖
- C) 显式映射规则

**初始决策**：A（子模板像函数一样声明签名）

**修正**：因取消 Agent 拆分决策，改为：
- 静态列表：`splits: [{title: "...", inputs: {...}}, ...]`
- 表达式模式：`iterate_over: "path.to.array"` + `item_template: {title: "修复 #{item.name}", inputs: {repo: item.repo}}`
- 两种格式互斥，校验时拒绝混用

**理由**：
- 统一表达式语法（静态列表伪装成字面量表达式）可读性差，模板作者不能一眼区分"写死的"还是"动态的"
- 混合模式（静态 + 动态同时存在）场景极窄——如果真需要，可以在同一个 Workflow 里放两个拆分节点
</details>

---

## 问题 17~18：原 Agent 拆分决策相关

<details open>
<summary><b>❌ 作废</b></summary>

Q17（Splitter Agent 的身份）和 Q18（Agent 在引擎中的调用时机）均因取消 Agent 拆分决策而作废。

初始讨论中曾选择"专用内置 Splitter Agent，只规划不执行"，后被用户纠正为固定配置驱动。
</details>

---

## 问题 19：表达式映射的求值机制

<details open>
<summary><b>结论：A（引擎内置 JSONPath 求值器）</b></summary>

**选项**：
- A) 引擎内置 JSONPath 表达式求值器
- B) 通过 `input` 变量系统传递
- C) 专用求值节点

**决策**：A

**理由**：
- B 滥用上下文注入——描述是给人看的长文本，不是给引擎消费的结构化数据
- C 增加了一个强制性的中间节点，小型拆分（如"拆 3 个固定子任务"）也要配置额外节点，编排负担重
- A 轻量且确定性：JSONPath 是成熟标准，对标 n8n 的表达式系统（`{{ $json.repositories }}`），是工作流引擎的标配能力
</details>

---

## 问题 20：拆分节点的 NodeRun 状态机

<details open>
<summary><b>结论：A（有 NodeRun，快速流转）</b></summary>

**选项**：
- A) 有 NodeRun，`pending → processing → completed`（毫秒级）
- B) 有 NodeRun，`monitoring` 直到子 Run 全部终态
- C) 无 NodeRun（纯引擎行为）

**决策**：A

**理由**：
- C 使拆分节点成为 DAG 中的"幽灵"——画在图上但没有执行记录，审计和调试看不到"这里发生了什么"
- B 引入了新状态且与 Q7 的汇总机制功能重叠——汇总徽章已经展示子任务进展，NodeRun 没必要一直 active
- A 最干净：拆分节点有短暂存在的 NodeRun，记录了拆分决策和结果。审计完整，状态机复用
</details>

---

## 问题 21：barrier 模式部分失败时是否取消剩余子任务

<details open>
<summary><b>结论：C（策略可选）</b></summary>

**选项**：
- A) 立即取消所有剩余（fail-fast）
- B) 等待自然结束（drain）
- C) `on_child_failure: "cancel_rest" | "drain"`，默认 cancel_rest

**决策**：C

**理由**：
- fail-fast：前 1 个就失败，后面 4 个跑几十分钟纯浪费→适用依赖链（必须全过）
- drain：5 个并行安全扫描，已完成 3 个，1 个失败，取消还在跑的 2 个丢失了部分扫描结果→适用独立任务
- 配置一个枚举的成本几乎为零，模板作者根据子任务的耦合程度选择。barrier 默认 cancel_rest 是安全选择
</details>

---

## 问题 22：子任务并发控制

<details open>
<summary><b>结论：C（拆分节点 + Workspace 两级限流）</b></summary>

**选项**：
- A) 无限制并发
- B) 全局并发上限
- C) 拆分节点 `max_concurrency` + Workspace 全局上限，取最小值

**决策**：C

**理由**：
- A 的风险明显——拆 50 个全并发，可能超出 Workspace 的 Agent 配额
- B 只解决单节点内并发，但 Workspace 可能有多个 Workflow 同时在跑
- C 是标准的两级限流模式：`min(拆分节点上限, Workspace 剩余 Agent 配额)`。防止单个拆分吃光所有资源，也防止跨 Workflow 争抢
</details>

---

## 问题 23：父 Workflow 取消时的级联行为

<details open>
<summary><b>结论：C（策略可选）</b></summary>

**选项**：
- A) 级联取消一切
- B) 子 Run 独立运行
- C) `on_parent_cancel: "cascade" | "detach"`，默认 cascade

**决策**：C

**理由**：
- barrier 模式：子任务结果必须在父流程中被消费 → cascade 合理。用户说停就应该全停
- pipeline 模式：每个子任务独立发 PR → detach 合理。取消父流程不应该撤回已发的 PR
- 默认 cascade 是安全选择，detach 是高级选项
</details>

---

## 问题 24：子模板被删除/归档时的保护

<details open>
<summary><b>结论：C（级联警告 + 影响范围展示）</b></summary>

**选项**：
- A) 拒绝删除
- B) 允许删除 + 运行时失败
- C) 展示影响范围，用户知情后决定

**决策**：C

**理由**：
- A 太刚性——模板过时了用户应该有权利清理
- B 把错误延迟到运行时——配置时一切正常，执行时突然崩了，体验差
- C 给出了知情权和选择权：告知"此模板被以下 X 个 Workflow 的拆分节点引用"，用户决定。强制删除后运行时失败可接受（用户被警告过）。现有系统已有先例（`CountWorkflowsBySourceTemplate`），扩展到拆分节点引用是自然延伸
</details>

---

## 问题 25：展开态子 DAG 的节点渲染风格

<details open>
<summary><b>结论：C（两级展开）</b></summary>

**选项**：
- A) 展示子模板结构（设计态）
- B) 展示运行实例列表（运行时）
- C) 两级展开：实例列表 → 单实例 DAG 详情

**决策**：C

**理由**：
- A 只有模板结构没有实例区分——5 个子 Run 中 1 个失败，用户需要知道"哪个仓库的修复失败了"，而非"这个模板的代码审查节点挂了"
- B 只有实例列表没有 DAG 预览——用户需要逐个点进去，无法快速比较各子 Run 在同一节点上的进展差异
- C 最完整：先看到"5 个在跑，1 个失败"，展开失败的那个 → 看到它的 DAG → 发现"卡在代码审查节点"。对标但超越 FlowGram 的 Loop 展开——Multica 多了一层 N 个并行实例
</details>

---

## 问题 26：子任务的执行顺序

<details open>
<summary><b>结论：A（全部并行启动）</b></summary>

**选项**：
- A) 全部并行
- B) 顺序执行
- C) 可配置执行策略

**决策**：A

**理由**：拆分的语义是"并行展开"。如果用户需要子任务串行，应该在模板层面设计串行节点，而非靠拆分节点的执行顺序。违反这个假设会引入不必要的复杂度。
</details>

---

## 问题 27：子模板的版本锁定

<details open>
<summary><b>结论：C（默认最新 + 可选锁定）</b></summary>

**选项**：
- A) 始终取最新版本
- B) 锁定到特定版本
- C) 默认浮动最新 + 可选锁定

**决策**：C

**理由**：
- A 和 Q5 的版本隔离决策直接矛盾——Q5 明确说"版本不可变，执行时不受模板变更影响"
- B 过于激进——很多场景下子模板的小修补（改 prompt）确实应该自动应用到后续执行
- C 和 Q5 的版本引用模型一致：执行时创建 WorkflowRun 瞬间锁定版本。默认浮动让迭代友好，可选锁定让关键流程稳定
</details>

---

## 问题 28：子任务输出如何向上反馈

<details open>
<summary><b>结论：C（专用汇总节点 + API 查询）</b></summary>

**选项**：
- A) 父流程不感知子产出
- B) 子产出自动聚合到拆分节点 output
- C) 专门的汇总节点通过 API 查询

**决策**：C

**理由**：
- A 太局限——"代码审查拆成 5 个，汇总结果生成报告"是很自然的后续步骤
- B 的风险：拆 50 个，每个产出 10KB → 500KB JSONB。下游用表达式 `node_split.output["xxx"]` 需要知道子任务精确名称，耦合度太高
- C 最灵活：汇总节点通过 `GET /workflow-runs/:runId/child-runs` API 获取结构化数据，支持分页、筛选、排序。不污染 Workflow 变量系统
</details>

---

## 问题 29：手动审批的具体交互（require_approval）

<details open>
<summary><b>结论：A（审批 NodeRun）</b></summary>

**选项**：
- A) 创建审批 NodeRun（`awaiting_approval` 状态）
- B) Issue 评论 + 按钮
- C) 专用审批页面 + 通知

**决策**：A

**理由**：
- B 把审批混在评论流中，容易被刷下去，审批状态不好追踪
- C 引入全新审批页面，过度设计了一个低频操作
- A 最自然：NodeRun 状态机已有 `awaiting_input` 等"等待人操作"状态，`awaiting_approval` 是同一模式。审批人看到待办（`ListMyWorkflowTasks`），操作后 NodeRun 继续流转。所有审批记录在 NodeRun 审计历史中
</details>

---

## 问题 30：现有 `createWorkflowSubIssue` 逻辑的改造策略

<details open>
<summary><b>结论：A（拆分节点走独立分支）</b></summary>

**选项**：
- A) 拆分节点特殊路径：`executeSplitNode` 独立分支
- B) 拆分节点也创建代理子 Issue
- C) `StartRunForIssue` 遍历时跳过拆分节点

**决策**：A

**理由**：
- B 的代理 Issue 让 Issue 树多了一层无独立价值的中间节点
- C 使得创建流程不完整——后续 dispatch、状态同步都需要另做处理
- A 最干净：保持现有逻辑不变（不破坏已有的正确行为），拆分节点走独立分支。拆分 NodeRun 记录执行过程，关联表记录拆分结果，子 Issue 通过 `parent_issue_id` 挂在父 Issue 下
</details>

---

## 问题 31：父 Issue 详情页的子任务展示

<details open>
<summary><b>结论：C（嵌入式 Workflow 进度面板）</b></summary>

**选项**：
- A) 复用子 Issue 面板（和手动创建的子 Issue 混在一起）
- B) 独立的"工作流子任务"区域
- C) 嵌入式 Workflow 进度面板（拆分节点名称 + 汇总状态 + 可展开子任务列表）

**决策**：C

**理由**：
- A 混淆了手动创建和 Workflow 产生的子 Issue——两种不同性质的子 Issue 混在一起，用户无法区分来源
- B 的独立区域是改进但仍是纯 Issue 列表——缺少 Workflow 上下文
- C 把"拆分节点"作为语义单元嵌入父 Issue 详情——用户看到的不只是子 Issue 列表，而是"代码审查（拆分节点）：3/5 完成"，可展开看细节。和 Q6（折叠聚合）哲学一致——先摘要，再细节。对标 Linear 的 Git automations 面板
</details>

---

## 问题 32：子 Issue 的 `assignee_type` 和首节点处理

<details open>
<summary><b>结论：A（直接设为 workflow）</b></summary>

**选项**：
- A) `assignee_type = "workflow"`，handler 自动创建子 WorkflowRun
- B) 手动调用 `StartRunForIssue`
- C) 设 workflow 但跳过重复校验

**决策**：A

**理由**：
- B 增加不必要的流程分裂——手动调用而非走 handler，逻辑分散
- C 提到的校验问题应在拆分节点执行时预防——选择子模板时就校验可用性
- A 最大化复用：子 Issue → `assignee_type = "workflow"` → handler 自动创建 WorkflowRun → 子 Workflow 每个 Node 创建 NodeRun → 如果子 Workflow 内又有拆分节点，继续递归。整条链走同一套逻辑
</details>

---

## 问题 33：表达式求值返回空数组时的行为

<details open>
<summary><b>结论：A（completed，0 个子任务也算成功）</b></summary>

**选项**：
- A) completed（合法结果）
- B) failed（空数组视为异常）
- C) skipped（被跳过）

**决策**：A

**理由**：
- B 的"空数组就是异常"假设不合理——许多场景下"没有要处理的项"是正常业务结果（代码扫描没发现任何问题仓库，自然就没有子任务）
- C 的 skipped 语义是"被外部决策绕过"，而非"正常执行后产出 0 个"
- A 最自然：拆分计划生成结果是 0 个——这是合法输出。NodeRun 输出记录 `{"splits_count": 0, "reason": "no items in array"}`
</details>

---

## 问题 34：拆分节点在 `workflow_node` 表中的扩展方式

<details open>
<summary><b>结论：A（新增 node_type + JSONB 配置列）</b></summary>

**选项**：
- A) 新增 `node_type` 枚举 + `split_config` JSONB 列
- B) 复用 `format_schema` JSONB
- C) 新建独立配置表

**决策**：A

**理由**：
- B 混用了 `format_schema` 语义——格式约束 vs 拆分配置完全不同的概念，以后维护越来越乱
- C 的独立表过度规范化——配置生命周期和节点完全绑定（1:1）
- A 最直接：`node_type` 是节点的类型鉴别（类似 FlowGram 的 `isContainer`），`split_config` 是类型专属配置。未来有新节点类型（Gateway、Timer），枚举自然扩展
</details>

---

## 问题 35：pipeline 模式下下游的激活时机

<details open>
<summary><b>结论：A（拆分节点 completed 后立即解锁下游）</b></summary>

**选项**：
- A) 创建完子 Issue 立即解锁下游（fire-and-forget）
- B) 每个子任务完成时分别触发下游副本
- C) 自动插入隐式 barrier

**决策**：A

**理由**：
- B 的行为太特殊——下游执行 N 次的语义不明确。如果是"汇总通知"，执行 5 次发 5 条通知不是用户想要的
- C 本质上是 barrier 模式加了层包装，抹掉 pipeline 语义
- A 最符合 pipeline 直觉：拆分节点说"我已经把 N 个任务发出去了，你（下游）不用等它们"。子任务结果通过 Q28 的 API 查询异步聚合。pipeline = fire-and-forget
</details>

---

## 问题 36：表达式求值失败时的处理

<details open>
<summary><b>结论：A（NodeRun → failed，fail-loud）</b></summary>

**选项**：
- A) NodeRun → failed（fail-loud）
- B) 降级为空数组
- C) 暂停等待人工介入

**决策**：A

**理由**：
- B 的静默降级隐藏了真实问题——上游改了输出结构，表达式没跟着更新。0 个子任务无声无息，排查困难
- C 增加了人工介入延迟——表达式错误通常是模板 bug（拼写错误或字段名变更），人工介入不比直接失败 + 修复模板 + 重跑更快
- A 是 fail-loud 原则：表达式错误就是模板 bug，应该让用户知道并修复。和 Q33 的"空数组 = completed"不矛盾——空数组是合法输入，路径不存在是配置错误
</details>

---

## 关键设计争议点

以下是整个访谈中出现过冲突、需要调和或修正的节点：

| 冲突 | 原本走向 | 修正后 | 原因 |
|------|---------|--------|------|
| **Agent vs 配置驱动** | Q1/Q11/Q17/Q18 均基于 Agent 决策设计 | 全部改为配置驱动 | 用户明确纠正，三家竞品无一用 Agent 拆分 |
| **内联 vs 引用模板** | Q3 选 C（内联），Q15 选 B（引用） | 统一为 B（引用） | 两个选择语义冲突，引用模板最大化复用现有体系 |
| **面包屑 vs 原地展开** | 初始推荐 C（面包屑 drill-down） | B（原地展开折叠） | 三家竞品无一用面包屑，FlowGram 验证了原地模式 |
| **状态汇总逻辑** | 独立定义（Q7） | 跟随汇聚策略（Q2） | 同一枚举同时驱动拓扑和颜色，心智模型统一 |
| **子产出反馈** | auto-aggregate vs 不感知 | API 查询 + 汇总节点（C） | 避免超大 JSONB 和强耦合，同时保留聚合能力 |
</details>

---

## 竞品参考汇总

| 维度 | n8n | Dify | Coze (FlowGram) | Multica 选择 |
|------|-----|------|-----------------|-------------|
| 子工作流机制 | Execute Workflow 节点 | 发布工具 / 分组折叠 | 容器节点 | Split Node + 独立模板引用 |
| 拆分决策 | 配置驱动 | 配置驱动（静态分组） | 配置驱动（Loop 容器） | 配置驱动 |
| 深入子流程 | 跳转独立页面（3年feature req） | 工具：跳转 · 分组：展开 | 原地展开折叠 | 原地展开折叠 |
| 嵌套深度 | 无硬限制（软约束） | 硬限制 5 层（env可配） | 支持递归嵌套 | 默认 3 层，可配置 |
| 展开态 | N/A（黑盒） | 接口契约 / 内联渲染 | 54px 折叠 / 225px 展开 | 实例列表 + 单实例 DAG |
| 面包屑 | 无 | 无 | 无 | 无——原地展开不需导航 |
| 状态聚合 | 无原生机制 | 树状日志 + 分组折叠 | 容器节点徽章 | barrier/pipeline 语义 + Cache |
| 并发控制 | 无（同一worker） | 并行嵌套限 3 层 | Loop items 并行 | 拆分节点 + Workspace 两级 |
</details>
