# 把嵌入的 multica 路径双向同步到云平台 URL

**日期:** 2026-06-25
**状态:** 设计 —— 待出实现计划
**前身文档:** `2026-06-21-csc-session-deeplink-design.md`(本设计所基于的现有嵌入桥接)

## 目标

当 multica 以 iframe 形式嵌入云平台(`@opencode-ai/app-ai-native`,部署在 `/cloud` 下)运行时,云平台的地址栏必须反映用户当前在 multica 里所处的页面;同时,一个可分享的云平台 URL 必须能深链回那个确切的 multica 页面。

用用户给出的例子具体说明:

- 独立 multica 的 issue 地址:`http://127.0.0.1:3000/ipd-1/issues/<uuid>`。
- 目前云平台不管你在 iframe 里打开了哪个 issue,地址都卡在 `https://…/cloud/workflow`;刷新会丢失位置,地址也无法分享。
- 改完之后,云平台会镜像 multica 的路径:`https://…/cloud/workflow/ipd-1/issues/<uuid>` —— 刷新仍停在该 issue,链接可分享,浏览器的后退/前进/手动改地址都能驱动 iframe。

这是父端(app-ai-native)URL 与嵌入 multica 位置之间的**双向**同步,覆盖 multica 的**所有**页面(issue、收件箱、设置、agent 等),不只是 issue 详情页。

## 背景:嵌入桥接的现状

- **父端 —— app-ai-native**(`packages/app-ai-native/src/pages/multica/multica-page.tsx`)通过 iframe 嵌入 multica,`src` 为 `<VITE_MULTICA_WEB_URL>?embedded=opencode&preferred_email=<email>`。它监听 iframe 发来的两种 `postMessage`:
  - `multica:navigate` 且 `target === "session"` → 打开某个 csc 会话(已有功能,保持不动)。
  - `multica:ready` → 清除加载遮罩(目前 multica 仓库里没有发送方,实际未启用)。
  iframe 的 `src` **不带**任何 multica 路径,所以嵌入的应用永远从首页加载。
- **子端 —— multica**(`packages/core/platform/costrict-bridge.ts`)集中处理嵌入检测(`isEmbeddedInCostrict()`)和唯一的一条外发消息(`postCostrictNavigateToSession({ sessionId, workDir })`)。它**不**上报当前路由,也**不**接受入站导航。
- **路由改名(已完成、未提交):** app-ai-native 的路由已从 `/multica` 改为 `/workflow`(`routes.tsx`、`pages/root-layout.tsx`),与部署后的 `/cloud/workflow` 对齐。本设计把这条路由扩展为通配符(splat)路由。

调查期间已确认:

- app-ai-native 使用 `@solidjs/router`;`/workflow` 是叶子路由,可以改成通配符路由(`/workflow/*`)以接住后面的 multica 路径。
- multica web 是 Next.js App Router 应用(`apps/web/app/**`),因此 `next/navigation` 的 `usePathname()` / `useRouter()` 可用。按 multica 的包边界规则,`next/navigation` 只能出现在 `apps/web`。
- multica 仓库里没有 `multica:ready` 的发送方;本设计**不**依赖它。

## 关键决策(头脑风暴阶段已敲定)

1. **双向同步。** URL 既要反映当前 multica 页面(子→父),也要能深链回该页面(父→子)。
2. **路径式 URL。** 云平台 URL 镜像 multica 自身的路径结构:`/cloud/workflow/<multica-path>`(如 `/cloud/workflow/ipd-1/issues/<uuid>`),而不是 `?path=` 查询参数。这样分享链接干净,且与独立 multica 对齐。
3. **全页面同步。** 所有 multica 路由都同步(issue、收件箱、设置等),不只是 issue 详情页。机制是基于路径的、通用的。
4. **方案 A —— `postMessage` + 应用内路由跳转。** 父→子导航通过一条 `postMessage` 指令,由子端用自己的路由执行(不整页重载 iframe),使后退/前进/深链保持顺滑且保留应用内状态。舍弃"父端 URL 每次变化都重载 iframe `src`"的方案——那样每次导航都会重载整个 multica 应用。
5. **新增型消息。** 只新增消息类型;现有的 `multica:navigate { target: "session" }`(在 CoStrict 中打开)流程原样不动。
6. **独立 multica 不受影响。** 子端所有新行为都以 `isEmbeddedInCostrict()` 为开关。

## URL 规则

- 云平台 URL = `/cloud/workflow` + multica 的 pathname。
  - `/cloud/workflow` → multica 首页。
  - `/cloud/workflow/ipd-1/issues/<uuid>` → 该 issue。
  - `/cloud/workflow/inbox`、`/cloud/workflow/settings` 等 → 对应页面。
