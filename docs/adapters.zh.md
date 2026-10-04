# 适配器证据表

Phase 1 的每个适配器一行，并附上产生这一行的**真机测量**。`T2.0-8` 会把这张表的完整性变成一条检查（`pnpm verify:adapters`）；在那之前它由人工维护，而**没有日期和命令的行不算证据**。

探针配方在 `docs/verification-guide.md`。这里**每一次测量都用合成夹具** —— 从未使用真实的私密文件或真实凭据。

| 适配器 | bundle id | 表面 | 文档（`kAXDocument`） | `kAXURL` | 聚焦元素 | 资源 |
|---|---|---|---|---|---|---|
| `vscode` | `com.microsoft.VSCode`, `com.todesktop.230313mzl4w4u92` | editor | 编辑器窗口上为 `file://…` | 不支持（`-25205`） | 不可得（`-25212`） | file |
| `xcode` | `com.apple.dt.Xcode` | editor | 编辑器窗口上为 `file://…` | 不支持（`-25205`） | 可读（`AXGroup` / `AXHostingView`） | file |
| `word` | `com.microsoft.Word` | document | 打开文档的 `file://…` | 不支持（`-25205`） | 可读（`AXSplitGroup`，无 subrole） | file |
| `wps` | `com.kingsoft.wpsoffice.mac` | window | nil（`-25212`） | 不支持（`-25205`） | 可读（`AXSplitGroup`） | 无 |
| `jetbrains` | `com.google.android.studio`, `com.jetbrains.*`（10 个 id） | editor | nil（`-25212`） | 不支持（`-25205`） | 欢迎窗口可读（`AXButton`，23 个属性）；按 ADR 0006，不可查询的元素（`-25202`）被容忍 | 无 |
| `obsidian` | `md.obsidian` | editor | 库选择器上为空 | 不支持（`-25205`） | 不可得（`-25212`） | 无 |
| `notes` | `com.apple.Notes` | window | nil（`-25212`） | 不支持（`-25205`） | 可读（`AXTextArea`） | 无 |
| `browser` | `companion.browser` | browser | 不适用（由伴侣发送地址） | 不适用 | 不适用 | url |
| `terminal` | `com.apple.Terminal`, `com.googlecode.iterm2` | terminal | 工作目录（`file://…` / 路径） | 不支持（`-25205`） | iTerm2 上可读；Terminal 内为 `-25212` | directory |
| `preview` | `com.apple.Preview` | document | 打开文档的 `file://…` | 不支持 | 可读 | file |
| `finder` | `com.apple.finder` | window | 普通窗口为 nil；文件夹窗口为文件夹路径 | 不支持（`-25205` / `-25212`） | 可读（`AXGroup`） | 无或 file |

同一批适配器的 Windows id：`finder` = `explorer.exe`、`terminal` = `WindowsTerminal.exe`，两者都在 2026-10-04 于 Windows 11 26200 上**实测**（`cargo run --release --example foreground_identity` 加真实 collector 运行）；`vscode` = `Code.exe` 属于**预期而非实测**，因为那台机器没有安装 VS Code。实测更正了先前写下的预期值（`Microsoft.WindowsTerminal`、`Microsoft.VisualStudioCode`）：那台机器上实测的两个打包应用（记事本、Windows Terminal）**根本没有上报窗口级 AppUserModelID**，所以 Windows 交给 collector 的是可执行文件名——开始菜单里的 `Microsoft.WindowsTerminal_8wekyb3d8bbwe!App` 并不是窗口属性。这是该次测量的覆盖范围：两个打包应用加一个经典应用，而不是一条关于所有 Windows 应用的规律。

同一批适配器的 Linux id 也已在 fixture 中声明——`vscode` = `code.desktop`、`code-insiders.desktop`；`terminal` = `org.gnome.Terminal.desktop`；`finder` = `org.gnome.Nautilus.desktop`——它们进入 Host 表的理由与 win32 id 相同：没有它们，第一条 Linux 观测就会被当成 `not-an-adapter` 拒掉。**它们一个都没有被实测过**，因为还没有 Linux 机器跑过这个 collector；该状态记录在 `docs/validation-three-platforms.md`。

