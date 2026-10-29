# 排障

先记住一句话：**上游的鉴权/业务错误一律 HTTP 200**，判断成功只看响应体里的 `code`。任何「HTTP 200 就是成功」的直觉在这里都是错的。

实测证据（2026-10-29，三种请求头状态各打一次）：

```
无 X-api-key 头   → HTTP 200  {"code":2003,"message":"Missing X-api-key"}
空 X-api-key 头   → HTTP 200  {"code":2003,"message":"Missing X-api-key"}
乱码 Key          → HTTP 200  {"code":2003,"message":"Invalid or revoked API key"}
```

> **文档与实测不一致，以实测为准**：官方文档写「缺失或无效返回 `2001`，无权访问返回 `2003`」，但线上从未观测到 `2001`——缺失、无效都落在 `2003`，只能靠 `message` 文本区分。插件因此按 message 细分（`Missing` / `Invalid or revoked` / 其余视为权限），不按 code 细分。

## 1. 症状 → 原因 → 处置

| 症状 | 最可能原因 | 处置 |
| --- | --- | --- |
| 会话里看不到任何 `hithink_*` 工具 | 插件没加载 / `enabled:false` / 没重启 | 查 profile `bundles` 是否含包名；`enabled`；重启 |
| 只有 `hithink_doctor`，没有数据工具 | 域开关没开，或还在 M0 | M0 本来就只有 doctor；数据工具 M1+ 才有 |
| `AUTH_MISSING` | 本地 5 层都没找到 Key | `hithink_doctor` 看 `auth.credentialFiles`，按第一条路径放文件 |
| `Missing X-api-key`（来自上游） | Key 没送到：文件读到了但没进请求头，或配置被覆盖 | 查 `hithink_doctor` 的 `auth.source`；改了配置要重启 |
| `AUTH_INVALID` / `Invalid or revoked API key` | Key 被删、拼错、带了引号 | 重新签发；检查 `credentials.env` 值没有引号 |
| `AUTH_DENIED` | Key 有效但没这个 capability 的权限 | 去官网申请权限；**不要重试**，重试不会变好 |
| 改了 Key 但行为没变 | 只在 `apply` 时读一次 | **重启 DSH** |
| `RATE_LIMITED` | 触发动态限流（`code=4001`/HTTP 429） | 插件已按 `Retry-After` 退避重试；仍失败就降频、改批量端点 |
| `EMPTY`（3002） | 非交易日 / today-only 类查了历史日 / 报告期不存在 | 先查交易日历；别把空数据当故障，别补 0 |
| `SYMBOL_INVALID` | 传了中文名、未知后缀，或基金/债券代码没写交易所 | 先 `hithink_symbol_search`；或用显式后缀 `510300.SH` |
| `UPSTREAM_INVALID_RESPONSE` | 上游契约变了 | 带上 `requestId` 报障；跑 `git pull` 跟上游文档 |
| 结果被截断 | 超过落盘阈值 | 正常行为：完整结果在返回的 `path` 里 |
| 整个 Web UI 打不开 / 报 `Failed to load plugins` | 插件在 `apply` 里抛了 | 极少见（`apply` 全程 try/catch）；用 `enabled:false` 或卸载隔离 |

## 2. 业务码表

| code | 文档含义 | 实测行为 | 插件归类 | 可重试 |
| --- | --- | --- | --- | --- |
| 0 | 成功 | 成功 | — | — |
| 1001 | 参数缺失 | 未观测到，按文档实现 | `VALIDATION` | 否 |
| 1003 | 参数非法（含窗口超限、非法枚举） | 未观测到，按文档实现 | `VALIDATION` | 否 |
| 2001 | 文档：Key 缺失或无效 | **未观测到** | 按 `AUTH_INVALID` 处理 | 否 |
| 2003 | 文档：无权访问该 capability | **缺失 Key、无效 Key、无权限三种都返回它** | 看 `message` 细分 | 否 |
| 3001 | 标的不存在 | 未观测到 | `SYMBOL_INVALID` | 否 |
| 3002 | 空数据 | 未观测到 | `EMPTY` | 否 |
| 4001 | 限流 | 未观测到（HTTP 429 可作旁证） | `RATE_LIMITED` | 是（有上限） |
| 5001 / 5002 / 5003 | 服务端错误 | 未观测到 | `UPSTREAM` | 是（有上限） |
| 5xxx 其他 | 服务端错误 | 未观测到 | `UPSTREAM` | 否 |

