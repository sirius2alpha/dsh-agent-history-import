# Agent 会话导入

把本机 **Codex**、**Pi**、**Claude Code** 的历史会话导入 DSH，并接着之前的上下文继续工作。

## 两种导入方式

### 1. 带完整上下文继续

把整个会话重放成一条新的 DSH 会话：用户消息、助手回复、推理、工具调用和工具结果都会写入会话日志。导入完成后会直接打开这条会话，你可以从原始工作停下的地方继续聊。

- 适合需要保留工具结果、文件路径、命令输出等细节的任务。
- 单条工具结果默认截断到 4,000 字符，避免一条超长输出占满上下文。
- Codex 的推理内容是加密存储的，无法导入；Pi 和 Claude Code 的可见推理会保留。

### 2. 总结后开始新对话

先用当前配置的默认模型（或插件配置里指定的模型）生成一份详细的交接总结，再把总结作为新会话的第一条用户消息。总结会覆盖：

1. 目标与当前状态
2. 用户要求与约束
3. 已做的工作（文件、命令、结果）
4. 关键发现与决策
5. 错误与处理方式
6. 仓库与环境状态
7. 剩余任务与下一步

长会话会按段落切分，先逐段总结，再合并成一份总总结。总结模式需要至少一个可用模型。

## 使用位置

侧边栏 **新建会话** 右侧的下载箭头按钮。点开后：

1. 选择来源（Codex / Pi / Claude Code）。
2. 在列表里选择会话，或按标题/目录筛选。
3. 选择 **带完整上下文继续** 或 **总结后开始新对话**。
4. 选择目标工作区。
5. 点 **导入**。

导入完成后，会话会出现在所选工作区并自动打开。

## 模型工具

插件还注册了 `agent_history_import` 工具，适合已经知道要导入哪个会话，或在自动化/脚本会话里使用：

- `action: "list"`（可选 `source`）：返回可用的来源和最近会话列表。
- `action: "import"`（需要 `source`、`file`、`mode`）：把指定会话导入到当前 Agent 所在的工作区，`mode` 为 `continue` 或 `summary`。

工具和侧边栏对话框共用同一套解析、转换、总结和写入逻辑。

## 读取的历史目录

| 来源 | 目录 |
|---|---|
| Codex | `~/.codex/sessions`，以及 `~/.codex/archived_sessions` 中未压缩的 `.jsonl` |
| Pi | `~/.pi/agent/sessions` |
| Claude Code | `~/.claude/projects` |

只读取这些目录下的 `.jsonl` 文件；不会修改、移动或删除原始历史。

## 已知限制

- Codex 的推理记录是加密的，不导入。
- Claude Code 的 sidechain（子代理）消息会跳过，只导入主会话。
- Codex 中注入的 AGENTS.md、环境上下文等系统消息会过滤掉，只保留真人输入。
- 同一个会话重复导入会生成新的 DSH 会话，不会去重。
- 会话列表每个来源最多显示最近 80 个；更早的会话需要调整 `maxSessions` 后再导入。
- 导入使用会话原来的标题（截断到 80 字节）；总结模式使用 `Summary · 原标题`，没有原标题时使用 `Summary of <来源> session`。
- 会话文件上限默认 48 MiB，可在插件配置中调整。
- 总结模式最多读取 1,200,000 字符的 transcript；超过时只总结前一部分，并在导入完成页显示提示。
- 总结模式会把 transcript 发送给当前配置的模型；继续模式不发起模型请求。
- 导入过程中可以取消；已经写入的会话会保留，但不会自动重试。
- 导入的会话以所选工作区目录作为 `cwd`，不会自动切换回原始目录。

## 配置

在 `cordis.patch.yml` 中覆盖 `agent-history-import` 行的配置：

```yaml
- id: agent-history-import
  config:
    maxSessions: 80
    maxTranscriptBytes: 50331648
    maxTitleBytes: 80
    maxToolOutputChars: 4000
    summaryChunkChars: 40000
    summaryMaxTokens: 8000
    summaryProvider: ''
    summaryModel: ''
    home: ''
```

`summaryProvider` 和 `summaryModel` 同时为空时使用当前的默认模型。

## 实现

- `src/sources.js`：扫描三个来源的目录，解析各自的 JSONL 格式，归一化成 transcript。
- `src/transcript.js`：把 transcript 转成 DSH seed 事件；生成总结模式的 seed。
- `src/summary.js`：切分、逐段总结、合并。
- `src/importer.js`：`Session.create` 校验后通过 `sessionPersistence` 写入，并加入工作区。
- `src/routes.js`：`/api/agent-history-import/*` 的 owner-only 路由。
- `client.js`：侧边栏按钮、`shell.overlay` 里的导入对话框、NDJSON 进度读取。
