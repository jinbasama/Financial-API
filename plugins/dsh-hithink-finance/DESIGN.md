# dsh-hithink-finance 设计方案 v0.1

> 状态：**方案评审通过（2026-10-29，选择「fork 官方镜像 → 裁剪成 DSH 形态」），M0 已落地**。
> 上游：fork `20170922/Financial-API`（MIT，官方 `HiThink-Tech/Financial-API` 已 404）。
> 依据：`research/ths-fapi/调研报告.md`。文中「实测」= 本机 2026-10-29 真实执行过。

## 0. 实现进度

| 阶段 | 状态 | 说明 |
| --- | --- | --- |
| M0 | **完成** | fork `jinbasama/Financial-API`、骨架、`config/credentials/thscode`、`hithink_doctor`、`install.ps1`；21 个单测通过 |
| M1 | 待开工 | `http.js` + core 5 工具 + doctor 探针 |
| M2–M4 | 待开工 | 见 §10 |

**M0 的一处方案修正**：原计划「M0 注册 0 个工具」，但一个既无工具又无路由的插件**无法证明自己加载成功**——症状和「没装上」完全一样。因此 M0 就注册 `hithink_doctor`，它同时是唯一的加载证据。

---

## 1. 目标与非目标

### 目标

1. 让 agent 能用自然语言查同花顺数据（A 股行情、财报、估值、涨停/龙虎榜、指数、基金、期货）。
2. **零常驻上下文污染**：默认只注册 7 个工具、约 1.2k token；域级开关可再收窄。
3. **失败可解释**：缺 Key / 无权 / 限流 / 空数据 四类失败给出可执行的下一步，不伪造数据。
4. **可整体禁用**：`enabled: false` 一台开关关掉全部工具。
5. **上游可同步**：fork 保留官方契约文档，接口变更时能 diff。

### 非目标（明确不做）

| 不做 | 理由 |
| --- | --- |
| 不做交易下单 | 官方 API 无交易通道；本项目只做数据面 |
| 不做本地 DuckDB / `data sync` | 那是 CLI 的活；插件只做远端取数，避免写盘副作用 |
| 不做全市场扫描落库 | 会打满限流；需要时用 CLI 的 market-dumps |
| 不做「端内专用」能力 | 资金流向/高频/tick、Level-2 官方标注**端内专用**，端外不可用（`capital-flow.md` 明写「当前不作为端外接入入口」） |
| 不打包 Python SDK | 与 DSH 无关，留在 fork 里供参考 |

---

## 2. 系统边界与数据流

```
agent
  │  tool call: hithink_quote { thscodes: ["600519.SH"] }
  ▼
┌──────────────────────────── dsh-hithink-finance（本插件）────────────────────────────┐
│  registry（按 config.domains 只注册启用的工具）                                      │
│     │                                                                              │
│     ├─ tools/*.js      参数校验 / thscode 归一化 / 端点与参数拼装                    │
│     ▼                                                                              │
│  http.js  ──► FuyaoClient 移植（信封校验 / 业务码分类 / 重试+Retry-After / 超时）    │
│     │                                                                              │
│     ├─ spill.js        结果 >阈值 → 写 workspace 文件，回 {path,rows,window,head}    │
│     └─ credentials.js  Key：config → env → $DSH_HOME 凭据文件 → 结构化错误            │
└────────────────────────────────────┬───────────────────────────────────────────────┘
                                     │ HTTPS GET  X-api-key
                                     ▼
                     https://fuyao.aicubes.cn/api/**
                     信封 { code, message, request_id, data }   ← HTTP 恒 200
```

关键事实（实测）：**鉴权错误不体现在 HTTP 状态码**——无 Key 返回 `200 + code=2003`。所以错误分类只能看业务码，不能看 `res.ok`。

---

## 3. 总体架构

### 3.1 仓库布局（fork 内新增子目录，不破坏上游结构）