## 各行明细

### `vscode` — VS Code 1.140.0 与 Cursor 3.23.12

```json
{"adapter":"vscode","app":"com.todesktop.230313mzl4w4u92","privacy":{"secure":false},
 "window":{"document":"file:///tmp/dsh-live-fixtures/normal-text.html","title":"normal-text.html"}}
```

测量于 2026-10-02，使用 `scripts/verify/live-probe.mjs --allow <bundle>` 加 `ax-probe`。两个应用都是 Chromium 系：应用元素对 `kAXFocusedUIElement` 返回 `-25212`，而且**没有系统级的替代**（`-25204`），但窗口属性读取正常。**把"属性缺失"当成"不为安全"，而不是当成"读取失败"，正是修掉 F11 的那件事。**

Cursor 3.x 备注：默认的 **"Cursor Agents"** 窗口报告**空的** `kAXDocument`，因此在那个窗口里只有标题可用。经典编辑器窗口（直接打开一个文件）会像 VS Code 一样暴露 `file://` URL。**只在 Agents 窗口里工作的人，因此只会产生"仅有标题"的观测**，这由 T2.0-7 的聚合规则处理。

### `xcode` — Xcode 27.0（27A266a）

```json
{"adapter":"xcode","app":"com.apple.dt.Xcode","privacy":{"secure":false},
 "window":{"document":"file:///tmp/dsh-verify-fixtures/sample.swift","title":"sample.swift"}}
```

测量于 2026-10-02：`open -a Xcode /tmp/dsh-verify-fixtures/sample.swift`，随后 `bin/verify/activate --pid <xcode pid> --marker sample.swift`，再 `node scripts/verify/live-probe.mjs --allow com.apple.dt.Xcode --seconds 26`。得到两条观测，都带文档与标题。Xcode 的聚焦元素可读（`AXGroup`，subrole `AXHostingView`），所以它**不是** Chromium 那种情况。

"What's New in Xcode" 那个弹层报告空文档；**承载文件的是编辑器窗口**。在这个适配器条目存在之前，"可采集表面"是**在原生测试里断言的**（`phase1AdapterForBundle` 返回 nil），而不是靠探针 —— 因为**Xcode 不在前台时，探针无法区分"没有适配器"和"不在前台"**，最初那次基线尝试正是因为这个原因而没有结论。

### `word` — Microsoft Word

```json
{"adapter":"word","app":"com.microsoft.Word","privacy":{"secure":false},
 "window":{"document":"file:///tmp/dsh-verify-fixtures/sample.rtf","title":"sample  -  兼容性模式"}}
```

测量于 2026-10-02，使用合成 RTF（`open -a "Microsoft Word" /tmp/dsh-verify-fixtures/sample.rtf`），随后 `bin/verify/activate --pid <word pid> --budget 90` 与 `node scripts/verify/live-probe.mjs --allow com.microsoft.Word --seconds 20`。Word 暴露文件 URL 且聚焦元素可读，所以它的行为**像 Preview，而不像下面的 WPS**。

### `wps` — WPS Office

```json
{"adapter":"wps","app":"com.kingsoft.wpsoffice.mac","privacy":{"secure":false},
 "window":{"title":"[只读]sample.rtf"}}
```

测量于 2026-10-02，同一份合成 RTF。WPS **没有** `kAXDocument`（`-25212`）也**没有** `kAXURL`（`-25205`），所以它的观测只有标题、没有资源；表面保持 `window`。产生了**两条**观测，形状都一致。这与 Finder 的普通窗口、Cursor 的 Agents 窗口属于**同一类**，也正是 T2.0-7 那条聚合规则存在的原因。

### `jetbrains` — IntelliJ 平台（Android Studio）

