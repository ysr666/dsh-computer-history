# 交接：Phase 1 首次真机运行时验证

**交接时间：** 2026-10-02
**项目目录：** `/Users/ysradmin/Projects/dsh-computer-history`
**当前分支：** `main`
**当前 HEAD：** `95af161` — `docs: align shutdown comments with the release ordering`
**worktree：** clean
**本阶段任务：** 让 Phase 1 在真实 DSH Host + 真实 macOS 会话中跑起来，并记录观察结果
**明确禁止：** 不要开始 P2

> **执行状态（2026-10-02 更新）：本交接已执行完毕。**
> 真机验证结果、三个 blocker 的修复、缺陷清单、未确认项与重启后步骤见
> `docs/validation-phase1-runtime-2026-10-02.md`（先读该报告的 §0 快速交接摘要，再看 §10 下一阶段）。
> 本文件保留为验证前的原始交接与约束依据。

---

## 1. 一句话交接

Phase 1 的代码与门禁已冻结（204 tests / typecheck / lint / privacy / build / native / codesign 全绿），
但它**从未在真实 DSH Host 中加载过，也从未采集过一条真实 observation**。

下一步不是再写测试，而是**把它真正跑起来**。

---

## 2. 已确认的事实（不要重新调查）

本交接前已实测确认：

```text
插件是否装配在 DSH            → 否（loader 清单中没有任何 computer-history 条目）
是否 link 进任何 profile      → 否（~/.dsh/profiles/{desktop,headless,web}/node_modules 均无）
~/.dsh/computer-history 是否存在 → 否 → 从未采集过任何真实数据
```

已构建产物存在且可用：

```text
lib/index.js          145 KB   （host 入口，exports apply/name/inject）
lib/index.d.ts        12.6 KB
lib/client.js         6.6 KB   （UI 面板入口）
bin/dsh-computer-history-collector   796 KB  universal (arm64 + x86_64)，已 codesign
```

`pnpm verify:p1` 当前可通过（含 native build + native test）。
最近一次实测数字：10k ingestion benchmark ≈ 10.4s（门限 30s；当时机器 load average 8.0，
空载基线约 7.2s，所以这个差异是负载不是回归）。

---

## 3. 为什么"再补一轮测试"没有意义

P1 目前的验证层次是：

| 层次 | 覆盖情况 |
|---|---|
| 单元 / 集成测试 | 204 tests，覆盖协议、去重、时序、删除矩阵、多 Host 所有权 |
| 性能基准 | 合成 10k observations，单 episode |
| 隐私边界 | `verify-privacy-boundary.mjs` 静态令牌扫描 + 单测 |
| **真实运行时** | **完全没有** |

三个独立审计员的结论里都写了同一句限制：

> static review only — nothing compiled or executed, no runtime AX confirmation

因此以下问题**至今没有任何证据**，只能靠真机跑一次才能回答（见第 6 节）。
继续加单测不会让这些问题前进一步。

---

## 4. 硬约束（违反即事故）

### 4.1 隐私

- **默认 OFF 是产品定义的一部分。** 没有任何用户明确同意之前，不要用 `enabled: true` 采集真实活动。
- 真机验证必须使用**一次性 dataDirectory**，例如 `/tmp/dsh-ch-live-XXX`，
  绝不要写进 `~/.dsh/computer-history`。
- 验证用测试文档必须是自己造的合成文件（如 `/tmp/dsh-live-fixtures/`），
  不要打开真实私密文件（`.env`、密钥、密码管理器）去"顺便测一下 secure 检测"。
- 安全字段检测的验证方式：用系统自带的、你自己造的假密码输入框
  （例如一个本地 HTML 表单或一次新的登录流程），不要用真实凭据。
- 采集到的真实 AX 输出**不得提交进仓库**，`.gitignore` 已忽略本地目录但要人工确认。

### 4.2 Git

当前工作树干净，HEAD `95af161`。**只允许 forward commit。**

禁止：

```text
git reset --hard / git checkout -- . / git clean
git stash drop / git rebase / git gc --prune / git reflog expire
任何 rewrite history
```

本仓库发生过一次 commit object 被 prune 的事故。

### 4.3 范围

