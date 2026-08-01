# 效能度量模块国际化迁移计划

> **目标：** 将 `packages/views/efficiency/` 从中文单语言实现迁移到项目现有的 i18next 国际化体系，完整支持 `en` 与 `zh-Hans`，并保持 Web、共享组件、指标口径和现有交互行为不变。
>
> **实施方式：** 单人配合 AI，按阶段迁移和验收。预计完整改造需要 **4～6 个工作日**。

## 1. 背景与现状

效能度量模块在前端迁移阶段保留了大量中文硬编码，目前侧边栏已经具备中英文文案，但模块正文尚未接入 `useT()`。

当前盘点结果：

| 项目 | 规模 |
|---|---:|
| 生产 TS/TSX 文件 | 84 |
| 包含中文运行时文案的文件 | 59 |
| 生产代码量 | 约 2.6 万行 |
| 中文字面量出现次数 | 约 2,047 |
| 去重后的原始中文片段 | 约 1,231 |
| 整理后预计翻译键 | 650～900 |
| 效能模块现有测试 | 27 个 |
| 当前效能模块 `useT()` 接入 | 0 |
| Web 页面入口 | 约 17 个 |

改造量最大的区域：

| 区域 | 中文字面量出现次数 |
|---|---:|
| 运维设置 | 707 |
| 各类详情页 | 487 |
| 使用看板 | 219 |
| 成本看板 | 158 |
| 效能、贡献、公共组件等 | 约 476 |

以上数量包含部分技术标签、示例值和无需翻译的原始数据。实施时需要先分类，不能机械地将所有中文片段直接转成翻译键。

## 2. 迁移目标

### 2.1 覆盖范围

- AI 提效总览
- 效率看板
- 贡献看板
- 成本看板
- 使用看板
- 需求看板
- 活动列表
- Need、Project、Repository、User、User Group、Commit、Task、Workdir 详情
- 模型价格、数据源、同步任务、系统配置
- 平台总览、AI 服务健康度、实时态势、明细查询
- 公共日期、粒度、对象选择、分页、排序、空状态和错误状态
- 图表标题、序列名、图例和 Tooltip
- 指标公式、统计口径和说明文案
- 数字、日期、时长、月份和单位格式化

### 2.2 不翻译范围

- 用户输入内容
- 仓库名、分支名、模型名和数据源名称
- UUID、Request ID、Commit ID 等标识符
- API、SQL、Token、HTTP 等约定保留的缩写
- 服务端原样返回且前端无法可靠分类的错误详情
- schema 状态值及项目术语表要求保留的英文实体名
- mock 数据中模拟用户或业务数据的内容

### 2.3 完成标准

- 英文环境下不再出现非豁免的中文界面文案。
- 简体中文环境保持当前业务含义，不发生指标口径漂移。
- 页面中不显示裸翻译键。
- `en` 与 `zh-Hans` 翻译键通过 parity 测试。
- 语言切换后日期组件、数字、时长、月份和图表标签同步变化。
- 现有筛选、排序、分页、下钻、创建、编辑、删除等交互不回归。
- 英文长文案不会造成关键按钮、Tab、表格或对话框不可用。

## 3. 已锁定的实施原则

### 3.1 命名空间

新增独立的 `efficiency` namespace：

```text
packages/views/locales/en/efficiency.json
packages/views/locales/zh-Hans/efficiency.json
```

不复用现有 `usage` namespace。现有 `usage` 主要服务运行时用量，效能模块中的使用、成本和贡献属于同一业务域，应统一放在 `efficiency` 下。

### 3.2 翻译键结构

遵循项目三层键约定：

```text
efficiency.overview.page_title
efficiency.cost.tabs.member_cost
efficiency.detail.empty.no_commits
efficiency.settings.pricing.create_button
```

重复文案收敛到 `efficiency.common.*`，页面特有文案保留在对应业务段。

### 3.3 组件调用

- 统一使用项目封装的 `useT("efficiency")`。
- 使用类型安全 selector API：`t(($) => $.overview.page_title)`。
- 动态值使用 `{{variable}}` 插值。
- 不将一句话拆成多个翻译片段后拼接。
- 包含 React 强调节点的长句使用结构化节点或 `<Trans>`。
- 复数和数量使用 i18next `_one` / `_other` 规则。

