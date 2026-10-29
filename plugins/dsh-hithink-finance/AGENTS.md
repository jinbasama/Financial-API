# AGENTS.md — dsh-hithink-finance

给接下来动这个子目录的 agent / 人的规矩。上游 `../../AGENTS.md` 仍然适用（尤其是「不要把 Key 写进代码/日志/产物」与「大数据必须落盘」），本文件只补插件自己的约束。

## 三条不可违反

1. **`apply()` 不许抛。** 同步抛出会让 DSH 的 loader 条目失败，boot 审计报 `Failed to load plugins`，整个 Web UI 打不开。任何新增逻辑都必须包在 try/catch 里，宿主交互失败降级成一条 warn。
2. **零运行时依赖。** 只能 `import 'node:*'`。第三方插件不能 `import '@deepseek-ai/*'`（在 `app.asar` 里），也不要引入 zod 等库——profile 里已有多份，版本冲突会让插件静默不加载。
3. **Key 不进任何持久位置。** 不写日志、不写错误消息、不写测试夹具、不进 git。所有对外文本必须过 `redact()`，`hithink_doctor` 只能报来源不报值。

## 改代码时的检查单

- [ ] `npm run check` 退出码 0
- [ ] `npm test` 退出码 0
- [ ] 新增的边界判定，先用 3 行脚本复现一次，再决定改不改（见 `docs/AUDIT-2026-10-29.md` 末尾的方法教训）
- [ ] 新增工具：`domain` 必须在 `DOMAIN_KEYS` 里，`selectTools` 才会按开关注册
- [ ] 新增工具：`description` ≤ 2 行，写清「做什么 + 何时用 + 一个硬约束」——它是常驻上下文成本
- [ ] 新增工具：返回值要么小，要么走落盘（M2 起）
- [ ] 涉及密钥的测试，最后断言输出里不含密钥

## 不要做的事

- **不要给 `package.json` 加 `peerDependencies` 里的 `@deepseek-ai/dsh*`。** DSH 0.2 起对这类 peer 做 fail-closed 预检，版本区间写错会让整包不加载，症状是「插件在列表里但功能全无」。当前刻意不声明。
- **不要加 `dsh.client`（客户端半 / 设置页）。** 本插件没有 UI，加一个跑不起来的客户端 entry 会让整个界面打不开（本机在别的插件上踩过）。
- **不要把 `dsh-mcp-client` 挂进来。** 72 个工具无法过滤，约 7–10k token/轮次；需要全量时由用户自己在 patch 里加，见 `DESIGN.md` 决策 2。
- **不要改上游目录**（`docs/`、`python/`、`skills/`、`hithink-finance-cli/`）。要保持 `git merge --ff-only mirror/main` 永远可行。
- **不要在 `install.ps1` 里引入非 ASCII 字符。** Windows PowerShell 5.1 会把无 BOM 的 UTF-8 `.ps1` 当 ANSI 读，中文注释会直接破坏解析。
- **不要用 `node --test test/`** 跑测试：沙箱禁止 spawn，会 `EPERM`。用 `npm test`（逐文件直接执行）。
- **不要用 PowerShell 的 `Set-Content -Encoding utf8` 改含中文的源文件**：本机实测会写出 BOM。文本改动走写入工具。

## 文档维护

| 改了什么 | 必须同步 |
| --- | --- |
| 工具的参数/返回 | `docs/TOOLS.md` |
| 配置字段或默认值 | `docs/CONFIGURATION.md`（含 token 估算表） |
| 凭据解析顺序 | `docs/CREDENTIALS.md` |
| 安装/卸载流程 | `docs/OPERATIONS.md` |
| 错误分类或业务码映射 | `docs/TROUBLESHOOTING.md` |
| 新增测试或覆盖范围 | `docs/TESTING.md`（含「没覆盖什么」） |
| 复用上游的文件 | `docs/UPSTREAM.md` |
| 里程碑状态 | `DESIGN.md` §0 与 §10、`CHANGELOG.md` |

文档里写「已实测」的地方，必须真的跑过；没跑过的写「待验证」。
