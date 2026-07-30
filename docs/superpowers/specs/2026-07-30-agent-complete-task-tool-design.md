# Agent 自主「完成任务」工具 设计

日期：2026-07-30
分支：feat/agent-complete-task-tool（multica + cs-cloud 两侧）
相关：`2026-07-15-cs-workflow-migration-design.md`、deliverable kind-unification

## 背景

cs-cloud workflow 里，一个节点的 agent 任务「是否完成」目前由**工程侧启发式**判定，不是 agent 自己说的：

- cs-cloud 的 `csc.Agent.waitForSessionDone`（`cs-cloud/internal/agent/csc/agent.go:558`）靠「csc session 从 busy 变 idle，且上一轮 result 的 stopReason 不是 `tool_use`/`max_tokens`」来判定完成。本质是「agent 不再用工具了 = 完成」。
- 判定完成后，`Driver.execute`（`cs-cloud/internal/workflowrunner/driver.go:459`）回调 multica `POST /api/daemon/tasks/{taskId}/complete`。
- multica 收到后按 task 的 `phase` 分流（`server/internal/service/workflow.go:1588` `HandleWorkflowTaskCompletion`）：
  - `phase=worker` → `SubmitWorkerOutput` → 节点进 `awaiting_critic` → 派发 critic task。
  - `phase=critic` → `parseAgentCriticDecision`（从 critic 文字输出里正则抠决议）→ `ReviewNodeRun` → 通过则 `completed` → `OnNodeRunCompleted` → `ActivateDownstreamAndEnqueue` → 切下一节点。

问题：完成是系统「猜」的，agent 没有显式发言权；critic 的通过/打回也是从文字猜的。

## 目标

把完成信号的**发起者**从「driver 启发式」改成「agent 显式调用一个工具」。agent 自己判定完成后调用工具，工具触发既有的 CompleteTask 路径，multica 状态机推进逻辑完全复用。

## 设计决策（已与用户确认）

1. **覆盖范围**：worker + critic 两段都覆盖。worker 调「完成」进评审；critic 调「通过/打回」决定是否切下一节点。
2. **未调工具的兜底**：纯工具模式。session 空闲但 agent 没调工具，**不**判完成，挂到 `AgentTimeout`（现 30min）超时失败。新增失败原因 `agent_incomplete`（区别于「agent 还在忙但硬超时」的 `agent_timeout`）。
3. **工具机制**：新增 cs-cloud CLI 子命令 → 本机 localserver 新端点 → 通知 driver → driver 走现有 CompleteTask。**execute 仍是 task 状态回调的唯一 owner**（endpoint 只发信号，不发 CompleteTask）。
4. **critic 决议**：显式带在工具调用里 → CompleteTask payload 加 decision/reason → multica 优先用显式决议、保留 text 解析兜底。
5. **交付物与完成解耦**：交付物只是引导 agent 去交，不是硬门槛。完成工具**不做任何交付物预检**，agent 自主喊完成即完成。（现有 `SubmitWorkerOutput` 里的必填交付物 gate 在当前工作流配置下不会触发；本设计不改动它。）

## 数据流（改造后）

```
agent(执行中) ──Bash──► cs-cloud workflow task complete [--summary …]          (worker)
                          cs-cloud workflow task review --decision approve|reject [--reason …]  (critic)
                               │
                               ▼  (env 鉴权: CS_CLOUD_TASK_ID 等)
                   localserver  POST /workflow/tasks/{id}/complete
                               │  body: {action, summary, decision, reason}
                               │ ① 查 driver 的 per-task 完成信号，存 payload + notify
                               │ ② 立即回 200 给 CLI（「completion accepted, stop」）
                               ▼
                   waitForSessionDone 的 select 多一路 ◄── notify，立即返回 nil（成功）
                               │
                   Driver.execute 收到 runAgent 返回
                               │ ③ 读 per-task payload：若存在 → 显式完成
                               ▼
                   client.CompleteTask(output=summary, decision, reason)   ← 现有路径
                               ▼
                   multica HandleWorkflowTaskCompletion
                       phase=worker  → SubmitWorkerOutput → awaiting_critic   （零改动）
                       phase=critic  → 优先用显式 decision → ReviewNodeRun → 切下一节点（小改）
```

性质：multica 的节点推进状态机（worker→review→next node）完全复用；只改完成的发起者和 critic 决议的来源。

## cs-cloud 侧改动

### A. 新 CLI（`internal/cli/task.go` 新建）

注册到 `workflow.go:20` 的 switch：`case "task": return taskCmd(a, args[1:])`。两条子命令，仿 `deliverable submit`（`gitea.go`/`gitlab.go`）形态，用 env 鉴权（`CS_CLOUD_TASK_ID`、`CS_CLOUD_BACKEND_URL`/localserver 地址等已由 `task.go:188 buildEnv` 注入）：

