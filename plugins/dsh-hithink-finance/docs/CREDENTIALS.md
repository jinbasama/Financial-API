# 凭据

同一个 API Key 同时服务本插件、官方 CLI 与托管 MCP。**不要为不同入口各配一份**——那只会让「到底哪份生效」变成排障负担。

## 1. 获取

1. 用同花顺账号登录 <https://fuyao.aicubes.cn/admin/>。
2. **地址末尾的斜杠必须保留**。不带斜杠时页面会从 HTTPS 重定向到 HTTP，扫码后的登录态存不下来——这是上游已知行为，不是网络问题。
3. 「创建 API Key」→ 填别名（≤64 字符）→ 签发。
4. 部分 capability 需要单独申请权限；没权限时调用返回业务码 `2003`（不是 Key 无效）。

## 2. 解析顺序

`lib/credentials.js` 的 `resolveApiKey()`，第一个非空值生效：

| 顺序 | 来源 | 适用场景 |
| --- | --- | --- |
| 1 | 配置项 `apiKey` | 临时调试；**不要提交进 git** |
| 2 | 环境变量 `apiKeyEnv`（默认 `HITHINK_FINANCE_API_KEY`） | 一次性会话、CI |
| 3 | `$DSH_HOME/hithink-finance/credentials.env` | **推荐**，跨会话持久 |
| 4 | `%APPDATA%\hithink-finance\credentials.env` | 官方 CLI 的位置，装了 CLI 就直接复用 |
| 5 | 旧变量 `FUYAO_TOKEN` | 兼容老配置，仅在前四项都空时。**`API_KEY` 刻意不收**：这个变量名太通用，别的工具也在用，把别人的密钥当 fuyao Key 发出去比让用户配一次更糟 |

第 5 项是**兜底不是推荐**：这两个变量名太泛，机器上可能被别的工具占用，得到「Key 莫名其妙不对」的症状。

## 3. 凭据文件格式

```
HITHINK_FINANCE_API_KEY=<你的 key>
```

规则（与上游 `python/marketdb/credentials.py` 一致）：

- 一个文件一行；`#` 开头的行被忽略。
- 变量名必须是 `HITHINK_FINANCE_API_KEY`（读旧名无意义）。
- **值不能带引号**。上游实现直接拒；本插件同样拒，并把原因写进 `hithink_doctor` 的 `auth.notes`。
- UTF-8 BOM 会被忽略（有人用记事本另存为 UTF-8 with BOM）。
- 空值等于没配。

写在哪：

```
$DSH_HOME\hithink-finance\credentials.env
```

Windows 上建议把目录权限收到当前用户可读写。**不要**放进项目目录、仓库、或任何会被提交的位置。

## 4. Key 在运行时怎么流动

```
apply()
  └─ resolveApiKey() → { key, source }        // 只在这一刻读一次
       └─ 存进闭包 state.creds
            └─ 每次工具调用：scan → tool.execute(deps, args)
                 └─ deps.creds.key → 放进 X-api-key 请求头
```

关键点：

- **只在 apply 时读一次**。改了环境变量或凭据文件，**要重启 DSH** 才生效。这点会让「我明明改了」变成假故障，见 [TROUBLESHOOTING.md](TROUBLESHOOTING.md)。
- 工具不重读 `process.env`，所以同一个会话内 Key 不会中途变化。
- `hithink_doctor` 只报告 `source`（如 `env:HITHINK_FINANCE_API_KEY`、`file:C:\...`），**不报告值，也不报告长度**。

## 5. 脱敏

`redact(value, secret)` 把对外文本里的 Key 换成 `***`（短于 4 字符不替换，避免误伤普通词）：

- 错误消息
- 日志
- 工具返回值
- 诊断输出

实现细节：短于 4 字符的 secret 不替换（避免把普通词误伤成 `***`）。真实 Key 远长于此，不构成风险。

单测断言：给 `apply` 一个显式 Key，然后序列化 `hithink_doctor` 的全部输出，断言里面**不出现该 Key**。

## 6. 轮换与吊销

| 动作 | 做法 | 影响 |
| --- | --- | --- |
| 轮换 | 官网签发新 Key → 覆盖凭据文件 → 重启 DSH | 旧 Key 在官网删除前仍有效 |
| 吊销 | 官网删除 Key | 立刻失效，调用返回 `2003 Invalid or revoked API key` |
| 怀疑泄漏 | 官网删除 → 重新签发 → 更新凭据文件 → 查日志/历史里是否有明文 | 本插件不落盘 Key，泄漏面在别处（如手写的脚本） |

与 CLI 并存时注意：CLI 会把 Key 存进系统凭据库（独立副本）。本插件不读写系统凭据库——**只用环境变量与文件**，行为可预期，也不需要 keyring 原生模块。

## 7. 不要做的事

- 不要把 Key 贴进对话、issue、README、测试夹具。
- 不要把 Key 放进命令行参数（会进 shell history 与进程列表）。
- 不要用 `apiKey` 配置项做长期方案——配置文件会被备份、被同步、被截图。
- 不要在日志里打印完整请求头。`hithink_doctor` 的 `auth.source` 已经够定位问题。