**`2003` 的三种含义必须靠 `message` 区分**（实测）：

| message | 真实含义 | 用户该做什么 |
| --- | --- | --- |
| `Missing X-api-key` | Key 没送到上游 | 查插件有没有读到 Key、改完是否重启 |
| `Invalid or revoked API key` | Key 失效/被吊销 | 重新签发，更新凭据文件 |
| 其他（含权限字样） | Key 有效但没这个 capability | 到官网申请权限，重试无用 |

合并成一句「认证失败」会让用户做错事——这正是插件按 message 细分的原因。

## 3. 五条快速判据

```powershell
# 1. 插件是否在 bundles 里（返回 true 只说明清单登记了，不代表 junction 存在）
node -e "const p=require(process.env.DSH_HOME+'/profiles/desktop/package.json'); console.log(p.dsh.profile.bundles.includes('dsh-hithink-finance'))"

# 2. 清单里的 link: 是否指向本包（退出码 0 = 指向对；此命令不检查 junction）
node scripts\profile-link.mjs --action check --profile desktop --name dsh-hithink-finance

# 3. 凭据文件到底在哪、有没有被读到（不打印值）
node -e "import('./lib/credentials.js').then(m=>console.log(m.resolveApiKey({config:{}}).source))"

# 4. 端点活着吗（不需要 Key；期望 code=2003）
node -e "fetch('https://fuyao.aicubes.cn/api/a-share/prices/snapshot?thscodes=600519.SH').then(r=>r.json()).then(console.log)"

# 5. 宿主是否在跑（安装/卸载前必查）
Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue
```

第 4 条要注意：响应体 `code=2003` 说明**网络与端点都正常**，问题在凭据；如果连不上（超时/DNS），才是网络问题。

## 4. 常见误判

**「我改了配置但没生效」** —— Cordis 的 `config` 在 `apply` 时读一次。运行中改 `cordis.patch.yml` 还会被实例回写覆盖。正确姿势：关 DSH → 改 → 开。

**「装了插件但 Web UI 反而打不开」** —— 本插件没有客户端半，不进 UI。若出现这种症状，先怀疑别的插件；用 `enabled:false` 隔离验证。

**「hithink_doctor 里没有 previous 字段」** —— 正常：`previous` 是 `install.ps1` 调用 `profile-link.mjs add` 时打印的、被替换掉的旧依赖值，不在 doctor 输出里。

**「中文名/基金代码查不到」** —— 设计如此。插件拒绝对中文名猜交易所，也拒绝为基金、债券、三板代码猜后缀；先 `hithink_symbol_search`，或直接写全 `510300.SH`。

**「返回空但上游说支持」** —— 先确认是不是 today-only 端点查了历史日期，或该 capability 你的账号没权限（`2003` 有时被上层包装成看起来的空结果，M1 起插件会显式区分）。

## 5. 报障要带什么

| 项 | 从哪拿 |
| --- | --- |
| `requestId` | 错误返回的 `error.requestId`（来自上游信封） |
| 业务码与 message | 同上 |
| 工具名与参数 | 调用记录；**参数里不要带 Key** |
| `hithink_doctor` 输出 | 已脱敏，可直接贴 |
| 时间（带时区） | 上游日志按时间检索 |

**不要贴**：API Key、完整请求头、含 Key 的截图。