不要开始 P2：browser companion、更多 adapter、Windows/Linux、P2 UI、模型生成摘要。
本阶段只做"让已冻结的 P1 真实跑起来并留下证据"。

---

## 5. 执行路径

环境已装配 `dsh-super-injector`（`dev_*` 工具），可在运行时注入本地插件包而无需重启。

推荐路径：

```text
1. pnpm verify:p1                     # 确认起点是绿的（不要跳过）
2. pnpm build && pnpm native:build    # 确保 lib/ 与 bin/ 是最新的
3. dev_plugin_status                  # 记录注入前的 loader 清单作为基线
4. dev_inject_plugin  {dir: "/Users/ysradmin/Projects/dsh-computer-history"}
5. dev_plugin_status                  # 确认出现 dsh-computer-history 且 fiber active
```

注意：**注入时保持 capture 关闭**（`enabled` 默认 false）。
先验证"插件能加载、Host API 能响应、UI 面板能渲染"，再单独决定是否开启采集。

注入前置条件已核对（本交接前实测）：插件 `inject` 的 6 项依赖在当前 host 中均已装配——
`subprocess`(dsh-subprocess-local)、`connection`(dsh-client-connection)、
`workspaceRegistry`(@deepseek-ai/dsh-workspace，`super(ctx,"workspaceRegistry")`)、
`agents`(dsh-agent)、`tools`(dsh-tools)、`systemPrompt`(dsh-system-prompt)。
所以注入不应因缺依赖而失败；若失败，先看 `dev_plugin_status` 的 fiber 状态。

观察点（共 8 条路由，见 `src/host/api/routes.ts`）：

```text
GET  api/computer-history/state         → 期望 enabled:false, capture:'stopped'
GET  api/computer-history/policy        → 期望 mode=include-only
                                          含 12 条 builtin protect 规则（5 app + 7 resource）
GET  api/computer-history/recent        → 期望 []
GET  api/computer-history/search?q=x    → 期望 []（q 必填 1..500）
GET  api/computer-history/episode?id=…  → 期望 404 Not found
POST api/computer-history/pause         → capture 关闭时期望 409 disabled
POST api/computer-history/policy        → owner 下应能改；非 owner 应 409
POST api/computer-history/delete        → 期望 {observationsDeleted:0, episodesDeleted:0, episodesRebuilt:0}

Client 侧：
  历史/隐私面板是否出现在侧边栏，是否能渲染空状态
```

**public mount 是这里最容易出问题的地方**：客户端使用相对前缀 `api/computer-history`
（不是 `/api/computer-history`），这条规则只在 `tests/unit/client-route.spec.ts` 里用合成
base URL 验证过，从未在真实 webserver 挂载路径下验证。请重点确认。

---

## 6. 必须回答的技术未知（这些是本次交接的核心产出）

逐条给出"观察到什么/证据在哪"，不要用"应该没问题"回答。

### A. 采集链路（开启 capture 后，用一次性目录）

1. **helper 是否真的能在 DSH managed subprocess seam 下启动并完成握手？**
   参考：`hello` 必须是第一条消息，5s hello timeout，`src/host/collector/manager.ts`。
   这是真实 `dsh-subprocess-local` provider（darwin 走 poll loop），从未真跑过。

2. **`kAXDocument` 对 VS Code / Terminal / Finder 到底返回什么？**
   这决定 `resource.canonicalUri` 是否成立。此前审计标记：
   "terminal AXDocument could carry non-cwd content"（未验证怀疑）。
   如果它返回 nil 或非路径，resource 识别会整体降级——这是产品核心假设。

3. **本次修复的 `kAXURL` CFURL 解码是否真的生效？**
   修复前 `value as? String` 可能永远返回 nil（URL 筛查等于空转）。
   修复后走 `CFURLGetTypeID` + `absoluteString`。真机上确认它拿到值。

4. **secure 字段三态检测在真实密码框上是否正确？**
   期望：聚焦密码输入框时，该 observation 的 `privacy.secure=true`
   且 title/document/url 全部为 nil，Host 直接 drop（不进库）。
   同时确认"读不到 element"这条 fail-closed 路径不会把**正常应用**全部误杀
   （这是修复引入的保守行为，误杀率只有真机能测出来）。