```
Financial-API/                      ← fork 自 20170922/Financial-API（MIT）
├── docs/ python/ skills/ ...        ← 上游原样保留（契约与文档的权威来源）
├── hithink-finance-cli/             ← 上游原样保留（人工排障用）
└── plugins/
    └── dsh-hithink-finance/         ← 本方案新增，唯一的插件包根
        ├── DESIGN.md                ← 本文件
        ├── package.json             ← dsh.bundle.patch + dsh.client 一律不加 UI
        ├── cordis.patch.yml         ← 只 insert 一行
        ├── install.ps1 / uninstall.ps1
        ├── lib/                     ← 见 §4
        ├── skills/hithink-finance/  ← 改造版 Skill（见 §4.8）
        └── test/                    ← node --test，无第三方测试框架
```

**为什么用 monorepo 子目录而不是「一仓一插件」**：这个项目的主要资产是上游那 600 多个文件的契约文档，插件只是它的一个消费端。拆成两仓后每次上游契约更新都要跨仓手动同步。`install.ps1` 负责把 `plugins/dsh-hithink-finance` junction 进 profile，所以「包根在哪」对 DSH 无感。若将来上游彻底停更，再把插件子目录单独切出去。

### 3.2 本机安装布局

```
$DSH_HOME/profiles/desktop/
├── package.json                    ← dependencies 加 link:<fork>/plugins/dsh-hithink-finance
│                                     dsh.profile.bundles 追加 dsh-hithink-finance
└── node_modules/dsh-hithink-finance → junction 到上述目录

$DSH_HOME/hithink-finance/
└── credentials.env                 ← 仅一行 HITHINK_FINANCE_API_KEY=...（用户级持久凭据）
```

凭据文件沿用官方约定（`python/marketdb/credentials.py` 实测代码）：值**不允许带引号**，否则上游实现直接报错。我们镜像这个行为。

---

## 4. 模块划分

八个模块，依赖单向：`registry → tools/* → http → credentials`，`spill` 与 `thscode` 是叶子工具库。

### 4.1 `lib/config.js` — 配置与默认值

| 字段 | 类型 | 默认 | 作用 |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | 总开关；false 时一个工具都不注册 |
| `apiKey` | string | `''` | 显式 Key（优先级最高；不建议写进配置） |
| `apiKeyEnv` | string | `HITHINK_FINANCE_API_KEY` | 换环境变量名用 |
| `baseUrl` | string | `https://fuyao.aicubes.cn` | 端点根 |
| `domains` | object | 见下 | 域级开关 |
| `spillRows` | int | `200` | 行数阈值，超过落盘 |
| `spillBytes` | int | `65536` | 字节阈值，超过落盘 |
| `timeoutMs` | int | `15000` | 单请求超时 |
| `maxRetries` | int | `2` | 重试次数（插件比 CLI 保守，避免拖住 agent 回合） |

`domains` 默认：`{ core: true, special: true, index: false, fund: false, futures: false, calendar: false }`

- 默认开 7 个工具 ≈ 1.2k token；全开 11 个 ≈ 2k token。
- 关闭的域**不注册工具**（不是注册了再返回「未启用」），这样上下文真的省下来。

校验走原生断言，**不引入 zod**：DSH profile 里已有多份 zod，插件零依赖才不会撞 peer 冲突（`dsh-windows-mcp` 也是零运行时依赖）。

### 4.2 `lib/credentials.js` — Key 解析与脱敏

解析顺序（与官方一致，实测代码来自 `marketdb/credentials.py` + `ApiKeyAuthProvider.resolve`）：

1. `config.apiKey`
2. `process.env[config.apiKeyEnv]`
3. `$DSH_HOME/hithink-finance/credentials.env`（Windows 亦兼容 `%APPDATA%\hithink-finance\credentials.env`）
4. 兼容旧名 `FUYAO_TOKEN` / `API_KEY`（只在 1–3 全空时）
5. 都没有 → 抛 `AUTH_MISSING`，`hint` 指向 `https://fuyao.aicubes.cn/admin/`（**带末尾斜杠**，否则 HTTPS 降级到 HTTP 丢登录态）

额外职责：

- `redact(text)`：把已解析的 Key 从任何错误消息/日志里替换成 `***`。所有对外文本过一次。
- `source()`：返回 `'config' | 'env' | 'file' | 'legacy' | 'none'`，给 doctor 用，**不返回值本身**。

### 4.3 `lib/http.js` — FuyaoClient 的 JS 移植

**直接复用** `hithink-finance-cli/src/infrastructure/fuyao/{client,retry,envelope}.ts` 的逻辑（MIT）：