- MVP 只同步 **pathname** —— 不同步查询串和 hash。(例子里的 issue 详情 URL 没有查询串;query/hash 同步留待以后。)
- 侧边栏 "Workflow" 入口跳转到 `/cloud/workflow`(首页)。
- 部署 base path:app-ai-native 部署在 `/cloud` 下,由路由的 base 配置处理;路由定义里用 `/workflow/…`,不带 `/cloud` 前缀。

### Base path 对齐假设

假设 `VITE_MULTICA_WEB_URL`(如 `https://…/workflow-web`)已经包含任何 Next.js `basePath`,而同步过去的子路径是 multica 路由**去掉** `basePath` 后的部分 —— 这正是 Next 的 `usePathname()` 返回值。因此 `iframe src = <VITE_MULTICA_WEB_URL> + <子路径>` 在开发环境(`http://127.0.0.1:3000` + `/ipd-1/issues/<uuid>`)和生产环境(`https://…/workflow-web` + `/ipd-1/issues/<uuid>`)都能正确解析。实现时需对照部署的 `basePath` 核实。

## 消息契约

新增两种 `postMessage` 类型,在父端与 iframe 之间跨源传递。两边都做 origin 校验(父端已检查 `event.origin === multicaUrl.origin`;子端检查 `event.source === window.parent` 及消息形状)。

| 方向 | `type` | 载荷 | 何时发送 |
|---|---|---|---|
| 子→父 | `multica:location` | `{ path: string }` | 子端挂载时(初始,兼作"就绪"信号)以及 multica 每次路由变化时。`path` 为 multica 的 pathname,如 `/ipd-1/issues/<uuid>`。 |
| 父→子 | `multica:route` | `{ path: string }` | 当父端 URL 被外部改变时(浏览器后退/前进、手动编辑,或应用内跳到 `/cloud/workflow/<…>` 的链接),请求嵌入的 multica 跳转。 |

现有的 `multica:navigate { target: "session", sessionId, workDir? }`(子→父)保持不变,且与之区分。

```ts
// 子→父
{ type: "multica:location", path: "/ipd-1/issues/<uuid>" }
// 父→子
{ type: "multica:route", path: "/ipd-1/issues/<uuid>" }
```

## 数据流

```
A. 用户在 iframe 内部导航(子端驱动):
   multica 路由变化 → 子端发送 { type: "multica:location", path }
   → 父端把 URL 设为 /cloud/workflow<path>(history replace,不重载 iframe)
   → 父端记录 lastChildPath = path

B. 父端 URL 被外部改变(后退/前进/手动/应用内链接):
   父端 splat 变为 <path>,且与 lastChildPath 不同
   → 父端向 iframe 发送 { type: "multica:route", path },并设置 lastChildPath
   → 子端 router.push(path)(SPA 跳转,不重载)
   → 子端上报 { type: "multica:location", path };父端发现 path === currentSplat → 空操作

C. 初始加载 / 分享链接:
   父端从 URL 读出 splat <path> → iframe src = <base><path>?embedded=…
   → multica 在 <path> 启动 → 子端发送 { type: "multica:location", path }
   → 父端发现 path === 当前 splat → 不改 URL,只设置 lastChildPath
```

## 防死循环

父端维护一个状态 —— `lastChildPath`,即"子端当前所处的(或正前往的)路径" —— 加上两边"路径没变就不动",就足够了。不需要任何标志位:

- **子→父(`multica:location { P }`):** 设 `lastChildPath = P`;若 `P !== currentSplat`,把 URL 替换为 `/workflow` + `P`。这次 URL 变化触发的 splat 处理是空操作,因为新 splat 等于 `lastChildPath`。
- **父端 splat 变为 `S`(外部:后退/前进/手动/应用内链接):** 若 `S !== lastChildPath`,发送 `multica:route { S }` 并设 `lastChildPath = S`。子端随后 `router.push(S)` 并上报 `S`;父端丢弃该上报,因为 `S === currentSplat`。
- **两边"路径没变就不动"** 是兜底。

子端在路径变化时总是上报(不做抑制);父端的比较会让这些上报变成无害操作。子端挂载时发出的初始 `multica:location` 兼作就绪信号;由于初始路径已经写进 iframe `src`(流程 C),不存在启动竞态需要处理。

## 改动

### 改动 1 —— multica 子端桥接(`packages/core/platform/costrict-bridge.ts`)

在现有 `postCostrictNavigateToSession` 旁边新增两个 helper:

- `postLocationToParent(path: string)`:未嵌入 / 无父窗口 / 路径为空时为空操作;否则 `window.parent.postMessage({ type: "multica:location", path }, "*")`。
- `parseParentRouteCommand(event: MessageEvent): { path: string } | null`:当 `event.source === window.parent` 且消息为 `{ type: "multica:route", path: string }`、`path` 为非空字符串时返回 `{ path }`;否则返回 `null`。(origin 白名单以后可收紧;该指令只是在 multica 内部跳转,所以以 `source === window.parent` + 形状为门槛。)