5. **0.5s per-element AX messaging timeout 是否真的防住了卡死？**
   做法：打开一个允许列表内的应用并让它无响应（或临时把 timeout 调到极小），
   确认 Host 侧不会出现 `configure-ack-timeout` / `paused-ack-timeout`。

6. **pause 是否真的 detach 了 AX observer？**
   期望：pause 后不再产生新 observation，且 state 回 `paused`。

### B. 多 Host 与所有权（真实进程，不是 fake）

7. **两个真实 DSH 实例（或一个实例 + 一个手写 Node 进程）抢 capture lock 时，
   是否严格只有一个 owner？** 此前只在 fake subprocess 下测过。

8. **断开/杀掉 owner 后，锁是否真的能被后继者接管？**
   `dsh-atomic-write` 的 PID 活性检测在这条路径上是关键依赖。

### C. 已记录的取舍（真机上确认影响面，但不要"修回"）

9. **非 owner 启动会阻塞 `apply()` 最多约 4.5s**（`CAPTURE_LOCK_PROBE_WAIT_MS = 1500*2*1.5`）。
   这是为了让后继 Host 不被"正在交接"窗口误判成只读客户端。
   真机上确认这个等待是否可接受（是否影响 DSH 启动体验）。

10. **helper 退出无法确认时仍会释放锁**，并记录 `degraded` / `collector-exit-unconfirmed`。
    另一个选择是永久持锁 → 整个 data directory 的 ambient capture 永久不可用。
    已判断后者更糟。真机上确认这条路径是否会被触发。

---

## 7. 验收标准

本阶段完成的定义（全部满足）：

```text
[ ] 插件能注入并 active，dev_plugin_status 可见
[ ] Host API 四个端点在真实 webserver 下返回符合预期（含 public mount 相对路径）
[ ] UI 面板在真实客户端渲染（空状态正确）
[ ] capture 开启后，能采集到至少一条真实 observation，且落库
[ ] 记录真实 observation 的字段实际情况（app/bundleId/resource/workspace/surface）
[ ] 第 6 节 A/B 两组共 8 个问题逐条有明确答案 + 证据
[ ] 验证过程中发现的缺陷：修 blocker/should-fix，补回归测试，跑完整 Gate
[ ] 验证报告落盘（见第 8 节）
[ ] worktree clean，forward commit，未进入 P2
```

如果某个未知项**无法在真机上确认**（例如需要特定 app 或权限），
明确写"未确认 + 原因 + 需要什么条件"，不要含糊过去。

---

## 8. 产出物

请在 `docs/` 下落一份验证报告，例如
`docs/validation-phase1-runtime-YYYY-MM-DD.md`，内容至少包含：

- 环境（macOS 版本、arch、DSH 版本、是否授予 Accessibility 权限）
- 插件加载方式与结果（loader entry、fiber 状态）
- 每个端点的真实响应（脱敏后）
- 真实 observation 样例（**必须脱敏**：路径/标题替换为合成值或打码）
- 第 6 节 8 个问题的逐条结论
- 发现的缺陷清单（含严重级别与处理结果）
- 明确列出"仍未确认"的项

---

## 9. 已知取舍：不要重复"修"

以下都是**经过独立审查后有意保留**的，有注释和理由。除非真机证明它们造成实际损害，
否则不要为了"更干净"再动它们：

| 项 | 位置 | 为什么保留 |
|---|---|---|
| append 边界证明不扫描全部链接 | `src/host/store/episode-store.ts` `appendIsProven` | 精确比对会让长 Episode 变成平方复杂度；"内部空洞"状态任何 writer 都无法产生 |
| helper 退出未确认仍释放锁 | `src/host/collector/manager.ts` | 永久持锁会让 ambient capture 永久不可用，更糟 |
| 非 owner 启动等待约 4.5s | `src/host/collector/capture-lock.ts` | 换取后继 Host 不被误判为只读客户端 |
| 非 owner 的 `accessibilityTrusted` 报 false | `src/host/plugin.ts` `ManagedCapture.getState` | 未探测就无法声称；不伪造 |
| benchmark 门限 30s 而实测约 7-11s | `tests/benchmark/performance/ingestion.bench.ts` | 门限是防平方回归的护栏，不是性能目标 |