| 上游行为 | 保留？ | 说明 |
| --- | --- | --- |
| `X-api-key` 头 | 保留 | 另加 `X-THS-Skill-Id: DSH-Hithink-Finance`（上游用同名字段标记来源，便于对方排障） |
| 信封校验 `{code,message,request_id,data}` | 保留 | 校验失败 → `UPSTREAM_INVALID_RESPONSE` |
| 业务码分段：1xxx 参数 / 2xxx 认证 / 4xxx5xxx 上游 | 保留 | 映射成对外三种错误类别 |
| 可重试集合 `{4001,5001,5002,5003}` + HTTP `{429,502,503,504}` | 保留 | 实测 `4001` 是限流码 |
| 指数退避 `min(1000·2^n,8000) × (1+0.2·rand)` | 保留 | 但插件 `maxRetries=2`，最多等 ~3s，不拖回合 |
| `Retry-After` 优先（秒/HTTP 日期，上限 30s） | 保留 | 插件降为 10s 上限 |
| Zod 响应 schema 校验 | **去掉** | 字段随上游演进，硬校验会让插件在新字段上假报错；改为「只取需要的字段 + 缺失给 null」 |
| 注入式 `fetch` / `sleep` / `random` | 保留 | 测试时替换，不打网络 |

新增（上游没有的）：

- `AbortSignal` 透传：agent 侧取消能真的中断请求。
- 单次响应体上限（默认 8 MB），超了直接报 `UPSTREAM_TOO_LARGE` 并提示改落盘，避免 OOM。

### 4.4 `lib/thscode.js` — 代码归一化

必须做，否则 agent 一定会传 `600519`、`sh600519`、`贵州茅台` 三种形态。

| 输入 | 输出 | 规则 |
| --- | --- | --- |
| `600519.SH` | 同 | 已是标准形 |
| `sh600519` / `SH600519` | `600519.SH` | 前缀式 |
| `600519` | `600519.SH` | 6 开头 / 900 开头 → SH |
| `000001` | `000001.SZ` | 其余 6 位 → SZ |
| `920002` / `8xxxxx` / `4xxxxx` | 加 `.BJ` | 北交所段 |
| `贵州茅台` 等中文 | **不猜** | 抛 `SYMBOL_NOT_NORMALIZED`，让 agent 先调 `hithink_symbol_search` |

最后一条是刻意的：猜错交易所比报错更糟（会拿到另一只股票的数据）。

### 4.5 `lib/spill.js` — 大结果落盘

判据：`rows > spillRows` 或 `bytes > spillBytes` → 写文件。

- 落点：`<session workspace>/hithink-finance/<yyyymmdd-HHmmss>-<tool>.json`
- 返回：`{ path, rows, bytes, tool, window, head: 前 5 行, note: "完整结果已落盘" }`
- 表头/摘要永远在返回值里，**原始全量永远不进上下文**。
- 文件名用时间戳 + 工具名，不用标的名（避免中文路径在沙箱/编码上出问题）。

### 4.6 `lib/tools/*.js` — 域划分

每个文件导出一个 `{ id, description, parameters, execute }` 数组；不含 HTTP 细节，只做「参数 → 端点 + query」。

| 文件 | 域 | 工具 | 端点 |
| --- | --- | --- | --- |
| `core.js` | 默认开 | `hithink_symbol_search` | `/api/meta/tickers/search` |
| | | `hithink_quote` | `/api/a-share/prices/snapshot` |
| | | `hithink_history` | `/api/a-share/prices/historical` |
| | | `hithink_financials` | `/api/a-share/financials/{income-statements\|balance-sheets\|cash-flow-statements\|indicators}` |
| | | `hithink_valuation` | `/api/a-share/valuations/snapshot` |
| `special.js` | 默认开 | `hithink_special` | `/api/a-share/special-data/*`（kind 枚举 8 值） |
| `diag.js` | 默认开 | `hithink_doctor` | 无（本地诊断 + 1 次有界探针） |
| `index.js` | 可选 | `hithink_index` | `/api/a-share-index/*`（action 4 值） |
| `fund.js` | 可选 | `hithink_fund` | `/api/fund/*`（action 12 值） |
| `futures.js` | 可选 | `hithink_futures` | `/api/futures/*`（action 8 值） |
| `calendar.js` | 可选 | `hithink_calendar` | `/api/a-share/calendar/trading-days` |

