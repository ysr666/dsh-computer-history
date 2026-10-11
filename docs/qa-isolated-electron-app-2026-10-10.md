# DCH v1.1 第十一轮：现有 QA Electron 应用隔离启动验收

日期：2026-10-10

## 结论

通过复用现有 `~/Applications/DeepSeek Harness QA.app`，成功
在一个**新的隔离数据目录**中启动真正的 Electron Desktop 主进程、
嵌入式 DSH Host 与 Electron 渲染窗口。该 QA 应用已预先将
桌面 Host 固定端口从正式应用的 `19387` 改为 `19587`。
两个 Host 同时监听各自独立的 `127.0.0.1` 端口，未发生冲突。

**尚未完成：** 本轮 Electron 内真实 DCH UI 的自动化点击/视觉验收、
用户确认后的 Continue，以及真实模型 Find → Answer → Continue。不能把
成功启动 Electron 等同于完整插件桌面验收。

## 本轮新的关键信息

- 已有 QA App：`/Users/ysradmin/Applications/DeepSeek Harness QA.app`。
- 原 QA 数据域：`/Users/ysradmin/.dsh-desktop-qa`。该目录有旧 QA
  配置、历史文件与凭据。**本轮未读取旧 QA 的凭据与历史数据库内容**，仅查看 QA
  应用、manifest 和非秘密配置摘要。
- 本轮**新建**独立数据域：`/tmp/dch-v11-electron-qa/`；
  `DSH_HOME=/tmp/dch-v11-electron-qa/dshhome`，
  `HOME=/tmp/dch-v11-electron-qa/home`，
  Electron `--user-data-dir=/tmp/dch-v11-electron-qa/electron-user-data`。
- 新的 `profiles/desktop` 仅配置
  `@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-web-app`、
  `dsh-computer-history`；插件符号链接指向隔离候选源码
  `/tmp/dch-v11-ai-first/repo`。
- DCH `enabled: false`，不授权辅助功能或启动采集。
- Electron 的 CLI 无法使用 `dsh --profile desktop --dump-config`：
  官方 CLI 提示 desktop profile 由 Electron 独占管理。
  只能检查独立目录内实际合成/保存的配置。
- 官方未修改桌面应用独占端口 `19387`，与正式进程同时存在；
  QA Electron Host 独占 `19587`。
- 候选插件 Host 配置保留 `enabled: false`，Host stderr
  无 `FatalError`、`EADDRINUSE`、必需插件未启动等错误。
- Electron 的远程调试目标存在，页面 URL 为 `dsh-app://app/`。
  这是原生 Electron 渲染窗口，而非 standalone Chrome Web Host。
- 进一步的 Electron 内页面自动化点击脚本被执行环境的安全检查拦截。
  **未改用其他方法规避该拦截**，也没有声称 UI 点击已通过。

## 安全退出

测试专用 QA Electron 主进程已结束，正式 DSH 主进程没有被停止
或修改。正式用户工作树保持原样。没有提交/推送/合并或发布。

## 发布关卡

1. 在获准的真实 Electron QA 窗口执行视觉与键鼠验收，确认
   History、Settings、Episode 核验和 Continue 按钮的实际行为；
2. 在不接触真实用户历史、工具白名单严格隔离的合成 Host 中做
   真实模型 Find → Answer → Continue 验收；
3. UI 窄栏效果与 Windows Electron 的验证；
4. 所有关卡通过后再决定合并/发布 v1.1。

前十轮已通过的 DSH Web Host 验收与 913 项自动化测试属于独立证据，
不得与本轮未完成的 Electron UI 验收混淆。

## 第十二轮：来源精确性与多结果界面加固

本轮仍只修改隔离候选版，**未安装、未发布**。

- 本地结果「查看来源」与 AI Episode 来源核对现在使用同一条精确 ID 验证函数；
  若返回来源 ID 与选中 ID 不一致，或来源已被 invalidated，显示错误，不显示错误来源摘要。
- 多结果列表中的来源摘要改为**就地显示在对应结果卡内**，
  而不是显示在整个结果列表底部。严格用结果 hit.id 绑定，不把同一项目的另一条结果混淆。
- 每条「查看来源」与「继续此项工作」按钮具有包含结果名称的 aria-label，
  改善多个同名操作对键盘辅助技术/读屏的识别能力；视觉按钮文案保持简洁。
- 增加来源被替换、来源已失效、多结果来源归属与按钮可访问名称回归测试。
- 仍完全复用之前稳定的 Continue 检索、retention 及 session binding，
  不让 AI 自动继续，也不增加权限。

**不可宣称：** 这些都是源代码与 React 事件单测；现有 QA Electron 真实窗口的
自动化点击仍被安全检查拦截，未获得新的 Electron 鼠标/键盘验收证据。

### 剩余的真实 QA Electron 手动操作清单

这份清单留给经授权的真实窗口测试，检查时只使用全新隔离 HOME、
DSH_HOME、Electron user-data-dir，且 DCH enabled: false。禁止使用已有
~/.dsh-desktop-qa 中的真实 QA 记录与凭据。

- [ ] QA Electron 显示「电脑使用记录」侧边栏；点击并展开「查询工作历史」。
- [ ] 本地查询显示无匹配证据，不读取文件正文，也不自动发送 AI 请求。
- [ ] 粘贴不存在的 Episode ID，点击核对后显示错误且无 Continue 按钮。
- [ ] 用新建的合成 Episode 校验「来源卡片 → 用户确认 → Continue」。
- [ ] 两条合成同名结果的来源卡只出现在对应结果内。
- [ ] 设置页面采集关闭；禁止实际点击采集、删除、导入和权限授权。
- [ ] 实测 420px、600px、桌面默认宽度下的键盘焦点、溢出和中英文。
- [ ] Windows Electron 运行与退出的独立回归。

**上述复选框目前未标记为通过。** 之前独立 Web Host 的可视化
验收结果不能替代这些 Electron 专属关卡。


## 第十三轮合并前修复（2026-10-10）

- 最新 GitHub main@`71b53631` 已验证与候选原始基线一致；
  当时 29 个改动文件均无上游内容差异，`git apply --check` 通过。
- Continue 增加**即时 ref 锁**，防止 React 尚未刷新按钮禁用状态时的
  双击提交，同时覆盖本地搜索和用户粘贴 Episode 两条路径；
  不改变 Host Continue 选取规则。
- 增加两项测试，模拟相同事件处理器在一次 React 更新之前双击，
  断言只有一次 Continue 回调。
- 隔离 QA `desktop` profile 通过只读升级清单预检：
  DSH 0.2.0-rc.2，零结构性 blocker，但有 cautions。
  不代表生产安装被授权，或数据库迁移已验收。
- AI-first 候选新加入 schema migration 0016；
  需要单独对照 `docs/upgrade-v1.1-preflight.md`
  验证备份/恢复/迁移路径。

Electron QA 真实窗口的进一步自动化点击仍未通过安全执行检查。
不得以这些单元测试或独立 Web Host 测试替代 Electron 验收。