---

## 10. 命令清单

```bash
cd /Users/ysradmin/Projects/dsh-computer-history

# 起点确认
git log --oneline -3
git status --short
pnpm verify:p1

# 构建（注入前必须）
pnpm build && pnpm native:build

# 单测/门禁
pnpm test
pnpm typecheck
pnpm lint
pnpm verify:privacy
pnpm benchmark:ingestion

# native
pnpm native:build
pnpm native:test
file bin/dsh-computer-history-collector
codesign --verify --strict bin/dsh-computer-history-collector
codesign -d -r- bin/dsh-computer-history-collector 2>&1 | head -3
```

---

## 11. 之后（本阶段完成后再讨论，不要提前做）

按优先级：

1. **autoResume 现场验证**。当前默认 `false` 是刻意的：resume 基准是 25 条开发用例 +
   20 条 holdout + 1 条 intent-negative 的**合成**集。在没有任何真实使用数据之前不要打开默认值。
2. **发布工程**。目前只有 ad-hoc 签名 + `codesign --verify`，
   **没有** Developer ID / hardened runtime / notarization / stapling。
   这是 distribution 层缺口，不是 P1 地基缺陷，不要混为一谈。
3. **P2**（需要用户明确指示）：browser companion、更多 adapter、P2 UI。

---

## 12. 交接提示词（可直接粘贴给下一个 agent）

```text
项目：/Users/ysradmin/Projects/dsh-computer-history
分支 main，HEAD 95af161，worktree 应为 clean。

任务：让已冻结的 Phase 1 首次在真实 DSH Host + 真实 macOS 会话中运行，并产出验证报告。
不要开始 P2。

先读（按顺序）：
  docs/handoff-phase1-runtime-validation.md   ← 完整交接，含硬约束与必须回答的问题
  ARCHITECTURE.md
  SECURITY.md
  docs/development.md
  docs/decisions/0003-collector-control-acknowledgements.md

已确认事实（不要重新调查）：
  - 插件从未装配进任何 profile，~/.dsh/computer-history 不存在 → 从未采集过真实数据
  - pnpm verify:p1 可通过；204 tests 全绿；native universal build + codesign 正常
  - 所有既有验证都是合成 fixture + 静态审查，没有运行时 AX 证据

硬约束：
  - 采集默认 OFF。未经用户明确同意不要开启真实采集。
  - 真机验证使用一次性 dataDirectory（如 /tmp/dsh-ch-live-*），
    绝不要写 ~/.dsh/computer-history；不要用真实私密文件测试 secure 检测。
  - 只允许 forward commit。禁止 reset --hard / checkout -- . / clean / stash drop /
    rebase / gc --prune / reflog expire（本仓库发生过 commit object 被 prune 的事故）。
  - 真实采集输出不得提交进仓库。

要做的事：
  1. 跑 pnpm verify:p1 确认起点
  2. pnpm build && pnpm native:build
  3. 用 dev_plugin_status 记录基线，dev_inject_plugin 注入本目录，再确认 fiber active
  4. 先在 capture OFF 下验证：Host API 四个端点 + UI 面板渲染
     —— 重点验证 public mount 相对路径（客户端前缀是 'api/computer-history'，
        不是 '/api/computer-history'，此前只用合成 base URL 测过）
  5. 征得用户同意后，用一次性 dataDirectory 开启 capture，采集真实 observation
  6. 逐条回答交接文档第 6 节的 8 个技术未知（AXDocument 实际返回什么、kAXURL CFURL
     解码是否生效、secure 三态在真实密码框上的行为与误杀率、AX timeout 是否防住卡死、
     pause 是否真 detach、多真实进程下 capture lock 是否严格单 owner 等）
  7. 发现缺陷：修 blocker/should-fix + 补回归测试 + 跑完整 Gate
  8. 写 docs/validation-phase1-runtime-YYYY-MM-DD.md（含脱敏后的真实 observation 样例、
     逐条结论、未确认项清单）
  9. forward commit；确认 worktree clean

验收：交接文档第 7 节清单全部满足。无法确认的项必须写"未确认 + 原因 + 需要什么条件"。
```