### 3.4 core 与 views 边界

`packages/core/efficiency` 保持 headless：

- core 负责计算、查询、数据结构和纯格式化算法。
- views 负责用户可见文案和 locale-sensitive 展示。
- core 中不得继续新增中文展示标签。
- 需要 locale 的通用格式化函数必须显式接收 locale，不能读取全局环境。

## 4. 已锁定的产品决策

本节决策已结合以下事实锁定，实施时不再逐页重新选择译法：

- 英文 pipeline 文档已经将领域实体写作 `Need`，后端及前端字段统一使用 `need_*`。
- `work_efficiency_ratio` 基于实际活跃工作时间，不等同于员工或组织层面的 workforce productivity。
- `silica` 使用代码指纹匹配，`ai_code_ratio` 使用时间窗口覆盖，两者是不同指标，不能合并翻译。
- 价格配置包含 `system_currency`、`original_currency` 和 `exchange_rate`；货币是业务配置，不是界面语言偏好。

### 4.1 核心术语

| 中文标准写法 | 英文 UI 标准写法 | 技术字段或说明 | 决策 |
|---|---|---|---|
| 需求 | Need / Needs | `need`、`need_id` | `[x]` 英文将 Need 作为领域实体并首字母大写；中文完整翻译为“需求” |
| 日历提效比 | Calendar efficiency | 技术说明可写 calendar efficiency ratio | `[x]` UI 使用较短名称，公式和口径说明保留 ratio |
| 人力提效比 | Effort efficiency | 对应 `work_efficiency_ratio` | `[x]` 不使用 Workforce efficiency，避免被理解为人员绩效 |
| 含硅量（Silica） | Silica | 指纹匹配的 AI 归属代码占比 | `[x]` 保留专有指标名，不翻成 AI-generated code ratio |
| AI 代码占比 | AI code ratio | `ai_code_ratio`，时间窗口覆盖口径 | `[x]` 与 Silica 明确区分 |
| 看板派生口径 | Delivery-derived metric | 基于交付数据，不是平台 Token 消耗 | `[x]` 不使用 Dashboard-derived，避免暗示仅由前端界面计算 |
| 可计入需求 | Eligible Need | `coverage_eligible=true` | `[x]` Need 按领域实体规则大写 |
| 已合并需求 | Merged Need | `status=merged` | `[x]` 状态含义保持不变 |
| 人天 | Person-day | 1 person-day = 480 minutes | `[x]` 数量使用 person-day / person-days |
| 基线预估 | Baseline estimate | `baseline_*` | `[x]` 中文 UI 将“古法预估”“传统预估”统一为“基线预估” |
| 实际周期 | Actual delivery time | `actual_calendar_min` | `[x]` 避免直译为 actual calendar |
| 实际人力 | Actual effort | `actual_work_min` | `[x]` 避免直译为 actual workforce |

术语使用规则：

- 英文短标签使用 `Calendar efficiency` 和 `Effort efficiency`，Tooltip、公式和技术说明可使用完整的 `... ratio`。
- `Need` 在英文产品 UI 中视为领域实体，单数 `Need`、复数 `Needs`；API 和代码字段保持小写 `need`。
- 中文 UI 使用“需求”，不在中文句子中混用 `Need`。
- `Silica` 与 `AI code ratio` 必须使用不同翻译键、Tooltip 和测试断言。
- `Baseline estimate` 表示“不使用 AI 时的预计投入或周期”；中文 Tooltip 首次出现时解释该含义。

### 4.2 货币

锁定策略：**货币跟随后端业务配置，与界面 locale 无关。**

- [x] 使用 `system_currency` 作为汇总成本、人天单价和价格表的展示币种。
- [x] 非系统币种保留 `original_currency` 和 `exchange_rate`，用于价格详情和审计。
- [x] 切换 `en` / `zh-Hans` 不转换金额，不将 CNY 自动改为 USD。
- [x] 金额的分组符号和小数格式跟随界面 locale。
- [x] 货币符号由 ISO currency code 决定；符号有歧义时同时显示 currency code。
- [x] `cost_per_person_day` 视为 `system_currency` 下的单价。
- [x] 修复当前 Hero 区域硬编码 `¥` 的迁移偏差，恢复跟随 `system_currency`。

