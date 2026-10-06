# 编辑器伴侣

编辑器伴侣告诉宿主**工作正在哪里发生**。它存在的原因是：操作系统的辅助功能层**无法为工作区背书** —— 辅助功能观测只能从文档路径去猜，这正是 Phase 2.3 会出现"**没有锚点**"片段的原因。编辑器**知道**，所以宿主去**问**。

与浏览器伴侣同一条信任边界（ADR 0007 / ADR 0009）：插件自己拥有的回环监听、以摘要形式存储的配对令牌、`incognito` 式的**失败即关闭**行为，以及通过既有 `resource` 策略维度实现的**按工作区授权**。**没有引入任何新的受信概念。**

## 它发送什么，以及它无法发送什么

| 发送 | 编辑器里的来源 |
|---|---|
| `workspaceRoot` | 当前活动文档所属的工作区（`workspace.getWorkspaceFolder(...)`）；没有活动编辑器时才使用唯一/默认工作区 |
| `filePath` | `window.activeTextEditor.document.uri.fsPath` |
| `languageId` | `document.languageId` |
| `surfaceKind` | 当前视图：editor、diff、terminal |
| `title` | 文件的基名 |

**不发送，而且"无法表达"**：文档正文、选中内容、诊断信息、界面字符串。**载荷形状里没有它们的字段**；宿主对**未知字段是拒收而不是忽略**；并且有一条守卫测试断言扩展**从不提及** `getText`、`.text` 或 `.selection`。

## 安装与配对

macOS 上的正常流程是：**设置 → VS Code 伴侣 → 安装并连接**。
宿主只会用固定参数安装插件随附的 VSIX，然后创建**仅属于编辑器伴侣**的配对凭据，并把它放进一个最长有效五分钟、权限为 `0600` 的用户私有交接文件。扩展读取后，会把令牌转存到 VS Code `SecretStorage`，把回环端口保存在扩展状态中，并立刻删除交接文件。已经在运行的扩展会监听这次交接，所以重新连接也不需要复制 Token 或端口。

宿主数据库长期保存的仍然**只有令牌摘要**。浏览器和编辑器的凭据彼此独立：重新连接 VS Code 不会踢掉浏览器伴侣，浏览器凭据也不能拿来认证编辑器载荷。

命令行安装只保留为开发回退：

```bash
pnpm build:editor-extension
code --install-extension ./dsh-computer-history-editor.vsix --force
```

如果手动装了开发版 VSIX，它会等待宿主里的**自动连接**动作来准备凭据。旧版的 `dshComputerHistory.port` 和 `dshComputerHistory.token` 如果已经存在，会被读取一次并迁移进 SecretStorage；它们不再作为正常设置项暴露给用户。

## 允许或拒绝一个工作区

工作区根目录就是一个 `resource`，所以面板**既有的按资源规则直接适用** —— 允许你想要的根、拒绝其余的。被拒绝的工作区**什么都不存**，而且这次拒绝**在审计的脱敏预览里可见**。

## 线格式（给另一个编辑器用）

任何能向回环地址 POST 的编辑器都可以做伴侣。**一个端点、一种形状**：

```http
POST http://127.0.0.1:<port>/companion/observation
x-companion-token: <the token from the panel>
content-type: application/json

{
  "source": "editor",
  "app": { "bundleId": "com.example.editor", "name": "Example Editor" },
  "workspaceRoot": "/Users/you/Projects/demo",
  "filePath": "/Users/you/Projects/demo/src/main.ts",
  "languageId": "typescript",
  "surfaceKind": "editor",
  "title": "main.ts",
  "editorSession": "any-stable-id",
  "seq": 1,
  "observedAtMs": 1790000000000
}
```

`201 {"stored":true}` 表示**存下了**；`202 {"stored":false}` 表示**宿主拒绝了它**（请求本身是合法的，这个回答是关于存储的）。随包提供的 VS Code companion 会读取 202 响应体，并把拒绝原因写进 Computer History 输出/追踪日志，而不是把所有 2xx 都当成“已经存储”。如果拒绝是**采集本身**决定的（`capture-paused`、`collector-not-running`、`capture-disabled`、`capture-not-owned`），响应里还会带 `reason`。`400` 会带原因，`401` 表示令牌不对，`403` 表示无痕（仅浏览器形状）。

**`app` 是什么意思。** 它是一个**声明**：宿主以 `source.provider = 'companion'` 记录这条观测，所以审计**永远能分辨**"某个编辑器说自己是 Cursor"和"操作系统看到的是 Cursor"。这个声明**会被校验**（`bundleId` 必须像应用 id、`name` 非空、不得有多余字段），而且**它无法解锁任何东西**：用户没有允许的应用**什么都不存**；被内置保护清单覆盖的应用**即使用户允许了也照样被丢弃**。

**客户端绝不允许发送的东西。** 没有字段可以放文档正文、选中内容、诊断信息、界面字符串或文件内容；而且**未知字段是拒收而不是忽略** —— 所以多加一个字段**是协议错误，不是无害的多余项**。**路径是元数据；内容不是。**

**客户端必须遵守的规则。** `workspaceRoot` 必须是绝对路径；如果你发了 `filePath`，它必须位于该根之下。每次编辑器运行使用**稳定的** `editorSession`，`seq` 必须**递增**；同一对 `(session, seq)` 的重复会被当作重复丢弃。**没有令牌，就什么都不要发。**

## 两个值得知道的坑

- **"构建过期"看起来和"功能坏掉"一模一样。**宿主只运行 `lib/` 里的东西，所以改完插件之后：`pnpm build`，然后**重新加载插件条目**。本阶段的实机运行里，一个**没有重新构建**的宿主用*浏览器*校验器的错误回答了编辑器载荷 —— 那读起来像校验 bug，**但它不是**。
- **手工拷贝一个目录，不等于装好了一个扩展。** VS Code 把已安装集合记在 `extensions.json` 里，**不会重新扫描**你手放进去的目录；扩展只有在通过 `code --install-extension`（或图形界面）安装之后才会激活。
