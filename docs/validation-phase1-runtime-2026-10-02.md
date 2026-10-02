# Phase 1 首次真机运行时验证报告

**日期：** 2026-10-02
**验证者：** DSH 会话 `session-afe69e7c`（desktop profile）
**项目目录：** `/Users/ysradmin/Projects/dsh-computer-history`
**起点 commit：** `9034c6e`（交接文档）
**结论一句话：** 插件第一次真正在 DSH Host 里跑了起来。**两个从未被静态审查发现的 blocker 被真机暴露并已修复**（client bundle 格式、cordis 服务访问门禁）；采集链路 A1 类问题在真机上跑通。真机还暴露并修复了第三个缺陷：**Terminal adapter 因 `AXSubrole` 属性不被支持而被全量 fail-closed 丢弃**（修复后真机 8/8 条恢复落库）。此外有 1 个注入器工具链缺陷、若干"未确认"项，均已逐条记录。

---

## 0. 快速交接摘要（重启后先读这一节）

**当前状态**：Phase 1 已在真实 DSH Host + 真实 macOS 会话中跑通；三个 blocker 已修复并真机复验（client bundle 格式、cordis inject 门禁、Terminal fail-closed）；A4/A5 已用受控合成 fixture 双向验证；环境已还原；worktree clean。
commit 链：`62cb5a1 → ef8d4bc → 551f4bc → d34a823 → 6e426e6 → b10fe2b → 554223b → cb1753f → 226c86e`。

**N1 已完成（2026-10-02 17:55，DSH 重启后实测）**：

1. `dev_plugin_status` → 注入器从**打过补丁的 lib** 重新装配（entry URL 正常，不再是上轮那个幽灵条目）；
2. `dev_inject_plugin {dir: 仓库}` → **校验放行**（不再报 `main`/`sidebar.panellist` 不在白名单）——KNOWN_SLOTS 补丁确认生效；
3. Host 侧：`GET /api/computer-history/state` → `200 {"enabled":false,"capture":"stopped",...}`（capture OFF 默认值正确），插件 agent 工具 `computer_history_*` 进入工具表；
4. client 侧：`sidebar.panellist` occupant `{id:"computer-history", order:30, active:true}`；
5. `pnpm verify:p1` exit 0；随后卸载 entry、删 junction/软链、清 profile 残留，环境还原。

> 注入时的坑（见 F10）：`dev_inject_plugin` 把 junction 建到了 `profiles/web`，而运行 Host 是 desktop profile → 返回 `host ✗ / client ✗`。运行期注入 desktop 需"手工 desktop junction + staging `loader.create`"（本轮即如此完成）。

**仍未确认（条件项，不是欠账）**：

- 真 VS Code/Cursor 的 kAXDocument 语义 —— adapter 契约已由合成 app 覆盖（§5.5）；`brew install --cask visual-studio-code`（本机有 brew 6.0.18、无本地缓存）后用 `/tmp/dsh-ch-probe.mjs` + 编辑器前台复测；
- 注入器自重载补丁 (A)(B) 未验证（见 F8）——需要一次成功的自重载才能执行；
- 三个"已归位"项：kAXURL 无触发场景（解码已单测锁定）、helper-exit 分支已有单测且真机不可构造、子路径挂载无环境。

**证据位置**：`/tmp/dsh-ch-probe*.log`（原生直驱原始 NDJSON）、`/tmp/dsh-ch-e2e-20261002-170930/history.sqlite`（A4 端到端）、`/tmp/dsh-fixture-app/main.swift`（合成 fixture 源码，secure/plain/hung 三模式）、注入器补丁备份 `/tmp/dsh-*.bak-*`。

**注意**：`/tmp` 证据是机器级的、goal/todo 是会话级的（重启不继承）；仓库级以本报告 + commit 链为准，续做看 §10。

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
| VS Code | 未能实测（真 app 不可启动） | `/Applications/Visual Studio Code.app` 是本机一个**不可启动的假壳**（`Contents/MacOS/Code` 实为 Node 脚本，直接执行报 `SyntaxError: Unexpected token '<'`；`open` 后无进程）。本机无 Cursor。**adapter 契约已用合成 app 单独验证**，见 §5.5 |