推荐实现：

```ts
new Intl.NumberFormat(locale, {
  style: "currency",
  currency: systemCurrency,
  currencyDisplay: "narrowSymbol",
}).format(value);
```

### 4.3 数字、日期、时间和单位

- [x] 千分位和小数分隔符跟随界面 locale。
- [x] 百分比的业务口径保持不变；国际化不得改变小数口径与百分比口径的换算。
- [x] API、URL 和查询状态继续使用 `YYYY-MM-DD`，不改变接口契约。
- [x] 表单中的精确日期范围继续显示 ISO 日期，避免跨语言复制和排查时产生歧义。
- [x] Calendar 的月份、星期和无障碍名称跟随界面 locale。
- [x] 图表月份标签本地化，例如英文 `Jul`、中文 `7 月`。
- [x] 现有周聚合边界保持周日开始，不随 locale 改变统计分桶。
- [x] 分钟、小时、人天等单位通过翻译键和复数规则生成，不从 core 拼接中文。
- [x] Token、请求数、代码行等数量使用 locale-aware 数字格式，但原始数值不变。

### 4.4 错误与原始数据

- [x] 前端已知错误、校验提示和空状态完整国际化。
- [x] 服务端返回的原始错误不尝试机器翻译。
- [x] 有原始错误详情时，先显示本地化摘要，再附加原始详情。
- [x] 用户名、部门名、项目名、仓库名、模型名和日志内容保持原样。
- [x] API 字段名、SQL 字段名和导出原始列名保持英文；界面表头可翻译。
- [x] 未知枚举值降级显示原始值，不因缺少翻译导致页面崩溃。

## 5. 分阶段实施计划

## P0：基线与文案分类

预计：0.5 天

- [x] 记录当前分支、工作区状态和已有未提交改动。
- [x] 保留 `efficiency-user-ranking.tsx` 等现有用户改动，不覆盖、不重置。
- [x] 生成效能模块运行时文案清单。
- [x] 将文案分类为：
  - [x] 界面文案
  - [x] 指标名称
  - [x] 统计口径
  - [x] 表单与操作
  - [x] 错误和空状态
  - [x] 原始数据，不翻译
  - [x] 技术标识，不翻译
- [x] 合并重复文案并建立翻译键草案。
- [x] 冻结术语表、货币、日期和错误展示策略。

交付物：

- 术语表
- 翻译键清单
- 页面覆盖矩阵
- 明确的中文硬编码豁免列表

## P1：国际化基础设施

预计：0.5 天

- [x] 新增 `en/efficiency.json`。
- [x] 新增 `zh-Hans/efficiency.json`。
- [x] 在 `packages/views/locales/index.ts` 注册 namespace。
- [x] 在 `packages/views/i18n/resources-types.ts` 注册类型。
- [x] 确认 `packages/views/locales/parity.test.ts` 覆盖新 namespace。
- [x] 建立效能模块统一测试包装方式。
- [x] 增加一组最小的中英文 smoke test，证明资源加载和 selector 类型有效。

验收条件：

- [x] `en` 和 `zh-Hans` 键严格一致。
- [x] TypeScript 能推导 `efficiency` selector。
- [x] 测试环境可以分别渲染中英文。

## P2：移除 core 中的中文展示逻辑

预计：0.5～1 天

重点文件位于 `packages/core/efficiency/utils/`：

- [x] `formatNumber` 不再固定使用 `zh-CN`。
- [x] `formatDuration` 不再直接拼接“分钟、小时、人天”。
- [x] 移除或替代 `GRANULARITY_CN`。
- [x] 时间桶不直接生成“X 月”等中文标签。
- [x] glossary 改为结构化指标定义或稳定 key。
- [x] distribution 返回区间标识和值，不生成中文展示标签。
- [x] Tooltip 常量迁移到 `packages/views/locales/`。
- [x] 检查 mock、queries、types 中的中文，区分界面文案与模拟业务数据。

建议实现：

```text
core:
  duration -> { value, unit }
  granularity -> "day" | "week" | "month"
  glossary -> stable metric key + formula data

views:
  unit -> t(...)
  granularity label -> t(...)
  glossary copy -> t(...)
```

验收条件：

