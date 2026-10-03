# 远端模型

摘要可以用三种方式产生：**确定性**（默认开启，完全不用模型）、**本地**（模型跑在这台机器上）、**远端**（模型在别处）。这份文档只讲第三种 —— 因为**只有它会离开这台机器**。

边界是 ADR 0010。这个阶段之前的那条规则 ——「什么都不离开这台机器」—— **对任何记录了远端授权的范围来说都是假的**；所以现在**每一处曾这么声称的地方，都必须说清自己处于两种状态中的哪一种**。

## 会发送什么

`src/host/semantic/minimise.ts` 产出的**最小化形状**，除此之外没有别的：

```json
{
  "model": "…",
  "payload": {
    "appBundleIds": ["com.microsoft.VSCode"],
    "surfaceKinds": ["editor"],
    "resourceKinds": ["file"],
    "fileExtensions": ["ts"],
    "observationCount": 3,
    "startHourOfDay": 14,
    "durationMinutes": 25,
    "workspaceRootName": "demo",
    "hasThread": true
  },
  "observationIds": [1, 2, 3]
}
```

**永远不发送**：完整路径、URL、窗口标题、文档名、文件内容、选中内容、查询字符串。

**"预览"就是"即将发送的内容"。** 面板的预览与真正发起调用的代码**调用同一个函数**（`buildRemoteRequestBody`）；并且有一条测试断言：**fetch 实际收到的字节与预览体完全相等**，而记录的摘要正是这些字节的 sha256。如果预览由**第二条代码路径**生成，那就只是一个**承诺**，而不是一个**性质**。

## 谁可以发送

一个范围（`workspace:<id>`、`app:<bundleId>`）**只有在 `semantic_opt_ins` 里有一行 `remote` 记录时**才能远端发送，而那行记录**只能通过面板写入**。`assertRemoteOptIn` 是**唯一的闸门**，它是 provider 里的**第一条语句**；`verify:semantic-boundary` 证明**每一个有能力发送的文件都带着它必须有的检查**。

## 无法撤回的部分

**请求一旦发出，这台宿主就无法召回它。**它转而做的是：

| | |
|---|---|
| 审计 | 每次发送都把**端点主机、模型、时间与载荷摘要**记进 `remote_summary_sends` —— **不含内容**，所以这行记录可以比它所描述的那个片段活得更久（`ON DELETE SET NULL`） |
| 撤回 | 删除授权会**删掉该范围的发送记录**，并报告**忘记了多少条** |
| 重试 | **没有**。失败就是上报，**绝不重发**：重试会**悄悄把已经离开的副本数量翻倍** |
| 默认 | **关闭**。用户没有打开的范围**不产生任何流量**，这由一条注入 fetch、断言"零次调用"的测试证明 |

## 怎么操作

```bash
# 每个范围分别由谁产生摘要
curl -sS -H "$C" "$BASE/semantic"

# 某个范围下一次远端调用将发送的确切字节
curl -sS -H "$C" "$BASE/semantic/remote-preview?scope=workspace:w1&model=…"

# 打开一个范围，以及再次关闭
curl -sS -X POST -H "$C" -H 'content-type: application/json' \
  -d '{"scopeKey":"workspace:w1","providerKind":"remote","model":"…"}' "$BASE/semantic/opt-in"
curl -sS -X POST -H "$C" -H 'content-type: application/json' \
  -d '{"scopeKey":"workspace:w1"}' "$BASE/semantic/revoke"
# → {"revoked":true,"purged":0,"forgotten":1}
```

端点由使用者自己配置；**必须是 https**，**明文端点在构造任何请求之前就被拒绝**。