**A3 — kAXURL CFURL 解码：真机场景不存在，解码逻辑已单测锁定。**
用 native 构建同一套 swiftc 编了一个现场探针（`/tmp/dsh-ax-url`，直接编译 `Privacy.swift`/`SupportedApps.swift` 并调用其中的 `safeURL`/`safeString`），对真实运行的应用窗口逐个读属性：

```text
Google Chrome: axurl err=-25205(attributeUnsupported) typeID=nil
               document=https://chatgpt.com/g/g-…/c/…      ← 浏览器把页面 URL 放在 AXDocument
               title=桌面自动化测试经验 - Google Chrome
Finder:        axurl err=-25205 / err=-25212(noValue)，document=nil（下载窗口）
Terminal:      axurl err=-25205，document=file:///Users/ysradmin/
```

即：**本机所有被探测的应用（含浏览器）都不支持 `kAXURL`**；需要位置的应用把它放在 `kAXDocument`（字符串形式）。因此"修复后的 CFURL 分支是否真机拿到值"这个问题，在当前 Phase 1 适配器集（VSCode/Terminal/Preview/Finder）内**没有触发场景**——修复本身已按纯函数 `decodeURLAttribute` 锁定：CFURL 与字符串两种形式都解码，数字/空串/nil 一律 nil（native precondition + XCTest 覆盖，见 §9）。

### 5.2 真实 observation 落库（脱敏样例）

```json
{"bundle_id":"com.apple.finder","app_name":"访达","surface_kind":"window",
 "window_title":"dsh-live-fixtures","resource_id":"",
 "privacy_secure":0,"source_provider":"native","source_adapter":"finder"}
```

库内共 7 条（2 个 collector session），全部为上述 Finder 合成 fixture；无任何真实私密文件/内容进入采集。

**前置条件（产品语义，必须记录）**：collector 的 `allowedBundleIds` 来自 policy 中 `action='allow'` 的规则（`manager.ts` 的 `bundleIdsFor('allow')`），而初始策略只有 12 条 **protect** 规则 —— 即 **include-only + 无 allow 规则 = 什么都不采**（这正是"未经用户明确同意不采集"的默认）。本节那 7 条能落库，是因为前一节的路由验证里我通过 `POST /policy`（owner）加了一条 `allow com.apple.finder`。首次端到端 A4 复现时因为没有 allow 规则，Finder 与 fixture 都不落库，加上 `allow com.microsoft.VSCode` 后立刻恢复。

### 5.3 A6 — pause 真 detach

- `POST /pause` → `200 {"capture":"paused"...}`（协议要求 native `paused` ack 完成才返回，200 即 ack 往返成功）。
- paused 期间主动把 Finder 切到前台并等待 12s → **observation 计数不变（4）**。
- `POST /resume` → `200 {"capture":"running"}`；随后同一 Finder 窗口产生**新** observation（seq 5）→ observer 确实重新挂上。

### 5.4 A5 — 0.5s AX timeout（已用受控卡死 fixture 验证）

用合成 fixture 造出**真正的主线程卡死**（`mode=hung`：窗口显示后阻塞主线程 6s），再用 ack 计时探针在冻结期间发 `pause`，测 native 侧 `paused` ack 的延迟：

```text
control（app 响应正常）:            pauseDelay 3000ms -> pausedAckMs 0
hung（冻结 6s 期间，三个时点）:     pauseDelay 3500ms -> pausedAckMs 566
                                  pauseDelay 5500ms -> pausedAckMs 975
                                  pauseDelay 1500ms -> pausedAckMs 0（冻结尚未开始）
```

结论：**0.5s per-element messaging timeout 确实兜住了**——前台应用冻结 6s，helper 的同步 AX 工作最多把控制 ack 推迟约 0.6–1.0s，而不是被冻结时长拖住。Host 全程无 `configure-ack-timeout` / `paused-ack-timeout`，`/state` 无 degraded；Terminal 的 `unreadable-focused-element` 也印证了"读不到就放弃、继续跑"。

### 5.5 编辑器 adapter 契约（合成 app，答案分层）

真 VS Code 不可用，于是把"adapter 映射 + AXDocument 管线"从"真实 VS Code 语义"里拆出来单独验证：临时造了一个最小 AppKit app（bundle id **`com.microsoft.VSCode`**，`NSWindow.representedURL` 指向合成文件），用真 collector 观察：

```json
{"seq":1,"source":{"adapter":"vscode"},"app":{"bundleId":"com.microsoft.VSCode"},
 "window":{"title":"normal-text.html","document":"file:///tmp/dsh-live-fixtures/normal-text.html"},
 "element":{"subrole":"AXStandardWindow","role":"AXWindow"},
 "privacy":{"secure":false}}
```

