# dsh-computer-history

面向 DeepSeek Harness 的隐私优先 Work Continuity（工作连续性）插件。

目标不是做电脑使用统计，而是让 DSH 在用户需要时理解 Session 之外刚刚发生的工作：最近围绕哪个项目、哪些资源在工作，并从正确的位置继续。

## 当前状态

项目正式进入 Phase 1。仓库先完成规则、工具链、隐私边界和 CI 初始化，再开始正式功能实现。

## Phase 1 数据边界

第一版 collector 只采集 metadata：应用身份、资源 URI/路径、工作区关系、时间和隐私状态。

明确不采集截图、键盘输入、Terminal 正文、源码正文、网页正文、AXValue 或 AXSelectedText。

## 技术栈

- Host / Agent / Client / shared contracts：TypeScript + Node.js ESM
- macOS native collector：Swift
- 本地存储：SQLite
- 包管理：pnpm
- 测试：Vitest + fast-check
- 静态检查：Oxlint
- 构建：tsdown

开始开发前请阅读 ARCHITECTURE.md、SECURITY.md 和 docs/development.md。


## Phase 1 状态

Phase 1 DSH 集成 Alpha 已完成：本地 SQLite、确定性 Work Episode / Resume、macOS Accessibility 元数据采集器、DSH 托管子进程、认证 Host API、History/Privacy 面板、Agent 作用域查询工具，以及默认关闭的实验性一次性 ResumeHint。采集默认关闭，App 默认 include-only；浏览器在有能力可靠识别隐私/无痕边界的 companion 落地前保持 fail-closed。完整 Gate：pnpm verify:p1。
