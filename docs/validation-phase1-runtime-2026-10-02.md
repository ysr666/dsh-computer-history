# Phase 1 首次真机运行时验证报告

**日期：** 2026-10-02
**验证者：** DSH 会话 `session-afe69e7c`（desktop profile）
**项目目录：** `/Users/ysradmin/Projects/dsh-computer-history`
**起点 commit：** `9034c6e`（交接文档）
**结论一句话：** 插件第一次真正在 DSH Host 里跑了起来。**两个从未被静态审查发现的 blocker 被真机暴露并已修复**（client bundle 格式、cordis 服务访问门禁）；采集链路 A1 类问题在真机上跑通。真机还暴露并修复了第三个缺陷：**Terminal adapter 因 `AXSubrole` 属性不被支持而被全量 fail-closed 丢弃**（修复后真机 8/8 条恢复落库）。此外有 1 个注入器工具链缺陷、若干"未确认"项，均已逐条记录。

---

## 1. 环境

| 项 | 值 |
|---|---|
| macOS | 27.0（build 26A5425a） |
| Arch | arm64（Apple Silicon） |
| Node / pnpm | v24.5.0 / 11.7.0 |
| DSH | 0.2.0-rc.2，profile = `desktop`，webserver `http://127.0.0.1:19387` |
| Accessibility | **已授权**（collector 自报 `accessibilityTrusted: true`；native 直驱亦为 true） |
| 一次性 dataDirectory | `/tmp/dsh-ch-live-20261002-162303`（0700；**从未写入 `~/.dsh/computer-history`**，该路径在验证期间只是指向一次性目录的软链，收尾已删除） |
| 采集产物 | `/tmp/dsh-ch-live-20261002-162303/history.sqlite`（7 条真实 observation，全部来自合成 fixture；未提交进仓库） |
| 原始探针日志 | `/tmp/dsh-ch-probe.log`、`probe2.log`、`probe3.log`、`probe4.log`、`probe5.log` |

## 2. 起点门禁与产物（S0/S1）

`pnpm verify:p1` 全绿：

```text
typecheck 0 errors / oxlint 0 warnings / 204 tests passed
verify:privacy passed / tsdown build ok
INGEST_10000_MS 16714（门限 30000）
native build + codesign --verify --strict OK（universal arm64+x86_64）
```

HEAD `9034c6e`、worktree clean；`lib/index.js` `lib/client.js` `bin/dsh-computer-history-collector` 均在。

## 3. 插件加载（S1b/S5 半）

### 3.1 `dev_inject_plugin` 被拒 → 暴露 blocker #1

首次 `dev_inject_plugin` 返回：

```text
- lib/client.js 的 register 缺合法 name（应为已知 slot：conversation.view / settings.plugin.item / ...）
- slots.register 缺合法 name
- lib/client.js 不是 tsdown bundle（缺 __ModuleLoader__ 特征）
```

逐条定性后：前两条是**注入器白名单过时（误报）**，第三条是**真 blocker**。

- 误报证据：live client `Slots.listSubTree` 显示 `main`（keyed）与 `sidebar.panellist`（list）都是真实存在的根槽位；插件注册目标正确。
- 真 blocker 证据：官方 `@deepseek-ai/dsh-client-ui-renderer/sidebar/layout/connection` 与本机全部第三方 client 插件（annotation / agent-teams / bridge-browser…）的 `lib/client.js` **首行都是** `window.__ModuleLoader__.load({ id, factory: (require) => … })`；本插件原产物是裸 ESM + 裸 import，DSH client loader 无法加载。

**修复（本仓库内，已提交）：**

- `tsdown.config.ts`：client 入口改为 `format: cjs` + `platform: browser` + `__ModuleLoader__` banner/footer/intro + `neverBundle` 外部依赖；host 入口不变；新增独立的声明产出 pass（构建脚本搬运 `lib/client.d.ts`）。
- `src/client/index.ts`：运行时 import 改为**包根 id**（`@deepseek-ai/dsh-client-ui-renderer` 等，与 `dsh.client.inject` 及 loader 的 require 表一致）；`/client` 子路径只保留 **type-only** import（提供 `ctx.slots` 等契约增强，运行时被抹除）。
- `package.json`：`dsh.client.inject` 补 `@deepseek-ai/dsh-client-ui-slots`；build 脚本先清 `lib/` 再构建。