结论分层：
- ✅ **已验证**：bundle-id → adapter 映射（`vscode`）、`NSWindow.representedURL → kAXDocument(file://…)` → observation 的管线成立；文件型应用的 resource 有值。
- ❓ **仍未确认**：真实 VS Code 的 AXDocument 究竟是文件路径、`file://` URL 还是 vscode 自己的 URI scheme —— 需要可启动的真 VS Code/Cursor（N2）。

fixture 用完即删（app bundle 已移除，进程已退出），不留在系统里冒用真实 bundle id。

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

**规则二次修正（同一 fixture 逼出来的）**：第一版修复对"`AXTextField` 且无 subrole"仍 fail-closed。合成 app 量出 secure 与 plain 的唯一差别正在 subrole：

```text
NSSecureTextField（secure）: role=AXTextField  subrole=AXSecureTextField   -> secure ✅
NSTextField      （plain） : role=AXTextField  subrole=-25205(unsupported) -> 第一版误杀 ❌
AXTextArea（Terminal）     : role=AXTextArea   subrole=-25205(unsupported) -> 第一版已修 ✅
```

即"属性不存在/不支持"是**正向证据**（不是 secure 字段），只有**读取失败**才该 fail-closed。修正后真机复验：

```text
secure fixture: {"privacy":{"secure":true,"reason":"secure-field"}} ×4/4，window/element 全被扣留
plain  fixture: {"privacy":{"secure":false},"window":{"document":"file:///…"},"element":{"role":"AXTextField"}} ×9/9
```

→ A4 的三态在**真实 AX 元素**上双向验证：真实 secure 字段被识别并丢元数据；普通文本框不再被误杀。

### 5.8 A4 端到端：Host 直接丢弃 secure observation（一次性目录 `/tmp/dsh-ch-e2e-20261002-170930`）

collector 级证据之外，补上"Host ingestion 是否真的丢"的闭环：同一注入实例（capture ON、一次性 dataDirectory、policy 显式 `allow com.microsoft.VSCode`），先后把 fixture 切到前台：

```text
plain 阶段（前台 12s）: observations total 1 | privacy_secure 0
                        row = {bundle_id: com.microsoft.VSCode, window_title: dsh-fixture-plain}
                        resources = {id 1, kind file, canonical_uri file:///private/tmp/dsh-live-fixtures/normal-text.html}
secure 阶段（前台 10s）: rows before 1 -> after 1（delta 0）| secure_rows 0
```

即：secure 观察在 collector 侧确实产生（§5.6 探针 4/4 证明），但**Host 端一条都没落库**——fail-closed 从原生层到存储层全程成立；plain 对照同时证明落库路径（含 resource 规范化）正常。

### 5.7 C10 — helper 退出未确认仍释放锁

- **崩溃路径**：`kill -9` helper（PID 82077）→ 3s 内自动拉起新 helper（PID 83920），`/state` 仍 `running`，采集继续落库（计数 +1）。
- **dispose 路径**：摘除 loader entry 后 helper 停止、`capture-owner.lock` **被删除**（释放成功）、DB WAL/SHM 收拢后关闭。
- `collector-exit-unconfirmed` 这一具体分支本轮**未被触发**（未出现 helper 无法确认退出的场景）。

## 6. 缺陷清单