- [x] core 不再决定用户界面语言。
- [x] 计算结果与迁移前一致。
- [x] 百分比、小数、先和后比等指标口径不发生变化。

## P3：公共控件

预计：0.5 天

- [x] 日期范围选择器及快捷区间。
- [x] Calendar locale 随界面语言变化。
- [x] 日、周、月粒度切换。
- [x] 组织、用户、项目、仓库对象选择器。
- [x] 创建项目对话框。
- [x] KPI 和 Scorecard 公共提示。
- [ ] 表格分页、排序、每页数量。
- [ ] 加载、空状态、失败、重试等公共状态。
- [ ] 图表图例和 Tooltip 公共文案。
- [ ] 无障碍 `aria-label` 和 title。

验收条件：

- [ ] 公共组件在两个 locale 下均可独立测试。
- [ ] 后续页面不再重复定义相同文案。

## P4：核心看板

预计：1～1.5 天

按以下顺序迁移：

### P4.1 AI 提效总览

- [ ] 页面标题
- [ ] Hero 指标
- [ ] 平台客观指标
- [ ] Scorecard
- [ ] AI 渗透率
- [ ] 趋势
- [ ] 部门 PK
- [ ] Top 排行
- [ ] 规模概览

### P4.2 效率看板

- [ ] 组织、个人、项目、仓库 Tab
- [ ] 概览、分布子视图
- [ ] 趋势和分布
- [ ] 组织、用户、项目、仓库排行
- [ ] 聚焦视图提示

### P4.3 贡献看板

- [ ] 统计口径说明
- [ ] 组织贡献
- [ ] 用户贡献
- [ ] 项目贡献
- [ ] 仓库贡献
- [ ] 贡献趋势

### P4.4 使用与成本看板

- [ ] 部门树
- [ ] 部门汇总
- [ ] 子部门对比
- [ ] 成员列表
- [ ] 成员明细
- [ ] 模型、Token、请求、成本和缓存指标

### P4.5 需求与活动

- [ ] 需求筛选器
- [ ] 需求表格
- [ ] 异常和覆盖说明
- [ ] 活动列表筛选、分页和表格

验收条件：

- [ ] 核心业务路径英文环境无非豁免中文。
- [ ] 中英文切换不改变筛选、排序和下钻行为。

## P5：详情页

预计：1 天

- [ ] Need 详情
- [ ] Project 详情
- [ ] Repository 详情
- [ ] User 详情
- [ ] User Group 详情
- [ ] Commit 详情
- [ ] Task 详情
- [ ] Workdir 详情
- [ ] 确认删除、编辑、保存和来源管理对话框
- [ ] 详情页表格、指标、公式、状态与 Tooltip

验收条件：

- [ ] 从核心看板进入任一详情后语言保持一致。
- [ ] 返回路径和页面状态不受影响。
- [ ] 动态实体名和用户数据不被错误翻译。

## P6：运维设置

预计：1～1.5 天

- [ ] 设置 Shell 与两组 Tab。
- [ ] 模型价格。
- [ ] 数据源。
- [ ] 同步任务。
- [ ] 系统配置。
- [ ] 平台总览。
- [ ] AI 服务健康度。
- [ ] 实时态势。
- [ ] 明细查询。
- [ ] 表单验证和 mutation 失败回退。
- [ ] 删除确认、测试连接、启停、刷新和导出操作。
- [ ] 日志字段、API 字段和原始数据的保留策略。

验收条件：

- [ ] 运维操作的按钮、对话框、验证和结果提示全部国际化。
- [ ] 技术字段名和业务文案边界清晰。

## P7：测试与质量门禁

预计：1～1.5 天

### 7.1 自动化测试

- [ ] 更新现有 25 个 TSX 组件测试。
- [ ] 将当前直接 `render` 的测试迁移到 i18n Provider。
- [ ] 每个主要页面至少包含英文 smoke test。
- [ ] 每个主要业务域至少包含简体中文 smoke test。
- [ ] 补充插值、复数和动态单位测试。
- [ ] 补充 Calendar locale 测试。
- [ ] 补充 glossary 和格式化测试。
- [ ] 运行 locale parity 测试。

### 7.2 中文泄漏检查