**聚合原则**：端点形状一致、只有路径不同的收成一个工具 + `action`/`kind` 枚举（`special`/`index`/`fund`/`futures`）；参数语义不同、返回结构不同的保持独立（`quote` 批量 vs `history` 单标的窗口）。

### 4.7 工具 schema 草案（默认开启的 7 个）

```
hithink_symbol_search
  q:          string  (必填) 「600519.SH / 600519 / 贵州茅台」
  asset_type: enum[]  a-share|a-share-index|fund-etf|fund-lof|fund-otc|fund-reits|futures|options|forex
  exchange:   enum    SSE|SZSE|BSE|CFFEX|SHFE|INE|DCE|CZCE|GFEX
  limit:      int     1..50，默认 10
  → rows[{ thscode, name, asset_type, exchange, list_date?, ... }]

hithink_quote
  thscodes:   string[] 1..50（必填）
  → rows[{ thscode, ticker, last_price, price_change, price_change_ratio_pct,
           open_price, high_price, low_price, prev_price, volume, turnover }]
  + timestamp（数据就绪时间）

hithink_history
  thscode:    string  (必填，单只)
  start:      string  YYYY-MM-DD 或毫秒时间戳（必填）
  end:        string  （必填）
  adjust:     enum    none|forward|backward  默认 forward
  → { rows, first_date, last_date, adjust, path? }
  约束：窗口 ≤10 年（超了由插件先拒绝，不等上游 1003）

hithink_financials
  thscode:    string  (必填)
  statement:  enum    income|balance|cash|indicators   默认 indicators
  limit:      int     默认 4（最近四期）
  → rows[{ report_period, ... }]

hithink_valuation
  thscodes:   string[] 1..50
  → rows[{ thscode, pe_ttm, pe_mrq, pb_mrq, ps_ttm, pcf_ttm?, ... }]

hithink_special
  kind:  enum  limit_up|limit_down|limit_break|ladder|dragon_tiger|hot_stock|anomaly|skyrocket
  date:  string  YYYY-MM-DD（仅 today-only 类可省，默认今天）
  size:  int    默认 50（池类分页）
  page:  int    默认 1
  → rows

hithink_doctor
  → { keySource, baseUrl, enabledDomains, tools, spillDir,
      probe: { endpoint, code, message, latencyMs } }
```

每个工具的 `description` 不超过 2 行，且写清：**做什么 + 什么时候该用它 + 一个硬约束**（如「单只标的」「窗口≤10年」）。description 是常驻成本，宁短勿长。

### 4.8 `skills/hithink-finance/SKILL.md` — 改造版

从上游 `skills/hithink-finance/SKILL.md` 裁剪，**只保留与插件相关的部分**：

| 上游内容 | 处置 |
| --- | --- |
| 「按意图选 CLI / MCP / REST」三选一路由 | **删**。插件已固定 REST，改叫 `hithink_*` 工具 |
| 大量 `references/api/*.md` 契约镜像 | **删**（约 40 个文件）。工具 schema 已是契约，再放一份就是两处维护 |
| 能力边界、不复述 Key、落盘纪律、不猜后缀 | **保留**（写得对） |
| `npx skills update` 自动更新 | **删**。上游仓库 404，这段现在必然失败且静默 |
| 「安装 CLI」引导 | **删**。改成本插件已内置 |
| 凭据顺序 | **改**成 §4.2 的顺序 |

改造后 skill 约 60–80 行，只写：能做什么 / 不能做什么 / 参数约定 / 失败怎么办 / 什么时候改用 CLI 做批量。

### 4.9 `install.ps1` / `uninstall.ps1`

- 幂等：备份 `package.json` → 写 `link:` 依赖 → bundles 追加（去重）→ 建 junction
- `-Remove`：反序撤销，原样回滚到备份
- **不启动 DSH、不重启 DSH**（运行中改 profile 会被回写覆盖——这是本机踩过的坑）
- 结束时打印「需要重启 DSH 生效」而不是自己动手

---