| ID | 严重度 | 状态 | 描述与证据 |
|---|---|---|---|
| F1 | **blocker** | **已修复** | client bundle 缺 `__ModuleLoader__` 包装、且 import 了 loader 不注册的 `.../client` 子路径 id → UI 半根本加载不了。修复后 live Slots occupant 为 active。 |
| F2 | **blocker** | **已修复** | 插件用 `ctx.computerHistory` 访问自己提供的服务 → cordis 抛 `without inject`，8 条路由全 500/503、agent 工具不可用；204 个既有测试因"假 ctx"未覆盖。改用 `ctx.get()`；测试 harness 同步改为真语义。 |
| F3 | 中（工具链） | **已修复 + 重启后验证** | `dsh-super-injector` v0.3.3 的 `KNOWN_SLOTS` 白名单过时（11 条），把 live 槽位 `main`、`sidebar.panellist` 误判为坏骨架，阻断合法插件注入。已按 live client 拓扑补到 91 条（built lib + source 双份）；DSH 重启后 `dev_inject_plugin` **放行**（N1 通过）。证据：live `Slots.listSubTree` + 重启前后两次注入返回对比。 |
| F4 | **blocker（已修复，规则经二次修正）** | 已修复 + 真机双向复验 | Terminal adapter 曾 3/3 判 `unreadable-focused-element` → `privacy.secure=true` → Host drop，**Terminal 观测事实性归零**。根因（AX 探针实测）：focused element 的 `kAXSubroleAttribute` 返回 `-25205 = kAXErrorAttributeUnsupported`，原 `isSecureElement` 把所有非 success 一律当 `.unreadable`。修复分两步：(1) 把"属性不存在/不支持"与"读取失败/超时"分开，分类抽成纯函数 `classifySecureFieldState`；(2) 合成 fixture 量出 secure 与 plain 的唯一差别就是 subrole 是否存在（`NSSecureTextField` → `AXSecureTextField`；`NSTextField`/`AXTextArea` → `attributeUnsupported`），于是去掉"`AXTextField` 无 subrole 仍 fail-closed"这条会误杀**普通文本框**的守卫，只保留**读取失败**才 fail-closed。真机复验：Terminal `secure:false` 8/8（含 document）、plain 文本框 `secure:false` 9/9、真实 secure 字段 `secure:true/secure-field` 4/4 且 window/element 全扣留。端到端（§5.8）：secure 前台 10s → Host 落库 **delta 0**、`secure_rows=0`；plain 对照落库 1 条并生成 `file` resource。 |
| F5 | 记录 | — | Finder 的 kAXDocument 为 nil → `resource_id` 空；Preview 的 document 为 file:// URL → 资源可用。resource 识别能力随 app 不同而分裂，产品假设需按 app 记账。 |
| F6 | 环境 | — | 本机 VS Code 为不可启动的假壳（`Contents/MacOS/Code` 实为 Node 脚本），故**真实** VS Code 语义不可验证；但 bundle-id→adapter 映射与 AXDocument 管线已用合成 app 验证（§5.5），故此项只剩"真 app 语义"这一层。 |
| F7 | 范围 | — | 浏览器类 app 无 adapter：交接文档 §4.1 建议的"本地 HTML 假密码框"测法在当前 Phase 1 适配器集下**不可达**；同理 kAXURL 也缺少可触发场景。 |
| F8 | 中（工具链） | 已打补丁 / 运行中仍未激活 | `dsh-super-injector` 自重载路径有三处缺陷，本轮全部定位：(A) 复工器硬要求 `entry._dispose`，而 DSH 0.2.0-rc.2 的 loader entry **没有该 API**（实测 dump：`_dispose: undefined`，但 `fiber.dispose` / `entry.update` / `entry.refresh` / `parent.remove` 均为 function）→ `reboot-failed: selfEntry 无官方 _dispose`；(B) reload 的"磁盘降级"路径 import 后只在注入器**私有 loadCache** 里找 URL，而裸 `ctx.loader.import` 不写该缓存，且首次自毁已把缓存删空 → 永远匹配不到；(C) 更深一层：即使补 (B)，`dev_reload_package dsh-super-injector` 仍返回 `缓存中无匹配且磁盘降级失败`（失败点在 entry/URL 匹配更早处，未继续深挖）。已对 (A)(B) 打补丁（built lib + source 双份，备份 `/tmp/dsh-injector-rebuilder-*.bak-*`、`/tmp/dsh-injector-fallback-*.bak-*`），但**本会话无法验证**——它们只在一次成功的自重载里才会执行，而 (C) 挡住了触发。后果不变：**注入器代码改动必须重启 DSH Host 才生效**。附：首次失败后自愈日志有 `heal-ok: 第 1 次 touch patch 官方重装配成功`，但运行实例仍是旧代码（再调 `dev_inject_plugin` 报旧的 11 条白名单）。 |
| F9 | 记录 | — | 需要位置信息的应用把 URL 放在 **`kAXDocument`**（Chrome 实测 `https://chatgpt.com/...`，Preview/Terminal 为 `file://...`），`kAXURL` 在这些应用上返回 `kAXErrorAttributeUnsupported`。若将来加 browser adapter，位置应读 AXDocument；`safeURL` 的 CFURL 分支仍保留防御。 |
| F10 | 中（工具链） | 已记录 | `dev_inject_plugin` 的 profile 目标与运行 Host 不一致：重启后本轮它把 junction 建到 `profiles/web`（返回 `host ✗ / client ✗`），而 Host 实际跑在 desktop profile。运行期注入 desktop 需"手工 `profiles/desktop/node_modules` junction + staging `loader.create`"（N1 即以此完成）。另外 `dev_uninject_plugin` 会往**它选中的那个 profile** 的 `cordis.patch.yml` 写 `disabled` 残留行（本轮已手工清除 `profiles/web` 的那两行）。 |