```json
{"adapter":"jetbrains","app":"com.google.android.studio","privacy":{"secure":false},
 "window":{"title":"Welcome to Android Studio"}}
```

测量于 2026-10-02，使用注入的插件（对 `com.google.android.studio` 的 allow 规则）与 `bin/verify/ax-probe --attributes`：Android Studio 存下**四条**观测（有标题、`element_role` 为 `AXButton`、无资源）。IntelliJ 家族**不报告文档**，所以这些观测只有标题；聚合规则把它们当作**窗口级活动**处理，面板显示时不带资源。

该适配器声明了 `focusedElementPolicy: window-only`（ADR 0006）：在它的启动阶段，应用曾**两次**交出一个**每次读取都被拒绝**的聚焦元素引用（role、subrole、属性列表乃至 parent 都返回 `-25202`）。该状态**之后没有复现**（冷启动的十二次采样都读到正常的 `AXButton`），所以这份容忍是**由 `docs/validation-phase2-0.md` 里的夹具对**证明的，而不是由某条已存记录证明的。**可读的安全字段仍会扣下整条观测** —— 同一节在采集器与宿主两层都展示了这一点。

真实的 JetBrains IDE 也测过：IntelliJ IDEA CE 2025.3（`com.jetbrains.intellij`，通过其 LightEdit 入口打开一个合成文件）产生

```json
{"adapter":"jetbrains","app":"com.jetbrains.intellij","privacy":{"secure":false},
 "document":null,"titlePresent":false,"elementRole":"AXButton"}
```

聚焦元素可读（23 个属性，无 subrole）。其启动屏的窗口标题为空，所以这条观测**既无资源也无标题** —— 这就是该家族的"仅窗口"地面真值。

其余八个 bundle id 共享同一平台，但**未安装在验证机上**；它们的行**未测**：

- `com.jetbrains.intellij`、`com.jetbrains.intellij.ce`
- `com.jetbrains.pycharm`、`com.jetbrains.pycharm.ce`
- `com.jetbrains.goland`、`com.jetbrains.webstorm`、`com.jetbrains.clion`
- `com.jetbrains.rustrover`、`com.jetbrains.datagrip`

### `obsidian` — Obsidian 1.13.7

```json
{"adapter":"obsidian","app":"md.obsidian","privacy":{"secure":false},
 "document":null,"title":"Obsidian","elementRole":null}
```

测量于 2026-10-02（cask 1.13.7，用 `/tmp` 里的合成库打开）：该应用是 Chromium 系 —— `kAXFocusedUIElement` 回答 `-25212`（noValue，**与 VS Code、Cursor 给出的同一种正面证据**），窗口标题读取正常，`kAXURL` 不支持，而且库选择器上的窗口文档**为空**，所以没有资源。"笔记真的打开着"的一次测量（看文档那时是否会带上文件）**仍然待做**；该适配器被定为 `editor` 是因为那才是这类应用，而**在文档出现之前，资源保持缺席**。

### `notes` — Apple Notes

```json
{"adapter":"notes","app":"com.apple.Notes","privacy":{"secure":false},
 "titlePresent":true,"elementRole":"AXTextArea"}
```

测量于 2026-10-02，在所有者**正在运行**的实例上，且标题值**故意不记录**：Notes 暴露可读的聚焦元素（`AXTextArea`）、没有窗口文档（`-25212`）、没有 `kAXURL`（`-25205`），所以一条便签是**仅有标题**的表面，观测不带资源。该适配器的文档**不涉及便签内容**，测量期间**没有读取也没有存储任何内容**。

### `browser` — 伴侣的合成来源

```json
{"adapter":"browser","app":"companion.browser","provider":"companion",
 "window":{"title":"Example page","url":"https://example.test/docs/guide"}}
```