- `cs-cloud workflow task complete [--summary <text>]` —— worker 用。
- `cs-cloud workflow task review --decision approve|reject [--reason <text>]` —— critic 用。

两条都 POST 到本机 localserver 的 `/workflow/tasks/{CS_CLOUD_TASK_ID}/complete`，body：
```json
{ "action": "complete" | "review", "summary": "...", "decision": "approve" | "reject", "reason": "..." }
```
（worker 只填 action+summary；critic 填 action+decision+reason。）

### B. localserver 端点（`internal/localserver/`）

- 路由：`server.go:225` 旁加 `api.HandleFunc("POST /workflow/tasks/{id}/complete", s.handleWorkflowTaskComplete)`。
- handler `handleWorkflowTaskComplete`：解析 body → 调 `s.workflow.SignalTaskCompletion(taskID, sig)` → 据返回 ACK/409 给 CLI。**不直接调 CompleteTask**。

### C. driver 信号机制（`internal/workflowrunner/`）

**关键设计决定（实现时修订）**：纯工具的「notify 竞争」放在 **driver 的 `runAgent`**（workflowrunner 层），**不改 csc 的 `waitForSessionDone`**。这样 csc 的 ~7 个 session 测试零改动，纯工具逻辑集中在它该在的 workflow 层。

- `internal/workflowrunner/completion.go`：per-task 完成状态注册表（`d.mu` 保护，`map[taskID]*completionState`）：
  ```go
  type completionState struct {
      notify  chan struct{}      // 通知 runAgent 立即返回
      payload agent.CompletionSignal
      set     bool
  }
  ```
  - `registerCompletion` / `unregisterCompletion`：execute 在跑 agent 前注册（仅 csc+sessionID）、跑完注销。
  - `SignalTaskCompletion(taskID, sig)`：查 map；无 → 错误「task not running」（→ endpoint 409）；有且未 set → 存 payload、`close(notify)`、返回；已 set → 幂等 no-op。
  - `popCompletionSignal(taskID)`：execute 在 runAgent 返回 nil 后读 payload。
- `runAgent`（driver.go）：在现有 `select { resultCh | ctx.Done }` 基础上加 `<-notify` 一路（仅对 csc+sessionID 的 pureTool 任务，`notify != nil`）：
  - notify 命中 → abort csc session、drain resultCh、返回 `(nil, nil)`（显式成功；payload 在注册表里）。
  - resultCh 命中且 `err==nil` 且 pureTool → 先非阻塞查 notify（防 notify 与 session-end 竞争）；未完成 → 进入 `select { ctx.Done | notify }`：**idle 不再等于完成**，挂到 ctx 超时返回 `agent.ErrIncomplete`（→ `agent_incomplete`），期间若 notify 到则算完成。
  - resultCh 命中且 `err!=nil` → 照常上抛（terminal session error / ErrEmptySessionOutput 等）。
  - ctx.Done → abort、返回 ctx.Err（busy 超时 → `agent_timeout`）。
- `execute`：runAgent 返回 nil 后先 `popCompletionSignal`；有 → `output = sig.Summary`（空回退 session stdout，仍空则 `agent_empty_output`），`CompleteTask(..., sig)`。无 → 走原路径（非 csc）。

### D. csc 层 —— **零改动**

`internal/agent/csc/agent.go` 的 `RunSession` / `waitForSessionDone` 不动。所有现有 csc session 测试保持通过。

### E. CompleteTask payload（`client.go:189`）

`CompleteTask` 增加 `sig agent.CompletionSignal` 参数；body 在现有 `{output, session_id, work_dir}` 基础上，critic 时带 `decision`、`reason`。

### F. 失败分类（`driver.go`）

新增分支（在 `DeadlineExceeded` 前）：`errors.Is(runErr, agent.ErrIncomplete)` → `failTask(..., "agent_incomplete")`。

### G. 共享类型（`internal/agent/completion_signal.go` + `errors.go`）

```go
type CompletionSignal struct {
    Action   string // "complete" | "review"
    Summary  string
    Decision string // "approve" | "reject"（review）
    Reason   string
}
var ErrIncomplete = errors.New("agent stopped without calling the complete tool")
```
（实现时去掉了初版的 ctx-plumbing —— notify channel 直接由 driver 持有，无需注入 csc。）

### H. localserver URL plumbing（让 in-task CLI 能回调本机 driver）