## 7. §7 验收清单

```text
[x] 插件能注入并 active（dev_install_package + staging loader.create；loader 可见、fiber active）
[x] Host API 端点真实响应符合预期（8/8；public mount 相对前缀在根挂载下成立）
[x] UI 面板在真实客户端注册成功（Slots occupant active）；空状态由路由 200 [] 佐证
[x] capture 开启后采集到真实 observation 并落库（一次性目录，7 条）
[x] 记录真实 observation 字段（app/adapter/window/privacy/resource 实际情况见 §5）
[~] §6 八问：A1 ✅ / A2 部分（Finder、Preview、Terminal 修复后 ✅ 真机复验；编辑器 adapter 契约 ✅ 合成 app，真实 VS Code 语义未确认）
     A3 场景不存在+解码已单测锁定 / A4 ✅ 双向真机复验（secure 4/4 识别、plain 9/9 不误杀、Terminal 8/8 恢复、Host 端 drop 端到端见 §5.8）/ A5 ✅ 受控卡死实测 / A6 ✅
     B7 ✅ / B8 ✅ / C9 ✅ / C10 部分（分支已有单测，真机不可构造）
[x] 缺陷：修 blocker #1/#2/#3（Terminal fail-closed）+ 补回归护栏（client 契约、ctx.get 语义、secure 分类分支）+ 本报告
[x] 验证报告落盘（本文件）
[x] worktree clean + forward commit（`62cb5a1 … 226c86e`，见 §9）
```

## 8. 仍未确认（原因 + 需要什么条件）

