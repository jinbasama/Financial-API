# 配置

配置来源只有一个：profile 的 `cordis.patch.yml` 里本插件那一行的 `config:` 块。Cordis 的 `config` 是**整体替换**，所以没写的字段走默认值，不会与上一份配置合并——不用担心「上次开的域还开着」。

```yaml
# $DSH_HOME/profiles/desktop/cordis.patch.yml
- id: hithink-finance
  config:
    enabled: true
    domains:
      core: true
      special: true
      index: false
      fund: true
      futures: false
      calendar: false
    spillRows: 300
    timeoutMs: 20000
```

改完**必须重启 DSH**：配置在 `apply` 时读一次，运行中改文件会被实例回写覆盖（本机实测过的坑，见 [OPERATIONS.md](OPERATIONS.md)）。

## 1. 字段表

| 字段 | 类型 | 默认 | 合法范围 | 说明 |
| --- | --- | --- | --- | --- |
| `enabled` | boolean | `true` | — | 总开关。`false` 时**一个工具都不注册** |
| `apiKey` | string | `""` | — | 显式 Key，优先级最高。不建议写在这里（会进 git / 配置备份） |
| `apiKeyEnv` | string | `HITHINK_FINANCE_API_KEY` | 非空 | 改读哪个环境变量 |
| `baseUrl` | string | `https://fuyao.aicubes.cn` | `http(s)://host` | 端点根；非法值自动退回默认 |
| `domains.core` | boolean | `true` | — | 行情/历史/财报/估值/标的检索 |
| `domains.special` | boolean | `true` | — | 涨停/龙虎榜/热榜等特色数据 |
| `domains.index` | boolean | `false` | — | 指数与板块 |
| `domains.fund` | boolean | `false` | — | 公募基金 |
| `domains.futures` | boolean | `false` | — | 公开期货 |
| `domains.calendar` | boolean | `false` | — | 交易日历 |
| `spillRows` | int | `200` | 1–100000 | 结果行数超过就落盘 |
| `spillBytes` | int | `65536` | 1024–64MB | 序列化字节超过就落盘 |
| `timeoutMs` | int | `15000` | 1000–120000 | 单请求超时 |
| `maxRetries` | int | `2` | 0–5 | 首次尝试之外的重试次数 |

**容错规则**（`lib/config.js`）：

- 布尔接受 `true/false`、数字 `0/1`、字符串 `"true"/"false"/"1"/"0"`；其他值退回默认。
- 整数越界被钳到边界，非数字退回默认。
- `baseUrl` 不是合法 http(s) URL 就退回默认——否则会拼出 `fetch("https:/api/...")` 这种必然失败的请求。
- 未知字段**被忽略**（不报错）：patch 里多写一项不该让 boot 失败。

## 2. 域 → 工具 → 上下文成本

| 域 | 工具 | 默认 | 估算常驻 token |
| --- | --- | --- | --- |
| `diag`（不可关） | `hithink_doctor` | 开 | ~150 |
| `core` | `hithink_symbol_search`/`quote`/`history`/`financials`/`valuation` | 开 | ~700 |
| `special` | `hithink_special` | 开 | ~200 |
| `index` | `hithink_index` | 关 | ~180 |
| `fund` | `hithink_fund` | 关 | ~200 |
| `futures` | `hithink_futures` | 关 | ~200 |
| `calendar` | `hithink_calendar` | 关 | ~120 |

**默认（diag+core+special）≈ 1.1k token；全开 ≈ 1.8k**（本表逐项相加是 1050 / 1750；估算，不是分词器实测）。关掉的域不注册，省的是实打实的上下文，不是「注册了再拒绝」。

对照：官方 6 个托管 MCP 全量 72 个工具约 7–10k token/轮次。差 5–8 倍。

> 估算方法：`name + description + inputSchema` 序列化字节数 ÷ 3（中文描述 3 字节/字 ≈ 1 token）。**不是分词器实测**——M1 落地后用真实工具列表复核，把偏差写回本表。

## 3. 三个推荐配置

**日常看盘（默认）**：不用配，装完就是。

**研究型（要基金与指数）**：

```yaml
- id: hithink-finance
  config:
    domains: { core: true, special: true, index: true, fund: true }
    spillRows: 500
```

**极简（只要行情，压上下文）**：

```yaml
- id: hithink-finance
  config:
    domains: { core: true, special: false }
    spillRows: 100
```

**临时全关**（排障时确认「是不是这个插件在捣乱」）：

```yaml
- id: hithink-finance
  config:
    enabled: false
```

关掉后工具消失，但**包仍在 profile 依赖里**——`/plugin` 面板仍能看到它。这是有意的：`enabled:false` 是配置状态，不是卸载。

## 4. 覆盖优先级

```
DEFAULTS（lib/config.js 的 DEFAULTS）
  < cordis.patch.yml 里本行 config
```

没有环境变量层、没有用户配置文件层。DSH 的 cordis 配置就是唯一真相源，少一层少一类「到底哪个生效」的问题。

`apiKey` 是例外：它的解析顺序在 [CREDENTIALS.md](CREDENTIALS.md)，配置项只是第一优先。

## 5. 上下文预算

常驻 = 工具 schema。动态 = 工具返回值（受落盘阈值约束）。

- 工具 schema：见上表。
- 返回值：默认超过 200 行或 64 KB 就落盘，正文只留 head + 路径 + 行数。
- skill（M4）：只在被加载时进上下文，约 1k token，非常驻。

## 6. 校验配置是否生效

M0 没有 `/hithink-finance/status` 路由，用 `hithink_doctor` 看：

```json
{ "domains": { "enabled": ["core","special","index","fund"] },
  "limits": { "spillRows": 500 } }
```

`domains.enabled` 与实际注册的 `tools.registered` 必须自洽；不自洽就是有 bug，报出来。

## 7. 为什么不做可视化设置页

设置页要挂客户端半（`dsh.client`），代价是：一段常驻前端代码、一条 `settingsScope` 依赖、以及**一旦客户端 entry 激活不了整个 Web UI 就打不开**（本机在别的插件上踩过这个坑）。

本插件的配置项少、改一次用很久，YAML 足够。等真正需要频繁调参时再加，且必须能单独摘掉。