deliverable-submit CLI 打的是 multica（`CS_CLOUD_BACKEND_URL`）；新 complete 端点在本机 localserver，task env 原本没有 localserver URL。补一条：
- `TaskRunner.localServerURL` + `SetLocalServerURL`；`buildEnv` 注入 `CS_CLOUD_LOCAL_URL`（`task.go`）。
- `Driver.localBaseURL` + `SetLocalBaseURL`；`Start()` 里 `d.runner.SetLocalServerURL(d.localBaseURL)`（`driver.go`）。
- localserver `Server.Start()`：listener bind 后（`s.url` 已知）、`workflow.Start()` 前，调 `s.workflow.SetLocalBaseURL(s.url)`（`server.go`）。
- CLI 读 `CS_CLOUD_LOCAL_URL` + `CS_CLOUD_TASK_ID`，POST `/api/v1/workflow/tasks/{id}/complete`。

## multica 侧改动（小）

### A. `TaskCompleteRequest`（`server/internal/handler/daemon.go:1958`）

加两个 omitempty 字段：
```go
Decision string `json:"decision,omitempty"` // critic 显式决议 approve|reject
Reason   string `json:"reason,omitempty"`
```
handler 现有逻辑把整个 `req` marshal 成 `result` JSON 传给 service，无需改。

### B. critic 优先用显式决议（`server/internal/service/workflow.go:1588` `HandleWorkflowTaskCompletion` 的 phase=critic 分支）

先看 result 里有没有显式 `decision`：有 → 直接用它构造 critic 决议；没有 → fallback 到现有 `parseAgentCriticDecision`（:1687，保留）。worker 分支零改动。

## Prompt 指令改动

multica `buildCSCloudPrompt`（`server/internal/service/task_cscloud_push.go:993`）给 agent 的指令集加：

- **worker**：做完后**必须**以 `cs-cloud workflow task complete --summary "<总结>"` 作为最后动作；否则任务会一直挂到超时失败。
- **critic**：评审完**必须**调 `cs-cloud workflow task review --decision approve|reject --reason "<理由>"`。

## 边界情况

- **双重调用**：第二次 `SignalTaskCompletion` 看到 notify 已 close/已发 → 返回「已完成」，不重复。
- **complete 后 agent 继续动作**：driver 收 notify 即让 session 收尾，后续工具调用被切断；prompt 明确「complete 是最后动作」。
- **空 summary**：现有 `workflowCompletionFailureReason`（daemon.go:1965）仍兜底——workflow task 空 output → `agent_empty_output`。prompt 会要求带 summary，cs-cloud 侧 summary 空时回退 session stdout。
- **endpoint 找不到运行中的 task**（session 已结束/任务没在跑）：回 409，CLI 报错给 agent。
- **critic 调了 `task complete`（而非 review）/ worker 调了 review**：endpoint 接受并带 action；multica 侧按 task 的 phase 处理，action 与 phase 不一致时按 phase 优先（decision 缺失走 text 解析兜底）。

## 不在本次范围

- 交付物预检（complete 前查必填交付物是否齐、不齐返给 agent 补救）。交付物与完成解耦，不需要。
- 非 csc agent（one-shot CLI 路径）的显式完成：该路径无工具可用，维持「进程退出即完成」。

## 测试策略

### cs-cloud（Go test）

- CLI：`task complete`/`task review` 构造正确 body、打正确端点。
- localserver handler：信号正确投递到 driver 注册表；任务不在跑时 409。
- `waitForSessionDone`：notify 到达 → 立即返回 nil；无 notify + idle → 不返回；ctx 超时 + 曾 idle → `ErrIncomplete`；ctx 超时 + 仍 busy → `DeadlineExceeded`。
- driver.execute：显式完成路径用 sig.Summary + decision 调 CompleteTask；`ErrIncomplete` → `agent_incomplete`。
- `SignalTaskCompletion` 重复调用幂等。

### multica（Go test，数据库-backed）

- `TaskCompleteRequest` 带 decision 时，`HandleWorkflowTaskCompletion` phase=critic 用显式决议（approve→completed 切下一节点；reject→rework）。
- 无 decision 时 fallback 到 `parseAgentCriticDecision`（不回归）。
- worker phase 带无关 decision 字段不受影响。

### prompt

- `buildCSCloudPrompt` 的 worker/critic prompt 包含两条新指令（更新已有 prompt 断言测试）。

## 实施顺序

1. cs-cloud 共享类型 `agent.CompletionSignal` + ctx plumbing。
2. cs-cloud `waitForSessionDone` 改造（notify + 移除 idle=done + ErrIncomplete）—— TDD。
3. cs-cloud driver 注册表 + execute 显式完成路径 + `SignalTaskCompletion` + 失败分类。
4. cs-cloud localserver 端点。
5. cs-cloud CLI `task complete`/`task review`。
6. cs-cloud `CompleteTask` client/payload 加 decision。
7. multica `TaskCompleteRequest` + `HandleWorkflowTaskCompletion` 显式决议。
8. multica prompt 指令。
9. 全量验证：cs-cloud `go test`、multica `make test`、相关 `pnpm test`。
