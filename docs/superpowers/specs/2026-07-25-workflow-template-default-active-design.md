# Workflow 模板实例默认启用设计

## 目标

- 基于模板创建的 workflow 实例创建后即为 `active`，无需再次手动启用。
- 模板只出现在模板管理/选择区域，不出现在任何可运行 workflow 列表中。
- 即使客户端绕过列表直接请求运行模板，后端也拒绝执行。

## 设计

模板克隆仍由 `WorkflowService.CloneWorkflowFromTemplate` 在单个事务中完成。新实例继续保留 `is_template=false` 和 `source_template_id=<template id>`，但初始 `status` 从 `draft` 改为 `active`。普通空白 workflow 的创建行为保持 `draft` 不变。

共享 workflow 列表查询显式调用 `GET /api/workflows?template=false`，使普通管理列表和活动运行列表只接收实例。活动列表的 `select` 同时保留 `is_template === false` 的防御性过滤，以兼容旧服务或畸形响应。模板页面继续使用现有 `template=true` 独立查询。

Issue 执行者选择器不再查询、合并或懒克隆跨工作区模板，只展示活动实例。用户要使用模板时，先在 Workflow 页面创建实例；该实例因默认 `active` 可立即出现在运行选择器中。

运行服务在状态检查后增加模板检查。`active` 模板仍可用于模板管理，但不能产生 workflow run。

## 错误处理与兼容性

- 克隆事务失败仍整体回滚，沿用现有错误返回。
- 直接运行模板返回稳定的服务错误，不创建 run 或 node run。
- 不迁移既有派生 workflow；需求只改变新实例默认值。
- 不改变 `template=true` 和未指定 `template` 时的后端列表 API 语义，降低对旧客户端的影响。

## 测试

- Go 服务测试断言克隆实例返回并持久化为 `active`。
- Go 单元测试断言 `active + is_template=true` 仍无法启动。
- Core 查询测试断言普通/活动列表请求 `template=false`，且活动选择结果排除模板。
- View 测试提供一个活动模板响应，断言 Issue workflow 选择器不显示它、仍显示活动实例。

