# 效能度量国际化文案清单

> 生成日期：2026-07-31
> 扫描范围：`packages/views/efficiency/` 与 `packages/core/efficiency/` 的生产 TS/TSX
> 用途：P0 基线、翻译键规划和最终中文泄漏验收

## 1. 基线

| 项目 | 数量 |
|---|---:|
| 生产 TS/TSX 文件 | 84 |
| 包含中文运行时字面量的文件 | 59 |
| 中文字面量出现次数 | 2,047 |
| 去重后的原始中文片段 | 1,231 |
| 整理后预计翻译键 | 650～900 |

按目录分布：

| 区域 | 文件数 | 中文字面量出现次数 |
|---|---:|---:|
| `settings/` | 9 | 707 |
| `detail/` | 9 | 487 |
| `usage/` | 6 | 219 |
| `cost/` | 4 | 158 |
| `efficiency/` | 7 | 140 |
| `contribution/` | 7 | 139 |
| `components/` | 13 | 120 |
| `needs/` | 1 | 42 |
| `activity/` | 1 | 31 |
| 其他 | 2 | 4 |

## 2. 翻译键分区

统一使用 `efficiency` namespace，按以下一级分区组织：

```text
common
overview
efficiency
contribution
usage
cost
needs
activity
detail
settings
charts
```

`common` 仅收纳跨两个及以上业务区域重复使用的文案：

```text
common.actions.*
common.entities.*
common.states.*
common.table.*
common.units.*
common.errors.*
common.date_range.*
common.granularity.*
```

禁止使用无语义的 `text_001`、`label_002` 等编号键。

## 3. 必须翻译

- 页面、卡片、区块和对话框标题
- 按钮、Tab、筛选器、placeholder 和 aria-label
- 表头、分页、排序和导出界面标签
- 指标名称、统计口径、公式说明和 Tooltip
- 加载、空状态、失败、重试和禁用原因
- 前端表单验证与 mutation 错误摘要
- 图表标题、序列名、图例、坐标单位和 Tooltip 标签
- 日期快捷选项、月份、星期、时长和数量单位
- 前端已知枚举值的展示标签

## 4. 保持原样

- 用户名、部门名、项目名和工作区名称
- 仓库地址、分支名、Commit SHA 和文件路径
- 模型名、数据源名和用户填写的备注
- UUID、Request ID、Task ID、Need ID 等业务标识符
- API、CLI、URL、SQL、HTTP、JSON、Token 等约定保留词
- API / DB 字段名和导出中的原始字段名
- 日志正文、代码片段和服务端原始错误详情
- 未知枚举值的原始值

## 5. 需要结构化改造

以下内容不能只做字符串替换：

| 位置 | 当前问题 | 目标 |
|---|---|---|
| `utils/formatters.ts` | `formatNumber` 固定 `zh-CN` | 显式接收 locale |
| `utils/formatters.ts` | `formatDuration` 拼接中文单位 | 返回结构化值或由 views 翻译 |
| `utils/glossary.ts` | 指标说明全部存放在 core | core 保留稳定 key，文案移至 locale |
| `utils/time-bucket.ts` | `GRANULARITY_CN` 和中文月份 | 返回粒度、日期和范围数据 |
| `utils/distribution.ts` | 分布区间直接包含中文标签 | 返回稳定区间 key |
| `date-range-picker.tsx` | Calendar 固定 `zhCN` | 根据当前 locale 选择 locale data |
| Hero 成本区 | 货币符号硬编码 `¥` | 跟随 `system_currency` |

## 6. 重点审校规则

- `Silica` 与 `AI code ratio` 是不同指标，禁止共用翻译键。
- `Calendar efficiency` 与 `Effort efficiency` 的百分比换算不得改变。
- `Need` 英文按领域实体处理；中文统一显示“需求”。
- 中文“古法预估”“传统预估”统一为“基线预估”。
- 货币跟随业务配置；切换界面语言不转换金额。
- 统计周边界保持现有周日开始规则。
- 服务端错误显示本地化摘要，原始详情保持原样。

## 7. 最终泄漏豁免

最终中文扫描仅允许以下类别保留中文：

- 代码注释中引用的现有中文业务术语（后续应尽量改为英文注释）
- mock 中模拟的中文用户名、部门名或项目名
- 简体中文 locale JSON
- 中文测试断言

生产组件、core 展示常量和英文 locale JSON 中不得保留未登记的中文 UI 文案。