### 3.2 实际加载路径与运行时确认

因注入器白名单误报仍会阻断 `dev_inject_plugin`，本次走**官方装配路径** `dev_install_package`（其不跑 client 骨架校验），再以 staging 通道用显式 `config`（`{enabled:true, dataDirectory:/tmp/...}`）重建实例（`dev_inject_plugin` 硬编码 `config:{}`，无法满足"一次性 dataDirectory"要求）。

- loader：`[active] 1e0e41b9 (dsh-computer-history)`；capture-on 实例 `7280f697`；收尾已摘除。
- **client 半在真实运行中的客户端注册成功**（live `Slots` occupant）：

```json
{"registrant":"mf","id":"computer-history","order":30,"priority":0,"active":true}
```

这是本仓库第一次拿到"UI 半在真实 DSH 客户端里活着"的证据。

## 4. Host API 8 条路由（真实 webserver + 真实鉴权）

webserver 对 `/api/*` 有鉴权（无凭据 → 401 `unauthorized`）。以下使用真实客户端会话凭据请求（仅本地回环，报告不记录凭据值）。

| # | 路由 | capture OFF 实测 | 判定 |
|---|---|---|---|
| 1 | `GET /state` | `200 {"enabled":false,"capture":"stopped","accessibilityTrusted":false,"observationRetentionHours":24,"episodeRetentionDays":30,"autoResume":false}` | ✅ |
| 2 | `GET /policy` | `200 mode=include-only`，12 条 builtin protect（5 app + 7 resource：1password/bitwarden/dashlane/keychainaccess/lastpass；`*credentials*`/`*/.env`/`*/.env.*`/`*.key`/`*.pem`/`*secrets*`/`*/.ssh/*`） | ✅ |
| 3 | `GET /recent` | `200 []` | ✅ |
| 4 | `GET /search?q=x` | `200 []`；缺 `q` → `400 Missing q.` | ✅ |
| 5 | `GET /episode?id=…` | `404 Not found.` | ✅ |
| 6 | `POST /pause`（capture OFF） | `409 computer history capture is disabled` | ✅ |
| 7 | `POST /policy`（owner） | `200`，revision 1→2，规则数 12→13 | ✅ |
| 8 | `POST /delete` | `200 {"observationsDeleted":0,"episodesDeleted":0,"episodesRebuilt":0}` | ✅ |

**public mount 相对前缀（交接重点项）**：服务端实测 `/` 返回 SPA HTML（`<base href="./">`，507 KB），`/session/test` → **404**（无 path-based 路由，应用根挂载），客户端相对前缀 `api/computer-history` 解析为 `/api/computer-history` ✅。子路径挂载（如 `/dsh/`）在本次环境不可构造，仍未实测。

### 4.1 capture OFF 阶段暴露 blocker #2（已修复）

上述路由第一次实测时**全部 500/503**；插件自身注册的 agent 工具抛：

```text
Error: cannot get property "computerHistory" without inject
```

根因：插件通过子 fiber 提供 `computerHistory` 服务，自己的消费者却用 `ctx.computerHistory` 属性访问；cordis 的 inject 门禁要求属性访问必须声明 `inject`，而"自己 provide 自己 inject"会死锁，故属性访问必然抛错。**既有 204 个测试全部使用"假的 ctx 对象 + 直接挂 `computerHistory` 属性"的 harness，因此长期掩盖了该缺陷。**

修复：新增 `computerHistoryService(ctx)`（走 cordis 文档化的无 inject 访问器 `ctx.get()`）并在 `routes.ts` / `agent/tools.ts` / `resume-hint.ts` 三处使用；同时把单测 harness 改为 `get()` 语义（旧代码在更新后的 harness 下会失败，构成回归护栏）。

修复后：8 条路由全部符合预期（上表），`computer_history_recent/search/episode` 三个 agent 工具恢复可用。

## 5. 采集链路（capture ON，一次性目录）

`/state` → `{"enabled":true,"capture":"running","accessibilityTrusted":true,"collector":{"version":"0.1.0","arch":"arm64"}}`；helper 为仓库内真实二进制（`bin/dsh-computer-history-collector`，PID 82077）。