## 5. 复用清单（哪些开源代码能直接用）

**许可前提**：上游 monorepo 是 **MIT**（`LICENSE` 已核），可以整段搬运，保留版权声明即可。
`@dshtrading/connector-hithink` 是 **PolyForm-Noncommercial-1.0.0**——**不搬代码**，只参考思路。

| 来源 | 文件 | 用法 | 判定 |
| --- | --- | --- | --- |
| CLI | `src/infrastructure/fuyao/client.ts` (377 行) | 请求管道、错误分类、重试循环 | **移植**（去掉 Zod，改 JS） |
| CLI | `src/infrastructure/fuyao/retry.ts` (106 行) | 可重试码集合、`Retry-After` 解析、退避公式 | **直接搬**（纯函数） |
| CLI | `src/infrastructure/fuyao/envelope.ts` (41 行) | 信封契约 | **搬逻辑**，自己写 10 行校验 |
| CLI | `src/infrastructure/credentials/api-key-provider.ts` | 优先级策略 | **搬顺序**，实现简化（不需要 keyring） |
| Python | `python/marketdb/credentials.py` (94 行) | Windows/mac/Linux 凭据路径、拒引号规则 | **照抄规则**（改路径根为 `DSH_HOME`） |
| connector | `lib/rest.js` 的 `normalizeThsCode` | 6 位码推断后缀 | **不搬代码**，自己实现（含北交所段） |
| 文档 | `docs/api/**`（40+ 页） | 参数、字段、业务码 | **作为 schema 的唯一真源** |
| 文档 | `skills/hithink-finance/references/**` | 路由与纪律文本 | **裁剪后**进 skill |
| 工具 | `capabilities.json`（104 条，含 endpoint/paging/window） | 端点表 | **直接消费**（生成端点映射表） |

**明确不复用**：

- 上游 CLI 的 DuckDB 本地库（`src/infrastructure/duckdb/*`、`python/marketdb/*`）——插件不做本地库。
- 上游的 `skills` npm 依赖与 skills 生命周期（`infrastructure/skills/*`）——那是 CLI 为人装技能的逻辑。
- `@deepseek-ai/dsh-mcp-client`——见 §6 决策 2。

---

## 6. 关键设计决策

### 决策 1：不走 CLI，插件纯 REST

- **为什么**：① 本机实测 CLI 带 postinstall 安装卡死十几分钟，需 `--ignore-scripts`；② 每次调用要起 Node 进程，agent 回合延迟叠加；③ CLI 输出是「人看的表格 + 信封」，插件要的是「结构化值 + 落盘句柄」。CLI 仍有价值——**作为人工排障与批量导出的旁路**，写进 skill 的「什么时候改用 CLI」。
- **代价**：上游若改 REST 契约，插件要跟；CLI 会先跟。用 `capabilities.json` diff 做巡检（§11 M4）缓解。

### 决策 2：不用内置 mcp-client 挂官方 MCP

- **为什么**：`@deepseek-ai/dsh-mcp-client` 的 Config **没有工具过滤项**（只有 `transport/serverName/url/headers/timeouts/reconnect/failOnStartupError`，实测读 README + index.js 签名）。6 个服务全挂 = 72 个工具常驻，实测 schema 合计 27 KB，约 **7–10k token/轮次**。
- **但保留逃生门**：想全量时用户自己在 profile patch 加 6 行 mcp-client 即可，skill 里给出现成片段。这是「可选的全量模式」，不是默认路径。

### 决策 3：不 fork `@dshtrading/connector-hithink`

- **为什么**：① 它 `不注册工具`，agent 拿不到可调用入口；② 依附 `@dshtrading/api` 与整套 13+ 包交易生态（含 preset/watchlist 约定），为取数据要拖进整个体系；③ 许可证非商用，改造后能做什么受限；④ README 的 `baseUrl=/openapi/v1` 与实现不一致，说明维护松散。
- **能借的只有思路**：`normalizeThsCode` 的边界处理、错误分类命名。代码不搬。

### 决策 4：默认只开 7 个工具，域级开关

- **为什么**：上下文是长期成本。用户日常问的是「这只股票怎么样」「今天涨停有哪些」，基金/期货/指数是低频。
- **口径**：关掉的域**不注册**（而非注册后拒绝），省下的 token 是实打实的。