测试(`costrict-bridge.test.ts`,沿用现有模式):`postLocationToParent` 发送正确载荷、独立运行时为空操作;`parseParentRouteCommand` 接受合法指令、拒绝错误来源 / 错误类型 / 缺失 path。

### 改动 2 —— multica web 嵌入同步(`apps/web`)

新增一个**客户端**组件(用到 `next/navigation`,所以放在 `apps/web` 而非 `packages/`),在根布局(`apps/web/app/layout.tsx`)里挂载一次:

- 读取 `usePathname()` 和 `useRouter()`。
- 当 `isEmbeddedInCostrict()` 为真时:
  - 挂载时以及 `pathname` 每次变化时:调用 `postLocationToParent(pathname)`(总是上报;父端会丢弃空操作)。
  - 监听 `message`;收到 `parseParentRouteCommand(event)` 时执行 `router.push(path)`。(不需要抑制标志 —— 由此触发的 location 上报在父端是空操作。)
- 未嵌入时整体为空操作(组件仍会廉价地挂载,但什么都不做)。

### 改动 3 —— app-ai-native 路由(`packages/app-ai-native/src/routes.tsx`)

把 `/workflow` 路由改为通配符路由,接住后面的 multica 路径(如 `/workflow/*sub`;实现时按安装的 `@solidjs/router` 版本确认确切的 splat 语法)。`MulticaPage` 读取该 splat 参数。(`/multica` → `/workflow` 改名已完成;此处是加通配符。)

### 改动 4 —— app-ai-native 父端页面(`packages/app-ai-native/src/pages/multica/multica-page.tsx`)

- **iframe `src`:** 在**挂载时一次性**算出 `<VITE_MULTICA_WEB_URL><initialSplat>?embedded=opencode&preferred_email=<email>`(规整 base 的首尾斜杠),并存进 ref,之后不再更新 —— 后续导航都走 `postMessage`,绝不重写 `src`(重写会重载 iframe)。父端被硬刷新时组件重新挂载,于是 splat 会被重新读取,iframe 重新在正确路径打开。
- **监听** `multica:location`(在现有 `multica:navigate` 会话处理之外再加):设 `lastChildPath = path`;若 `path` 与当前 splat 不同,执行 `navigate("/workflow" + path, { replace: true })`。
- **父端 splat 变化时**(location 副作用):若新 splat 与 `lastChildPath` 不同,向 iframe `postMessage` `{ type: "multica:route", path: splat }` 并设 `lastChildPath = splat`。
- **把判定逻辑抽成纯函数**,I/O 注入(仿照 `open-session-by-id.ts` 让编排可测的做法):给定 `{ currentSplat, lastChildPath, event }`,其中 `event` 是一条入站 `multica:location` 或一次 splat 变化,返回下一步动作 —— `{ updateUrl?: string, postRoute?: string, lastChildPath?: string }`。组件负责执行副作用;该纯函数直接做单测。

### 改动 5 —— 测试(app-ai-native)

- 对改动 4 的纯判定函数做单测:覆盖全部四种流程(子端驱动、外部、初始、不变时空操作)以及防循环。
- 手动 / E2E:在 iframe 内导航,确认云平台 URL 跟着变;刷新一个分享的 `/cloud/workflow/<…>` URL,确认 iframe 在该页面打开;用后退/前进,确认 iframe 跟随且不重载。

## 边界情况

- **未嵌入:** 子端同步组件为空操作;独立 multica 不受影响。父端逻辑只在 `/workflow/*` 下运行。
- **splat 为空**(`/cloud/workflow`):iframe 加载 multica 首页;子端上报 `/`(或其默认路由);URL 保持 `/cloud/workflow`。
- **`VITE_MULTICA_WEB_URL` 配错 / 不可达:** 沿用现有的加载和错误 UI;在 iframe 加载完成前,路径同步只是没有东西可上报。
- **跨源:** `postMessage` 支持跨源;两边都做校验(父端:origin 匹配,已实现;子端:`source === window.parent` + 形状)。
- **用户无权访问 / 不存在的路径:** multica 在 iframe 内部渲染自己的 404/无权限页;云平台 URL 仍反映该路径。无需特殊处理。
- **形状漂移:** 两端都忽略不带预期 `type`/`path` 的消息(父端保留现有 `multica:navigate` 会话处理;子端忽略未知消息)。

## 不做(YAGNI)

- 同步查询串或 hash(MVP 只做 pathname)。
- 改动 `VITE_MULTICA_WEB_URL` 或 iframe 的认证/嵌入参数机制。
- 对现有 `multica:navigate { target: "session" }` 在 CoStrict 中打开流程的任何改动。
- 改名 "Multica" 菜单文字、`MulticaPage` 组件、`pages/multica/` 目录、`VITE_MULTICA_WEB_URL` 环境变量名,或 `toast.multica.*` 的 i18n key —— 用户把改名范围限定在路由本身。
- 除了 URL 本身提供的之外,父端对"上次位置"跨应用完全重启的持久化(URL 即持久化)。