### 5.1 原生直驱（Host 过滤前的原始值）

同一二进制经 stdio NDJSON 直驱（探针脚本在 `/tmp`，未入库）。首行即 hello（含 4 项 capability），5s 内完成；`state` 报 `running/accessibilityTrusted:true`；`configure` → `configured(revision)` ack 正常。

**A2 — kAXDocument 实际返回值：**

| App | 原始 window 字段 | 结论 |
|---|---|---|
| Finder | `{"title":"dsh-live-fixtures"}`，**无 document / url** | kAXDocument 为 nil；Host 侧 `resource_id` 为空（库里 7 条 Finder 全为空） |
| Preview（合成 PDF） | `{"document":"file:///private/tmp/dsh-live-fixtures/preview-fixture.pdf","title":"preview-fixture.pdf – 1页"}`，两次可复现 | 文档型应用可拿到 **file:// URL**，资源识别成立 |
| Terminal | **无 window / element 字段**，`privacy.secure=true, reason=unreadable-focused-element`（3/3） | focused element 不可读 → fail-closed，见 §6 F4 |
| VS Code | 未能实测 | `/Applications/Visual Studio Code.app` 是本机一个**不可启动的假壳**（`Contents/MacOS/Code` 实为 Node 脚本，直接执行报 `SyntaxError: Unexpected token '<'`；`open` 后无进程）。本机无 Cursor |

**A3 — kAXURL CFURL 解码：未确认。** 在 Finder / Terminal / Preview 的真实 observation 中 `window.url` **从未出现**（即 AXURL 均为 nil）；浏览器类应用没有 adapter，无法构造 AXURL 场景。修复后的 `CFURLGetTypeID + absoluteString` 路径在真机上**未被触发**，需要"AXURL 会返回值的应用/场景"才能确认（条件见 §8）。

### 5.2 真实 observation 落库（脱敏样例）

```json
{"bundle_id":"com.apple.finder","app_name":"访达","surface_kind":"window",
 "window_title":"dsh-live-fixtures","resource_id":"",
 "privacy_secure":0,"source_provider":"native","source_adapter":"finder"}
```

库内共 7 条（2 个 collector session），全部为上述 Finder 合成 fixture；无任何真实私密文件/内容进入采集。

### 5.3 A6 — pause 真 detach

- `POST /pause` → `200 {"capture":"paused"...}`（协议要求 native `paused` ack 完成才返回，200 即 ack 往返成功）。
- paused 期间主动把 Finder 切到前台并等待 12s → **observation 计数不变（4）**。
- `POST /resume` → `200 {"capture":"running"}`；随后同一 Finder 窗口产生**新** observation（seq 5）→ observer 确实重新挂上。

### 5.4 A5 — 0.5s AX timeout

**部分确认。** Terminal 的 `unreadable-focused-element` 路径本身就是一次"读不到就放弃、不阻塞"的实证：collector 在该次读失败后继续正常产出其他 app 的 observation，Host 全程无 `configure-ack-timeout` / `paused-ack-timeout`，`/state` 无 degraded。对支持应用做 SIGSTOP 的人为无响应实验**未能观察到新状态**（指纹未变化被抑制），故"卡死防护"缺少人为最坏用例证据，列为部分确认（条件见 §8）。

### 5.6 F4 修复的真机复验

```text
修复前（probe4/5，Terminal 前台）:
  {"adapter":"terminal","privacy":{"secure":true,"reason":"unreadable-focused-element"}}   ×3/3，无 window/element
修复后（probe7，Terminal 前台）:
  {"adapter":"terminal","privacy":{"secure":false},"element":{"role":"AXTextArea"}}
  {"adapter":"terminal","privacy":{"secure":false},"window":{"document":"file:///tmp/dsh-live-fixtures/"}}
  … 共 8/8 条不再被丢
```

AX 探针（`/tmp/dsh-ax-probe`，用 native 构建同一 swiftc 编译）对 Terminal/PID 2041 的原始读取：

```text
focusedElement role(err=0 value=AXTextArea) subrole(err=-25205 value=nil)
focusedWindow  role(err=0 value=AXWindow)  subrole(err=0 value=AXStandardWindow)
window document(err=0 value=file:///tmp/dsh-live-fixtures/)
window axurl(err=-25205 value=nil)   ← kAXURL 属性不被 Terminal 支持
```

