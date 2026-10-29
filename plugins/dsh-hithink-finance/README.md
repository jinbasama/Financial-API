# dsh-hithink-finance

DeepSeek Harness 插件：把**同花顺金融数据服务**（Fuyao，`https://fuyao.aicubes.cn`）接成一组精选的 `hithink_*` 工具。

> 上游是官方 MIT 开源的 [Financial-API](https://github.com/20170922/Financial-API) monorepo（本仓库即其 fork）。
> REST 契约、字段与业务码以 `../../docs/api/` 为准——**本 README 不复制契约**，只说明插件自己怎么运转。

## 为什么不是直接挂官方 MCP

官方提供 6 个托管 MCP 服务、**72 个工具**。在 DSH 里挂上去零代码，但 `@deepseek-ai/dsh-mcp-client` **没有工具过滤项**，全量注入约占 **7–10k token/轮次**。本插件改成按域精选，默认 7 个工具（约 1.2k token），关掉的域**根本不注册**。

想用全量能力时，自己在 profile patch 里加 mcp-client 行即可（见 `DESIGN.md` 决策 2），不需要改本插件。

## 工具

默认开启：

| 工具 | 作用 |
| --- | --- |
| `hithink_doctor` | 诊断：Key 从哪来、哪些域开了、有效限额。**不需要 Key** |
| `hithink_symbol_search` | 名称/代码/关键词 → 唯一 `thscode` |
| `hithink_quote` | 行情快照（最多 50 只） |
| `hithink_history` | 历史日 K（单只，窗口 ≤10 年，复权可选） |
| `hithink_financials` | 利润表/资产负债表/现金流量表/财务指标 |
| `hithink_valuation` | 估值快照（PE/PB/PS/PCF） |
| `hithink_special` | 涨停/跌停/炸板/连板/龙虎榜/热榜/异动 |

可选域（默认关）：`hithink_index`、`hithink_fund`、`hithink_futures`、`hithink_calendar`。

## 安装

```powershell
# 先关闭 DSH：运行中改 profile 会被实例回写覆盖
.\install.ps1
# 然后重新打开 DSH
```

卸载：

```powershell
.\install.ps1 -Remove
```

`-DryRun` 只打印计划不动手。装完用 `hithink_doctor` 验收（不需要 Key 也能跑）。

## 配置 API Key

Key 在 <https://fuyao.aicubes.cn/admin/> 用同花顺账号登录后签发（**地址末尾斜杠必须保留**，否则会从 HTTPS 降级到 HTTP、登录态丢失）。

插件按以下顺序找 Key，第一个非空生效：

1. 插件配置项 `apiKey`
2. 环境变量 `HITHINK_FINANCE_API_KEY`
3. `$DSH_HOME\hithink-finance\credentials.env`（一行 `HITHINK_FINANCE_API_KEY=<key>`，**值不能带引号**）
4. `%APPDATA%\hithink-finance\credentials.env`（上游 CLI 的位置）
5. 旧环境变量 `FUYAO_TOKEN` / `API_KEY`

Key 不会出现在工具输出、错误消息或日志里（所有对外文本过 `redact()`）。

## 配置项

在 profile 的 `cordis.patch.yml` 覆盖，改完重启：

```yaml
- id: hithink-finance
  config:
    enabled: true
    domains:
      core: true
      special: true
      index: true     # 打开指数域
      fund: true      # 打开基金域
    spillRows: 200    # 超过就落盘，不进上下文
    timeoutMs: 15000
    maxRetries: 2
```

`enabled: false` = 一个工具都不注册。

## 能力边界

**有**：A 股行情与日 K、集合竞价、财报三表与指标、估值、交易日历、指数与板块、特色数据、公募基金、公开期货期权。

**没有**（官方口径，不要假装有）：分钟 K / tick / Level-2、港股美股、宏观、新闻公告原文、研报原文、基金申赎、投资建议。资金流向与高频数据被标注「端内专用」，端外不可用。

真实数据不可用时插件报错，**不返回模拟数据或近似值**。

## 开发

```bash
npm run check     # 语法检查
npm test          # 单元测试（node --test，无第三方框架）
```

测试不经网络。线上可用性只能靠一次真实授权请求证明：`hithink_doctor` 的 `probe` 字段。

## 目录

```
lib/index.js            插件入口（apply 永不抛错）
lib/config.js           配置归一化与域开关
lib/credentials.js      Key 解析顺序与脱敏
lib/thscode.js          代码归一化（中文名不猜，必须走 search）
lib/tools/*.js          按域拆分的工具定义
scripts/profile-link.mjs 改写 profile manifest（保留键序与行尾）
install.ps1             安装/卸载（junction + manifest）
DESIGN.md               设计与模块划分，含关键决策与验收口径
```

## License

MIT（继承上游）。`@dshtrading/connector-hithink` 的代码**未**被使用——它是 PolyForm-Noncommercial，本插件只参考了其思路。