### 决策 5：去掉 Zod 响应校验，改「取值 + 缺失给 null」

- **为什么**：上游是活跃演进的（CHANGELOG 到 2026-10-15），硬 schema 会在上游加字段/改类型时让插件假报错，agent 会以为是数据源坏了。**契约校验放在字段级**：只读需要的字段，缺失就是 `null`，并把「字段缺失」计数放进返回的 `meta` 里，便于发现上游变更。

---

## 7. 错误模型

对外只暴露 4 类，每类都带「下一步做什么」：

| 类别 | 触发 | 对外消息要点 |
| --- | --- | --- |
| `AUTH_MISSING` | 1–4 层都没找到 Key | 去 `admin/`（带斜杠）签发；给出可复制的设 Key 命令 |
| `AUTH_DENIED` | 业务码 2001/2003 | Key 有效但无权该能力 → 需要到官网申请权限；**不要重试** |
| `RATE_LIMITED` | 业务码 4001 / HTTP 429 | 已重试 N 次；建议降低频率或改用批量端点 |
| `SYMBOL_INVALID` | thscode 归一化失败 / 业务码 3001 | 先调 `hithink_symbol_search` 消歧 |
| `EMPTY` | 业务码 3002 | 可能非交易日 / today-only / 报告期不存在；**不补 0** |
| `UPSTREAM` | 5xxx / 网络 / 超时 / 信封不合法 | 已重试；给 request_id 便于上报 |

规则：

- **所有对外文本过 `redact()`**（Key 绝不能出现在错误里）。
- 业务码 2003 与 2001 分开表述（一个「没配」一个「没权」，用户动作完全不同）。
- 返回值里带 `request_id`（实测每次响应都有），出问题能对上对方日志。

---

## 8. 上下文预算

| 形态 | 工具数 | 估算常驻 token | 状态 |
| --- | --- | --- | --- |
| 官方 MCP 全量 | 72 | **7–10k** | 不进默认 |
| 本插件默认（core+special+diag） | 7 | **~1.2k** | 默认 |
| 本插件全开 | 11 | **~2.0k** | 用户可选 |
| 精简单域（只 core+diag） | 6 | **~0.9k** | 可选 |

测算方法：`mcp-tools.json` 里 72 个工具的 `name+description+inputSchema` 序列化后 27,052 字节；中文描述按 3 字节/字 ≈ 1 token 折算。**这是估算，不是分词器实测**——M1 落地后用真实 tools 列表复核一次。

Skill 只在被加载时进上下文（约 1k token），无常驻成本。

---

## 9. 验收口径（可执行判据）

每一层都要能**只凭命令**判定通过，不靠「应该没问题」。

| 层 | 判据 | 命令 |
| --- | --- | --- |
| L1 加载 | 插件出现在已安装列表且不报错 | 重启后看设置页插件列表；或 `curl /hithink-finance/status`（可选诊断路由） |
| L2 工具注册 | 工具数与域开关一致 | 会话里问 agent「列出 hithink 工具」；应为 7 |
| L3 缺 Key 行为 | 不崩溃、给 hint | 不设 Key 调 `hithink_quote` → 必须返回 `AUTH_MISSING` + admin 链接 |
| L4 认证 | 有 Key 时成功 | `hithink_quote 600519.SH` → `code=0`，价格合理 |
| L5 业务码 | 假 Key 返回 AUTH_DENIED 而非 UPSTREAM | 塞假 Key 调一次 |
| L6 落盘 | 超阈值结果不塞上下文 | 查 5 年日 K → 返回 `path` + `rows`，正文只有 head |
| L7 归一化 | `600519` / `sh600519` / `贵州茅台` 三态正确 | 前两个成功，第三个报 `SYMBOL_INVALID` 并提示先 search |
| L8 关闭开关 | `enabled:false` 后工具消失 | 改配置 → 重启 → 工具数 0 |
| L9 回滚 | `uninstall.ps1 -Remove` 复原 | 与安装前 `package.json` 逐字节相同 |

**L3/L5 现在就能验（不需要 Key）。L4/L6 必须等 Key。**

---

## 10. 里程碑