### 5.5 C10 — helper 退出未确认仍释放锁

- **崩溃路径**：`kill -9` helper（PID 82077）→ 3s 内自动拉起新 helper（PID 83920），`/state` 仍 `running`，采集继续落库（计数 +1）。
- **dispose 路径**：摘除 loader entry 后 helper 停止、`capture-owner.lock` **被删除**（释放成功）、DB WAL/SHM 收拢后关闭。
- `collector-exit-unconfirmed` 这一具体分支本轮**未被触发**（未出现 helper 无法确认退出的场景）。

## 6. 缺陷清单

| ID | 严重度 | 状态 | 描述与证据 |
|---|---|---|---|
| F1 | **blocker** | **已修复** | client bundle 缺 `__ModuleLoader__` 包装、且 import 了 loader 不注册的 `.../client` 子路径 id → UI 半根本加载不了。修复后 live Slots occupant 为 active。 |
| F2 | **blocker** | **已修复** | 插件用 `ctx.computerHistory` 访问自己提供的服务 → cordis 抛 `without inject`，8 条路由全 500/503、agent 工具不可用；204 个既有测试因"假 ctx"未覆盖。改用 `ctx.get()`；测试 harness 同步改为真语义。 |
| F3 | 中（工具链） | **已报告未修** | `dsh-super-injector` v0.3.3 的 `KNOWN_SLOTS` 白名单过时：`main`、`sidebar.panellist` 等 live 槽位被误判为坏骨架，阻断合法插件注入。建议白名单补全 live slots，或改为查询运行中 client Slots 拓扑。证据：live `Slots.listSubTree`。 |
| F4 | **blocker（已修复）** | 已修复 + 真机复验 | Terminal adapter 曾 3/3 判 `unreadable-focused-element` → `privacy.secure=true` → Host drop，**Terminal 观测事实性归零**。根因（AX 探针实测）：Terminal 的 focused element 是 `AXTextArea`，`kAXSubroleAttribute` 返回 `-25205 = kAXErrorAttributeUnsupported`；原 `isSecureElement` 把所有非 success 一律当 `.unreadable`，触发 fail-closed。修复：把"属性不存在/不支持"与"读取失败/超时"分开——前者的角色不是 `AXTextField` 时判 `.notSecure`（secure 字段由 `AXSecureTextField` subrole 定义），是 `AXTextField` 或读取失败/超时仍 fail-closed；分类逻辑抽成纯函数 `classifySecureFieldState`。修复后真机 8/8 条 `secure:false`，并带 `document:file:///tmp/dsh-live-fixtures/`。 |
| F5 | 记录 | — | Finder 的 kAXDocument 为 nil → `resource_id` 空；Preview 的 document 为 file:// URL → 资源可用。resource 识别能力随 app 不同而分裂，产品假设需按 app 记账。 |
| F6 | 环境 | — | 本机 VS Code 为不可启动的假壳；编辑器 adapter（`vscode`）无法真机验证。 |
| F7 | 范围 | — | 浏览器类 app 无 adapter：交接文档 §4.1 建议的"本地 HTML 假密码框"测法在当前 Phase 1 适配器集下**不可达**；同理 kAXURL 也缺少可触发场景。 |
| F8 | 中（工具链） | 已修文件 / 需重启激活 | `dsh-super-injector` 自重载路径自身有缺陷：`dev_reload_package dsh-super-injector` 会自毁并排程重建，但重建失败——`self-heal.log`：`reboot-failed: Error: selfEntry 无官方 _dispose（loader 契约缺失）`。后果：运行中实例继续用旧代码，磁盘上的修复要等 **DSH Host 重启**才生效（profile 从 patched lib 重新装配）。 |

## 7. §7 验收清单

