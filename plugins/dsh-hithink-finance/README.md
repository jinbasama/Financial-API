# dsh-hithink-finance

DeepSeek Harness 插件：把**同花顺金融数据服务**（Fuyao，`https://fuyao.aicubes.cn`）接成一组精选的 `hithink_*` 工具。

上游是官方 MIT 开源的 [Financial-API](https://github.com/20170922/Financial-API) monorepo，本仓库即其 fork。REST 契约、字段与业务码以仓库根的 `docs/api/` 为准——本插件不复制契约，只说明自己怎么运转。

> **当前版本 0.1.0（M0）**：只提供骨架与 `hithink_doctor`，**没有数据工具、不发网络请求**。
> 数据工具按 M1–M3 分批落地，进度见 [DESIGN.md §0](DESIGN.md#0-实现进度) 与 [CHANGELOG.md](CHANGELOG.md)。

## 为什么不是直接挂官方 MCP

官方提供 6 个托管 MCP 服务、**72 个工具**。在 DSH 里挂上去零代码，但内置的 `@deepseek-ai/dsh-mcp-client` **没有工具过滤项**，全量注入约占 **7–10k token/轮次**。

本插件改成按域精选：默认 7 个工具约 1.1k token，关掉的域**根本不注册**。想用全量能力时，自己往 profile patch 里加 mcp-client 行即可（片段见 [DESIGN.md](DESIGN.md) 决策 2），不需要动本插件。

## 工具

M0 已实现：

| 工具 | 作用 | 需要 Key |
| --- | --- | --- |
| `hithink_doctor` | 诊断：Key 从哪来、哪些域开了、有效限额 | 不需要 |

计划中（端点与参数已核对上游契约，见 [docs/TOOLS.md](docs/TOOLS.md)）：

| 域 | 工具 | 里程碑 |
| --- | --- | --- |
| core | `symbol_search` / `quote` / `history` / `financials` / `valuation` | M1 |
| special | `special`（涨停/龙虎榜/热榜/异动） | M2 |
| index / fund / futures / calendar | `index` / `fund` / `futures` / `calendar`（默认关） | M3 |

## 安装

```powershell
# 前提：先关闭 DSH。运行中改 profile 会被实例回写覆盖
.\install.ps1 -DryRun     # 先看要改什么
.\install.ps1             # 真装
```

然后重新打开 DSH，让 agent 调 `hithink_doctor` 验收。

卸载：`.\install.ps1 -Remove`。

参数、验收分级、回滚、升级见 [docs/OPERATIONS.md](docs/OPERATIONS.md)。

## 配置 API Key

Key 在 <https://fuyao.aicubes.cn/admin/> 用同花顺账号登录后签发（**地址末尾斜杠必须保留**，否则会从 HTTPS 降级到 HTTP、登录态丢失）。

插件按以下顺序找 Key，第一个非空生效：

1. 配置项 `apiKey`
2. 环境变量 `HITHINK_FINANCE_API_KEY`
3. `$DSH_HOME\hithink-finance\credentials.env`（一行 `HITHINK_FINANCE_API_KEY=<key>`，**值不能带引号**）
4. `%APPDATA%\hithink-finance\credentials.env`（上游 CLI 的位置）
5. 旧变量 `FUYAO_TOKEN` / `API_KEY`

Key 只在 `apply` 时读一次——改完要重启 DSH。细节与轮换见 [docs/CREDENTIALS.md](docs/CREDENTIALS.md)。

## 配置

在 profile 的 `cordis.patch.yml` 覆盖（改完重启）：

```yaml
- id: hithink-finance
  config:
    enabled: true
    domains: { core: true, special: true, index: false, fund: false }
    spillRows: 200      # 超过就落盘，不进上下文
    timeoutMs: 15000
    maxRetries: 2
```

全字段、默认值、钳制规则、token 估算见 [docs/CONFIGURATION.md](docs/CONFIGURATION.md)。

## 能力边界

**有**：A 股行情与日 K、集合竞价、财报三表与指标、估值、交易日历、指数与板块、特色数据、公募基金、公开期货期权。

**没有**（上游口径，不假装有）：分钟 K / tick / Level-2、港股美股、宏观、新闻公告原文、研报原文、基金申赎、投资建议。资金流向与高频数据被标注「端内专用」，端外不可用。

真实数据不可用时插件报错误对象，**不返回模拟数据或近似值**。

## 开发

```bash
npm run check   # 七个文件的语法检查
npm test        # 37 例，无第三方框架、无网络
```

测试布局、覆盖与未覆盖、沙箱 `EPERM` 坑见 [docs/TESTING.md](docs/TESTING.md)。

改代码前请读 [AGENTS.md](AGENTS.md)：三条不可违反（`apply` 不许抛、零依赖、Key 不进持久位置）与七条「不要做」。

## 文档

| 文件 | 内容 |
| --- | --- |
| [DESIGN.md](DESIGN.md) | 设计方案：目标、模块划分、关键决策、复用清单、里程碑、验收口径 |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 运行时模型、模块图、一次调用的数据流、生命周期、失败收口 |
| [docs/TOOLS.md](docs/TOOLS.md) | 工具参考：参数、返回、端点映射、窗口/分页约束、边界 |
| [docs/CONFIGURATION.md](docs/CONFIGURATION.md) | 全部配置字段、域→工具→token、三套推荐配置 |\
| [docs/CREDENTIALS.md](docs/CREDENTIALS.md) | Key 获取、解析顺序、文件格式、脱敏、轮换 |
| [docs/OPERATIONS.md](docs/OPERATIONS.md) | 安装/升级/回滚、验收 L1–L9、重启语义 |
| [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | 症状→原因→处置、业务码表、五条快速判据 |
| [docs/TESTING.md](docs/TESTING.md) | 怎么跑、覆盖什么、没覆盖什么、真实验收流程 |
| [docs/UPSTREAM.md](docs/UPSTREAM.md) | 上游来源、MIT 复用逐文件表、许可证边界、同步与漂移巡检 |
| [docs/AUDIT-2026-10-29.md](docs/AUDIT-2026-10-29.md) | M0 代码审计：20 项缺陷、复核结论、残留风险 |
| [CHANGELOG.md](CHANGELOG.md) | 版本记录 |
| [AGENTS.md](AGENTS.md) | 给后续 agent 的约束与文档同步表 |

## 目录

```
lib/index.js              插件入口（apply 永不抛错）
lib/config.js             配置归一化与域开关
lib/credentials.js        Key 解析顺序与脱敏
lib/thscode.js            代码归一化（中文名不猜，必须走 search）
lib/tools/diag.js         hithink_doctor
lib/tools/render.js       输出渲染
scripts/profile-link.mjs  profile 清单改写（保留键序与行尾）
install.ps1               安装/卸载（junction + 清单）
test/                     37 例，node:test
docs/                     九份文档
```

## License

MIT，继承上游。`@dshtrading/connector-hithink` 的代码**未被使用**（它是 PolyForm-Noncommercial），详见 [docs/UPSTREAM.md](docs/UPSTREAM.md)。