| 项 | 原因 | 需要什么条件 |
|---|---|---|
| kAXURL CFURL 解码是否生效 | 真机探测的所有应用（Chrome/Finder/Terminal）都返回 `kAXErrorAttributeUnsupported`，没有可触发场景 | 已单测锁定解码逻辑；若将来出现 AXURL 有值的应用，可直接用 `/tmp/dsh-ax-url` 样式探针复测 |
| 真实 VS Code 的 kAXDocument 语义 | 本机 VS Code 是不可启动假壳；bundle-id→adapter 映射与 AXDocument 管线已用合成 app 验证（§5.5） | 安装可启动的 VS Code 或 Cursor，用 `/tmp/dsh-ch-probe.mjs` + 编辑器前台复测 |
| secure 三态在"真实密码框"的阳性路径 | ✅ 已用合成 fixture 关闭（含 Host 端 drop 端到端）：真实 `NSSecureTextField`（空值、非真实凭据）被识别为 `secure-field`、元数据扣留、Host 落库 delta 0；plain 文本框对照落库且不误杀 | 若要覆盖"真实应用自身的密码框"，需支持应用中出现 secure 字段（浏览器无 adapter）；fixture 源码 `/tmp/dsh-fixture-app/main.swift` 可复用 |
| 0.5s timeout 对真正卡死应用 | ✅ 已用合成 fixture 关闭：冻结 6s 期间 `paused` ack 最大 975ms（对照 0ms） | — |
| `collector-exit-unconfirmed` 分支 | 未触发 | 单测已覆盖该分支（释放锁 + 记 degraded）；真机触发需 helper 存活 SIGKILL，不可构造，故不再作为真机待办 |
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
native/macos/Sources/ComputerHistoryCollector/Privacy.swift  secure 分类纯函数（缺失/不支持 subrole = 非 secure；仅读取失败 fail-closed）；kAXURL 解码抽成 decodeURLAttribute
native/macos/Tests/ComputerHistoryCollectorTests/PrivacyTests.swift  secure 分类 + URL 解码分支测试
scripts/test-native.mjs                 secure 分类 + URL 解码分支 native 回归断言
tests/unit/host-api.spec.ts             harness 改为 ctx.get() 语义
tests/unit/agent-tools.spec.ts          同上
tests/unit/resume-hint-lifecycle.spec.ts 同上
tests/integration/plugin-multi-host.spec.ts 同上
```

仓库外（不进 git，运行中生效需重启 Host，见 F8）：

```text
~/.dsh/external/dsh-super-injector/lib/index.js         KNOWN_SLOTS 11 → 91（同步 live client 拓扑）；复工器改用 fiber.dispose（本轮）；reload 磁盘降级 URL 兜底（本轮）
~/.dsh/dsh-routing-suite/injector/src/index.ts          同上（源码副本，三处同步）
备份: /tmp/dsh-super-injector-lib-index.js.bak-*、/tmp/dsh-super-injector-src-index.ts.bak-*、/tmp/dsh-injector-rebuilder-*.bak-*、/tmp/dsh-injector-fallback-*.bak-*
```

验证期间的环境改动已全部还原：profile `package.json` / `cordis.patch.yml` 由备份恢复并 diff 通过；junction、`~/.dsh/computer-history` 软链、loader entry、staged 工具均已移除；helper 进程已停止。一次性目录仅保留证据 DB。

真机验证用的临时探针/夹具（均不入仓库，用完即删或留在 /tmp）：

```text
/tmp/dsh-ch-probe.mjs        原生直驱探针（原始 NDJSON）
/tmp/dsh-ch-ack-probe.mjs    pause ack 计时探针（A5）
/tmp/dsh-ax-probe.swift      AX 属性探针（secure 字段 / subrole / AXURL 诊断）
/tmp/dsh-ax-url-src/main.swift  AXURL 探测（链接仓库 Privacy.swift）
/tmp/dsh-fixture-app/main.swift 合成 fixture app 源码（secure/plain/hung 三模式；app bundle 用完即删）
/tmp/dsh-verify-injector-patch.mjs  注入器补丁离线复演
/tmp/dsh-ch-e2e-20261002-170930/history.sqlite  A4 端到端证据库（1 条 plain observation + 1 条 file resource；secure 阶段 delta 0）
```

## 10. 下一阶段（重启后按序执行）

本阶段已收口：真机验证、三个 blocker 修复（client bundle 格式 / cordis inject 门禁 / Terminal fail-closed）、A4/A5 受控夹具闭环、环境还原、forward commit 链见 §0。下一阶段每完成一步就更新本报告：

| # | 动作 | 前置 | 验收 |
|---|---|---|---|
| N1 | 重启 DSH Host 后验证注入器补丁：`dev_plugin_status` 确认 injector active → `dev_inject_plugin {dir}` 应直接放行（不再报 `main`/`sidebar.panellist` 不在白名单）→ live client Slots 里 `computer-history` occupant 仍 active | DSH 重启 | ✅ **已完成（2026-10-02 17:55）**：重启前离线复演通过；重启后 `dev_inject_plugin` 校验放行、host 路由 200、client occupant active、`pnpm verify:p1` exit 0；注入目标 profile 的偏差见 F10（以 desktop junction + staging loader.create 完成），环境已还原 |
| N2 | 安装真实可启动的 VS Code 或 Cursor → 复测真实 editor 的 kAXDocument 语义 | 可用编辑器 | ✅ 契约部分完成（§5.5 合成 app：adapter 映射 + AXDocument 管线）；真实 VS Code 语义仍待真机 |
| N3 | 在 AXURL 有值的场景复测 `safeURL` 的 CFURL 解码 | 可触发场景 | ✅ 已完成可行部分：真机探针证明 AXURL 无触发场景（F9），解码逻辑改为纯函数 `decodeURLAttribute` + native/XCTest 覆盖 |
| N4 | 故障注入"helper 退出无法确认" | 可选 | 逻辑已有单测覆盖（`tests/unit/collector-hardening.spec.ts:847` "releases ownership but records an unconfirmed exit"）；真机触发需要 helper 能存活 SIGKILL（不可构造），故真机项保持未触发 |
| N5 | 修注入器自重载 `selfEntry 无官方 _dispose`（F8） | 可选，改注入器源码 | 已定位三处缺陷并对 (A)(B) 打补丁（built+source，见 F8/§9）；(C) 未解，故补丁**未验证**——post-restart 验证点：自重载能跑完并加载新代码 |

每阶段收尾固定动作：关闭本阶段打开的应用/窗口/后台进程；更新报告与 todo；forward commit；确认 worktree clean。