**不是应用**：这个适配器是已配对的浏览器伴侣所报告出来的**来源标识**（ADR 0007），**没有任何真实应用携带这个 bundle id**，所以辅助功能那条路径**永远不可能**产出它。2026-10-02 对着运行中的宿主验证：一次已配对的 `POST http://127.0.0.1:19388/companion/observation`（`path=/docs/guide?token=secret#frag`）存下一条观测，其资源为 `url https://example.test/docs/guide`（**查询串与片段都没了**）；而未配对 POST 回 401、无痕载荷回 403、暂停期间的 POST 回 `202 {stored:false}`。完整配方在 `docs/validation-phase2-1.md` 的 T2.1-2b。

### `terminal` — Terminal.app 与 iTerm2 3.7.3

**这个适配器永不记录标题**（`suppressesWindowTitle`），而文档是**工作目录**，所以资源类型是 `directory`。iTerm2 3.7.3 测量于 2026-10-02（`bin/verify/activate` + 探针），得到 `{"adapter":"terminal","privacy":{"secure":false}}` 与元素 `{role: AXButton, identifier: action-button-2}`；它的首次运行窗口是一个 `AXDialog`，其 `kAXDocument` 返回 `-25212`。Terminal.app 的安全字段行为在 F4 修好：**subrole 缺失是"普通字段"的正面证据，只有读取失败才失败即关闭**。

### `preview` — Preview

```json
{"document":"file:///private/tmp/dsh-live-fixtures/preview-fixture.pdf","title":"preview-fixture.pdf – 1页"}
```

测量于 2026-10-02，属于 Phase 1 运行时验证（复现两次）：文档类应用暴露文件 URL，所以**资源归属是可行的**。

### `finder` — Finder

```json
{"title":"dsh-live-fixtures"}
```

没有 `document` 也没有 `url`：普通 Finder 窗口（下载窗口、桌面窗口）的 `kAXDocument` 是 nil，所以那些观测不带资源。Phase 1 验证期间宿主存下**七条** Finder 观测，**七条的 `resource_id` 都是空的** —— 这就是路线图把 Finder 当作**窗口表面**而不是文档表面的原因。

## 新增适配器不会新增策略

`protectedBundleIds` 是通过把策略规则与受支持的 bundle id 做匹配**推导**出来的（采集器管理器里的 `bundleIdsFor('protect')`），所以**新适配器只有在既有规则能匹配它时才继承保护** —— 一条 `com.apple.*` 规则能覆盖新的 Apple 适配器，而第三方适配器**保持不匹配**。这是**安全而不是漏洞**：采集是 include-only 的，所以**没有 allow 规则的应用根本不会被采集**。它确实意味着**新适配器在有人允许它之前是沉默的** —— 而这正是**有意的产品默认值**。

## 已知缺口

- **浏览器没有适配器。** Chrome 的 `kAXDocument` 确实携带页面 URL（Phase 1 实测为 `https://…`），但浏览器采集**保持失败即关闭**，直到 2.1 的伴侣能够保证排除隐私模式。
- **Cursor 的 Agents 窗口**：文档为空，见上。
- **Notes 是故意未测的**：打开它就会显示用户真实的便签，而窗口标题就是便签标题。要测它需要所有者点头或一个合成便签源，所以**这个适配器宁可不加，也不靠假设加上**。
- **JetBrains 家族卡在"一个决定"上，而不是卡在"一个下载"上。** Android Studio（IntelliJ 平台，`com.google.android.studio`）交出的聚焦元素引用**完全不可查询**：role、subrole 乃至属性列表都返回 `-25202`（`kAXErrorIllegalArgument`），而窗口读取正常（`AXStandardWindow`、有标题、文档 `-25212`）。因此当前这条失败即关闭的规则会**丢弃这些观测**。ADR 0006（提案）建议引入按适配器声明的 `window-only`；在所有者决定之前，**保持失败即关闭的现状，也不添加任何 JetBrains 适配器**。测量于 2026-10-02，用 `bin/verify/ax-probe <pid> 1 --attributes`。
- **待做适配器：无。**共享表里的每个适配器都有已测的行；唯一未测的条目是上面列出的八个 `com.jetbrains.*` bundle id，它们**共享一个已测平台**。