```text
[x] 插件能注入并 active（dev_install_package + staging loader.create；loader 可见、fiber active）
[x] Host API 端点真实响应符合预期（8/8；public mount 相对前缀在根挂载下成立）
[x] UI 面板在真实客户端注册成功（Slots occupant active）；空状态由路由 200 [] 佐证
[x] capture 开启后采集到真实 observation 并落库（一次性目录，7 条）
[x] 记录真实 observation 字段（app/adapter/window/privacy/resource 实际情况见 §5）
[~] §6 八问：A1 ✅ / A2 部分（Finder、Preview ✅；Terminal 修复后 ✅ 真机复验；VS Code 未确认）
     A3 未确认 / A4 误杀已修复并真机复验（阳性路径仍不可达）/ A5 部分 / A6 ✅
     B7 ✅ / B8 ✅ / C9 ✅ / C10 部分
[x] 缺陷：修 blocker #1/#2/#3（Terminal fail-closed）+ 补回归护栏（client 契约、ctx.get 语义、secure 分类分支）+ 本报告
[x] 验证报告落盘（本文件）
[ ] worktree clean + forward commit（见 §9）
```

## 8. 仍未确认（原因 + 需要什么条件）

| 项 | 原因 | 需要什么条件 |
|---|---|---|
| kAXURL CFURL 解码是否生效 | 支持应用（Finder/Terminal/Preview）AXURL 实测均为 nil；浏览器无 adapter | 一个 AXURL 有值的应用/场景（如接入 browser adapter，或支持应用出现该属性） |
| VS Code 的 kAXDocument | 本机 VS Code 是不可启动假壳 | 安装可启动的 VS Code 或 Cursor 后重跑探针 |
| secure 三态在"真实密码框"的阳性路径 | 支持应用里没有 secure 字段；浏览器无 adapter | 支持应用中出现真实 secure 字段，或加一个测试专用 adapter；fail-closed 误杀（Terminal）已定位并修复、真机复验 8/8 |
| 0.5s timeout 对真正卡死应用 | SIGSTOP 实验未产生可观察状态变化 | 可复现的 AX 无响应场景（如 AX 层阻塞的 app / 注入故障） |
| `collector-exit-unconfirmed` 分支 | 未触发 | 构造"helper 退出无法确认"的故障注入 |
| 子路径挂载下的 public mount | 本环境根挂载 | 一个子路径部署的 DSH web 实例 |
| 注入器白名单补丁在运行中生效 | 注入器自重载路径失败（F8），运行实例仍是旧代码 | 重启 DSH Host 后 profile 从 patched lib 装配；restart 后 `dev_inject_plugin` 应直接放行 `main`/`sidebar.panellist` |

## 9. 变更与提交

本仓库改动（全部为 blocker 修复 + 回归护栏，未动 §9 已记录取舍）：

```text
tsdown.config.ts                        client bundle 格式 + 声明产出
src/client/index.ts                     运行时常量改包根 id；type-only 契约增强
package.json                            dsh.client.inject 补 slots；build 脚本确定性清目录
src/host/service/computer-history-service.ts   新增 ctx.get() 访问器 helper
src/host/api/routes.ts                  改用 helper（8 条路由）
src/agent/tools.ts                      改用 helper（3 个工具）
src/agent/resume-hint.ts                改用 helper
native/macos/Sources/ComputerHistoryCollector/Privacy.swift  secure 三态分类抽成纯函数 + 缺失/不支持 subrole 的角色守卫
native/macos/Tests/ComputerHistoryCollectorTests/PrivacyTests.swift  secure 分类分支测试
scripts/test-native.mjs                 secure 分类分支 native 回归断言
tests/unit/host-api.spec.ts             harness 改为 ctx.get() 语义
tests/unit/agent-tools.spec.ts          同上
tests/unit/resume-hint-lifecycle.spec.ts 同上
tests/integration/plugin-multi-host.spec.ts 同上
```

仓库外（不进 git，运行中生效需重启 Host，见 F8）：

```text
~/.dsh/external/dsh-super-injector/lib/index.js         KNOWN_SLOTS 11 → 91（同步 live client 拓扑）
~/.dsh/dsh-routing-suite/injector/src/index.ts          同上（源码副本）
备份: /tmp/dsh-super-injector-lib-index.js.bak-*、/tmp/dsh-super-injector-src-index.ts.bak-*
```

验证期间的环境改动已全部还原：profile `package.json` / `cordis.patch.yml` 由备份恢复并 diff 通过；junction、`~/.dsh/computer-history` 软链、loader entry、staged 工具均已移除；helper 进程已停止。一次性目录仅保留证据 DB。
