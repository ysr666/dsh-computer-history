# dsh-computer-history

[![CI](https://github.com/ysr666/dsh-computer-history/actions/workflows/ci.yml/badge.svg)](https://github.com/ysr666/dsh-computer-history/actions/workflows/ci.yml)
[![Collectors](https://github.com/ysr666/dsh-computer-history/actions/workflows/collectors.yml/badge.svg)](https://github.com/ysr666/dsh-computer-history/actions/workflows/collectors.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**面向 DeepSeek Harness 的隐私优先电脑使用历史与工作连续性插件。**

[English](README.md)

`dsh-computer-history` 会把近期电脑活动整理成保存在本机、由元数据支撑的 **Work Episodes（工作片段）**，让 DSH Agent 在需要时理解“我刚才在做什么、应该从哪里继续”。它的目标不是做生产力监控，而是在**不记录屏幕内容**的前提下恢复工作上下文。

> **当前状态：** early alpha。核心链路已经实现并经过测试，但还没有稳定发行版，安装方式与兼容性仍可能调整。

<p align="center">
  <img src="docs/assets/panel-firstrun-clean-store.png" alt="DSH Computer History 首次使用界面" width="820" />
</p>

## 它能做什么

- 使用 SQLite 在本机保存近期活动元数据。
- 将 observation 确定性地整理为 Work Episode。
- 通过认证 Host API 和 Agent 作用域工具把近期工作提供给 DSH。
- 提供 History / Privacy 面板，用于采集策略、保留策略、近期片段与 Resume。
- 对浏览器、编辑器等 OS 元数据不足的应用提供 companion 路径。
- 采集规则显式、include-only，并在不确定时 fail closed。

## 隐私边界

本项目明确坚持 **metadata-only（仅元数据）**。

在策略允许时，它可能记录应用身份、资源/工作区元数据、时间信息、元素 role/identifier 元数据和隐私状态。

它设计上**不记录**：

- 截图或屏幕录制；
- 键盘输入、鼠标坐标或剪贴板；
- Terminal 输出或 shell history；
- 源代码/文件正文；
- 网页正文；
- Accessibility 文本值或选中文本。

采集默认关闭，应用访问默认 include-only，受保护界面 fail closed；Host 在写入前还会再次检查元数据。精确边界与剩余风险见 [SECURITY.zh.md](SECURITY.zh.md) 和 [docs/threat-model.md](docs/threat-model.md)。

## 平台状态

| 平台 | Collector 路径 | 当前状态 |
| --- | --- | --- |
| macOS | Accessibility | 主力路径；原生构建、隐私测试与端到端流程已验证 |
| Windows | UI Automation | 已在 Windows 11 上完成真实 collector + Host 流程验证 |
| Linux | AT-SPI | 已在 Ubuntu 上完成 collector / protocol 实机验证；仍受桌面环境与权限可用性影响 |

三平台实测证据和已知限制统一记录在 [docs/validation-three-platforms.md](docs/validation-three-platforms.md)。

## 开发快速开始

目前还没有稳定发行包，因此现阶段推荐从源码检出开始。

```bash
git clone https://github.com/ysr666/dsh-computer-history.git
cd dsh-computer-history
corepack enable
pnpm install --frozen-lockfile
pnpm build
pnpm verify
```

环境要求：

- Node.js `^22.19.0` 或 `>=24`
- pnpm `11.7.0`
- Windows / Linux collector 开发需要 Rust
- macOS 原生 collector 开发需要 Swift toolchain

DSH 集成、临时 Host 测试和平台验证方法见 [docs/development.md](docs/development.md)。

## 验证

常用 Gate：

```bash
pnpm verify                 # 类型、lint、测试，以及架构/隐私边界检查
pnpm verify:p1              # macOS Phase 1 完整 Gate
pnpm e2e:macos              # macOS 临时 DSH Host 端到端流程
pnpm e2e:linux              # Linux（具备所需 desktop bus 时）
pnpm benchmark:ingestion    # ingestion 性能基准
```

GitHub Actions 还会运行 Node 兼容性 Gate 和与改动相关的三平台 collector 检查。

## 文档入口

- [架构](ARCHITECTURE.md)
- [安全与隐私](SECURITY.zh.md)
- [开发说明](docs/development.md)
- [Collector 协议](docs/collector-protocol.md)
- [三平台验证记录](docs/validation-three-platforms.md)
- [Roadmap](docs/roadmap.md)

## 参与贡献

项目仍处于 Alpha，欢迎 Issue 和 PR。开始前请先读 [CONTRIBUTING.md](CONTRIBUTING.md)。

由于这个项目处理敏感的本机上下文，**不要在公开 Issue 中上传真实历史数据库、配对/会话 Token、凭据、隐私路径或未经脱敏的采集日志**。安全敏感问题请按照 [SECURITY.zh.md](SECURITY.zh.md) 的方式私下报告。

## 许可证

[MIT](LICENSE)