| 阶段 | 内容 | 产物 | 验收 |
| --- | --- | --- | --- |
| **M0** fork 与骨架 | fork 到 GitHub、clone 到 `plugin-repos/Financial-API`、建 `plugins/dsh-hithink-finance`、写 package.json + cordis.patch.yml + install.ps1 + `hithink_doctor` | 能装上、能卸载；**注册 1 个工具（doctor）** | L1 + L9 |
| **M1 核心链路** | `config/credentials/thscode/http` + `core.js` 5 工具 + `doctor` | 无 Key 时 L3 通过；有 Key 时 L4 通过 | L3（即时）+ L4（待 Key） |
| **M2 特色与落盘** | `special.js` + `spill.js` | 涨停池/龙虎榜可查；5 年日 K 落盘 | L6 |
| **M3 可选域** | `index.js` / `fund.js` / `futures.js` / `calendar.js` + 域开关 | 全开 11 工具、关掉即消失 | L8 |
| **M4 技能与巡检** | 改造 SKILL.md、加 `scripts/check-contract.mjs`（diff 上游 `capabilities.json` 与本地端点映射） | 技能可加载；端点漂移能被发现 | L2 + 巡检退出码 0 |

**每阶段结束停下汇报**，不闷头往下做。

---

## 11. 风险与回滚

| 风险 | 影响 | 应对 |
| --- | --- | --- |
| 上游 404 永久化 | 无法跟官方修复 | 已 fork 保留快照；日常跟 npm 版本号与镜像 repo 变化 |
| 权限不足（2003） | 部分能力不可用 | 拿到 Key 后逐个 capability 探一遍，产出「本账号可用能力表」；不可用的域直接默认关 |
| 上游改字段 | 解析出 null | `meta.missingFields` 计数 + M4 巡检 |
| 限流（4001） | 批量调用失败 | 插件 `maxRetries=2` 且尊重 `Retry-After`；skill 里写明「全市场用 CLI 批量而不是逐股调」 |
| 插件让 boot 失败 | 整个 profile 起不来 | `apply` 内部**全部 try/catch 降级**：注入失败只 warn，不抛；`failOnStartupError` 语义等价实现 |
| 需要回滚 | —— | `uninstall.ps1 -Remove` 恢复 `package.json` 备份 + 删 junction；工具消失即恢复 |

**不可逆动作**：本方案没有。最坏情况是 profile `package.json` 被改坏——`install.ps1` 强制先备份 `.bak-<时间戳>`。

---

## 12. 开工前必须确认的事

1. **API Key**（唯一硬阻塞）：扫码签发后才能做 L4/L6 验收，以及确定「本账号哪些 capability 有权限」。
2. **默认域是否合适**：我按「core + special + diag」设计，若你主要看基金，就把 `fund: true` 提前到 M1。
3. **是否要 `hithink_doctor` 的 HTTP 诊断路由**：加上有 `/hithink-finance/status` 可 curl，代价是常驻一个路由（不占上下文）。默认**不加**，doctor 工具已够。

---

## 13. 附：端点映射表（M1 直接消费）

来自 `capabilities.json`（104 条，81 个 remote + 23 个 local）。插件只取 remote 里有 window/paging 约束的那些：

| 关键约束 | 端点 |
| --- | --- |
| 单标的、窗口 ≤10 年 | `/api/a-share/prices/historical`、`/api/a-share-index/prices/historical` |
| 单标的、窗口 ≤1 年 | `/api/futures/positions/contract-historical` |
| 单标的、窗口 ≤5 年 | `/api/fund/market/historical`、`/api/fund/performance/indicators-historical` |
| today-only | `/api/a-share/auction/snapshot`、`/api/a-share/special-data/anomaly-analysis-*`、`/api/futures/prices/intraday`、`/api/options/prices/intraday` |
| 分页 offset | `/api/meta/tickers/list`、`/api/a-share/prices/snapshot`（省略 thscodes 时）、`/api/futures/contracts/list`、`/api/options/contracts/list`、`/api/fund/news/article-list` |
| 分页 page/size | `/api/a-share/special-data/limit-*-pool` |
| 分页 json 游标 | `/api/fund/indicators/table` |

这些约束写进对应工具的 description（一行），让 agent 一次就把参数传对。
