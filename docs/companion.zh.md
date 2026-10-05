# 浏览器伴侣

伴侣是一个浏览器 MV3 扩展（同一份源码既打包给 Chromium，也打包给 Gecko：一份实现、两份 manifest），向本机的 DeepSeek Harness Computer History 接收端报告**你当前在哪个页面** —— 源站、路径与标签页标题。它是**唯一被允许存储 URL 的来源**（ADR 0007）；**通过辅助功能看到的浏览器窗口仍然什么都不贡献**。

## 它采集什么，绝不碰什么

| 采集 | 绝不触碰 |
|---|---|
| 活动标签页的源站与路径 | 页面内容、DOM、选中内容、表单值 |
| 标签页标题 | 隐私（无痕）窗口 —— **扩展在那里不被允许运行** |
| 它发生变化的时间（切换标签、跳转） | 你在策略里拒绝的任何站点 |

**查询字符串与片段会被去掉两次**：一次由扩展在发送前完成，一次由宿主在存储前完成。像 `https://example.test/docs/guide?token=secret#part-3` 这样的 URL，存下来的是 `https://example.test/docs/guide`。

## 安装

1. `pnpm build:extension` → 把扩展打包到 `dist/extension/`。
2. 在 Chrome 中：`chrome://extensions` → 打开**开发者模式** → **加载已解压的扩展程序** → 选择 `dist/extension/`。
3. 扩展只申请 `tabs` 与 `storage` 权限，且只申请对 `127.0.0.1` 的主机访问。**出现别的权限就说明构建有问题**：`pnpm build:extension` 会拒绝任何放宽这两项的 manifest。

Chrome 154 会忽略 `--load-extension` 命令行参数，所以自动化改为通过 CDP 加载（`Extensions.loadUnpacked`，配合 `--enable-unsafe-extension-debugging`）；**由人手工安装则用上面的步骤**。

### 第二个引擎（Gecko）

1. `pnpm build:extension:firefox` → 把**同一份源码**打包到 `dist/extension-firefox/`，并把 Gecko 的 manifest 写进去当作它的 `manifest.json`。
2. 在 Firefox 中：`about:debugging#/runtime/this-firefox` → *临时载入附加组件…* → 选择 `dist/extension-firefox/manifest.json`。
3. 配对方式完全相同，在扩展自己的选项页里做。

两个包里是**同一份实现**：监听器都在 `extension/background.js`，命名空间由 `extension/engine.js` 决定，所以两个引擎加载的入口文件是**同一个文件**。只有 manifest 不同，差别只在三处引擎真正不一致的地方：

| | Chromium | Gecko |
|---|---|---|
| 后台 | `service_worker` | `scripts` + `type: module`（Gecko 没有 service worker） |
| 选项页 | `options_page` | `options_ui`（`open_in_tab`） |
| 身份 | `minimum_chrome_version` | `browser_specific_settings.gecko.id`（缺了它，storage 与权限在重启后不保留） |

`pnpm build:extension` 与 `pnpm build:extension:firefox` 用**同一套守卫**：必须是 MV3、`incognito: "not_allowed"`、不得有 content script、权限不超出 `tabs`/`storage`、主机访问只允许回环，并且**打包前每个脚本都要先解析通过**。写错引擎的后台键会被**拒绝打包**，而不是打出一个"能装上、但永远静默不上报"的扩展。

**未验证：** 写这份文档的机器上没有安装 Gecko 引擎，因此 Firefox 包**只做到"能构建 + manifest 检查通过"，不存在实机的 Gecko 记录**。上面第 2 步就是产生那条记录的配方；在跑过之前，Gecko 这一半按未证实对待。

## 配对

1. 在 Computer History 面板里轮换配对令牌。**它只显示一次**：库里只存 SHA-256 摘要，因此**之后无法再读出来**。
2. 打开扩展的选项页，粘贴令牌，然后*保存*。*测试配对*会请求接收端的 `GET /companion/health`，并报告端口与令牌是否一致。
3. 接收端默认监听 `127.0.0.1:19388`（可通过插件的 `companionPort` 配置）。它**只绑定回环地址**；如果端口被占用，面板会显示"伴侣不可用"并给出原因。

轮换令牌会**立即作废旧的**：扩展的下一次上报会收到 `401`，**什么都不存**。

## 隐私矩阵

在真实 Chrome 上运行，**每个承诺一个格子**（完整配方在 `docs/verification-guide.md`）：

```bash
node scripts/verify/chrome-companion.mjs --token <token> \
  --db <data directory>/history.sqlite --cookie /tmp/dsh-ch-cookie.txt \
  --extension dist/extension
```

实测于 2026-10-02（Chrome 154.0.8037.95）：

| 格子 | 结果 |
|---|---|
| 被允许的源站 | 0 → 1 行伴侣记录；资源为 `http://127.0.0.1:<port>/allowed/page` |
| 查询字符串与片段 | 从未存储 |
| 被拒绝的源站 | 无新行 |
| 无痕窗口 | 无新行 |
| 轮换后的令牌 | 无新行 |
| 未加载扩展 | 无新行 |

**只要对照格子失败，脚本就让整个矩阵失败** —— 因为只有在"同样的设置本可以产出一行"的前提下，"没有新行"才说明问题。

## 暂停、禁用、卸载

- 面板里的**暂停**也会停掉伴侣：接收端回 `202 {stored:false, reason:"capture-paused"}` 并且不记录任何东西 —— 与辅助功能采集器停下来的方式完全一致；理由**具名**，客户端自己的日志才能说清为什么。
- 在 `chrome://extensions` 里**禁用**扩展即可停止全部浏览器上报；接收端仍在运行，以便将来配对。
- **卸载**：移除扩展，然后在面板里轮换令牌 —— 旧令牌**从那一刻起无效**。配对记录存在历史数据库里，随数据库一起消失。