- [ ] 扫描 `packages/views/efficiency` 生产代码中的中文字面量。
- [ ] 扫描 `packages/core/efficiency` 中的中文展示逻辑。
- [ ] 为保留项建立精确豁免，不使用目录级关闭。
- [ ] 英文页面不允许显示翻译键或缺失键 fallback。

### 7.3 验证命令

```bash
pnpm --filter @multica/views typecheck
pnpm --filter @multica/views test
pnpm --filter @multica/views lint
make check
```

仓库当前可能存在与本任务无关的基线失败。验收时需要区分：

- 本次改动引入的失败
- 工作区原有失败
- 与效能国际化无关的其他模块失败

### 7.4 视觉验收

- [ ] 英文表头和筛选器不严重截断。
- [ ] Tab 和按钮宽度足够。
- [ ] 图表图例与 Tooltip 可读。
- [ ] 对话框标题、说明和按钮不溢出。
- [ ] 空状态、错误状态和禁用状态可读。
- [ ] 中文标点符合项目规范。
- [ ] 中英文与品牌、API、Token 等混排空格正确。
- [ ] 窄屏和常规桌面宽度均可操作。

## 6. 推荐提交拆分

建议拆成三个原子提交或 PR：

### 提交一：基础设施与 core

```text
feat(efficiency): add i18n foundation and locale-neutral formatters
```

包含：

- namespace
- 类型注册
- parity 测试
- core locale-neutral 改造
- 公共格式化和公共控件

### 提交二：核心看板

```text
feat(efficiency): localize dashboards and shared controls
```

包含：

- 总览
- 效率
- 贡献
- 使用
- 成本
- 需求
- 活动

### 提交三：详情、运维和验收

```text
feat(efficiency): localize detail and operations pages
```

包含：

- 所有详情页
- 运维设置
- 测试迁移
- 中文泄漏检查
- 视觉修复

## 7. 时间安排

单人配合 AI 的建议排期：

| 工作日 | 工作内容 |
|---|---|
| 第 1 天 | P0～P3：术语、namespace、core、公共控件 |
| 第 2 天 | P4：总览、效率、贡献 |
| 第 3 天 | P4：使用、成本、需求、活动 |
| 第 4 天 | P5～P6：详情页和运维设置 |
| 第 5 天 | P7：测试、泄漏扫描、视觉回归 |
| 缓冲 | 0.5～1 天处理术语和验收反馈 |

范围成本：

| 交付范围 | AI 配合后的预计成本 |
|---|---:|
| 入口标题、Tab、公共筛选器 | 0.5～1 天 |
| 核心看板完整覆盖 | 2～3 天 |
| 全模块，包括详情、运维和测试 | 4～6 天 |

## 8. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| 术语未提前冻结 | 大量键和值返工 | P0 先确认术语表 |
| 机械替换句子片段 | 英文语序错误 | 使用完整句 key 和插值 |
| core 继续输出中文 | 英文页面残留中文 | P2 先做 locale-neutral 改造 |
| 测试缺少 Provider | 批量测试失败 | 统一使用 `renderWithI18n` |
| 英文比中文更长 | 表格、Tab、按钮溢出 | P7 做视觉回归 |
| 用户数据被错误翻译 | 数据失真 | 明确原始数据豁免 |
| API 错误中英文混杂 | 英文页面出现中文 | 前端错误摘要国际化，原始详情保留 |
| 大批量改动难审查 | 回归定位困难 | 按三个提交分阶段落地 |
| 覆盖现有未提交工作 | 用户改动丢失 | 开工前记录状态，逐文件核对 diff |

## 9. 最终验收清单

- [ ] `efficiency` namespace 已注册并类型安全。
- [ ] `en` 与 `zh-Hans` 翻译键完全一致。
- [ ] 核心看板全部支持中英文。
- [ ] 详情页全部支持中英文。
- [ ] 运维设置全部支持中英文。
- [ ] core 不再包含非豁免中文展示逻辑。
- [ ] 日期、数字、时长、月份和单位随 locale 正确显示。
- [ ] 图表标题、图例和 Tooltip 已国际化。
- [ ] 表单、对话框、空状态和错误状态已国际化。
- [ ] 英文环境无非豁免中文泄漏。
- [ ] 中文环境无翻译键或英文 fallback 泄漏。
- [ ] 现有功能交互无回归。
- [ ] 目标测试、类型检查和完整验证已执行并记录结果。
