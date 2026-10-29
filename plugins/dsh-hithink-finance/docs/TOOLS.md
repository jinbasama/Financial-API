# 工具参考

> **状态说明**：M0 只实现了 `hithink_doctor`。下表「计划中」的工具给出了已经核实过的端点与参数约束（来源：`docs/api/**` 与 CLI 的 `capabilities.json`），但**尚未注册、调用会报「无此工具」**。每条都标了状态，不靠读者猜。

所有工具名以 `hithink_` 开头。参数 schema 是 JSON Schema 子集，由插件在注册时提供给宿主。

---

## 1. 已实现

### `hithink_doctor`

**状态**：M0 可用，**不需要 API Key**。

诊断插件本身：Key 是否找到、从哪来、哪些域开着、注册了哪些工具、有效限额。它同时是「插件真的加载了」的唯一证据——一个既无工具又无路由的插件，症状与「根本没装」完全一样。

**参数**：无（`{}`）。

**返回**（节选真实结构）：

```json
{
  "ok": true,
  "plugin": { "name": "dsh-hithink-finance", "version": "0.1.0", "enabled": true,
              "baseUrl": "https://fuyao.aicubes.cn" },
  "auth": {
    "configured": false,
    "source": "none",
    "credentialFiles": [
      "C:\\Users\\<user>\\.dsh\\hithink-finance\\credentials.env",
      "C:\\Users\\<user>\\AppData\\Roaming\\hithink-finance\\credentials.env"
    ],
    "notes": []
  },
  "tools": { "registered": ["hithink_doctor"], "plannedButNotRegistered": ["hithink_quote", "..."], "count": 1 },
  "domains": { "enabled": ["core", "special"], "all": { "core": true, "fund": false, "...": false } },
  "limits": { "timeoutMs": 15000, "maxRetries": 2, "spillRows": 200, "spillBytes": 65536 },
  "probe": null,
  "note": "No network probe yet (milestone M0). Live verification arrives with the HTTP layer in M1."
}
```

**不变量**：返回里**永远不含 Key 本身**，也不含 Key 长度（长度会缩小猜测空间）。上线前由单测断言。

**读法**：

| 字段 | 含义 |
| --- | --- |
| `auth.configured=false` | 所有数据工具都会返回 `AUTH_MISSING`；按 `credentialFiles` 的第一条去放 Key |
| `auth.source="env:HITHINK_FINANCE_API_KEY"` | 从环境变量拿到；注意 DSH 只在启动时继承环境，改完要重启 |
| `tools.plannedButNotRegistered` 非空 | 正常（M0）；等对应里程碑 |
| `domains.enabled` 缺 `fund` | 基金域没开，去 [CONFIGURATION.md](CONFIGURATION.md) 打开 |

---

## 2. 计划中（M1–M3）

参数与端点均已核对上游契约。状态列决定现在能不能调。

### 2.1 `hithink_symbol_search` — 标的消歧（M1）

`GET /api/meta/tickers/search`

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `q` | string | 是 | 完整 `thscode`、纯代码或中英文名称子串 |
| `asset_type` | string[] | 否 | `a-share`/`a-share-index`/`fund-etf`/`fund-lof`/`fund-otc`/`fund-reits`/`futures`/`options`/`forex` |
| `exchange` | string | 否 | `SSE`/`SZSE`/`BSE`/`CFFEX`/`SHFE`/`INE`/`DCE`/`CZCE`/`GFEX` |
| `limit` | int | 否 | 1–50，默认 10 |

返回行含 `thscode`、名称、资产类型、交易所。**名称一律先走这里**：插件拒绝对中文名猜测交易所（见 `lib/thscode.js`），因为猜错会返回另一家公司的数据。

### 2.2 `hithink_quote` — 行情快照（M1）

`GET /api/a-share/prices/snapshot?thscodes=a,b,c`

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `thscodes` | string[] | 是 | 1–50 只；接受 `600519` / `sh600519` / `600519.SH`，由插件归一化 |

返回 `thscode`、`last_price`、`price_change`、`price_change_ratio_pct`、开高低、`prev_price`、`volume`、`turnover`，外加 `timestamp`。

**注意**：快照**不返回中文名**。要展示名字，先 `hithink_symbol_search` 一次并入结果，不要每只都查。

### 2.3 `hithink_history` — 历史日 K（M1）

`GET /api/a-share/prices/historical`

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `thscode` | string | 是 | **仅单只**，不接受逗号 |
| `start` / `end` | string | 是 | `YYYY-MM-DD` 或毫秒时间戳 |
| `adjust` | enum | 否 | `none`/`forward`（默认）/`backward` |

**硬约束**：`interval` 当前只支持 `1d`；`end - start` **不得超过 10 年**（上游越界报 `code=1003`，插件在本地先拒绝，省一次往返）。

**返回**：`{ rows, firstDate, lastDate, adjust, path? }`。超过 `spillRows`/`spillBytes` 时正文只给 head 与文件路径。

### 2.4 `hithink_financials` — 财报（M1）

`GET /api/a-share/financials/{income-statements|balance-sheets|cash-flow-statements|indicators}`

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `thscode` | string | 是 | 单只 |
| `statement` | enum | 是 | `income`/`balance`/`cash`/`indicators` |
| `limit` | int | 否 | 最近 N 期，默认 4 |

返回行的报告期字段是 `report_period`。分析时**必须带上报告期**，不要跨期比较而不声明。

### 2.5 `hithink_valuation` — 估值快照（M1）

`GET /api/a-share/valuations/snapshot?thscodes=...`

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `thscodes` | string[] | 是 | 1–50 只 |

返回 `pe_ttm`、`pe_mrq`、`pb_mrq`、`ps_ttm`、`pcf_ttm` 等。**保留 null 与负数**（亏损公司的 PE 就是负的，不能抹平）。

### 2.6 `hithink_special` — 特色数据（M2）

`GET /api/a-share/special-data/*`

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `kind` | enum | 是 | `limit_up`/`limit_down`/`limit_break`/`ladder`/`dragon_tiger`/`hot_stock`/`anomaly`/`skyrocket` |
| `date` | string | 否 | `YYYY-MM-DD`；`anomaly` 类为 today-only |
| `page` / `size` | int | 否 | 池类分页（`limit-*-pool`），默认 1/50 |

`kind → 端点` 映射：`limit_up→limit-up-pool`、`limit_down→limit-down-pool`、`limit_break→limit-break-pool`、`ladder→limit-up-ladder`、`dragon_tiger→dragon-tiger-list`、`hot_stock→hot-stock-list`、`anomaly→anomaly-analysis-list`、`skyrocket→skyrocket-list`。

### 2.7 `hithink_index` — 指数与板块（M3）

| `action` | 端点 | 备注 |
| --- | --- | --- |
| `catalog` | `/api/a-share-index/catalog/ths-index-list` | 指数/板块目录 |
| `constituents` | `/api/a-share-index/constituents/ths-stock-list` | 成分股 |
| `snapshot` | `/api/a-share-index/prices/snapshot` | 快照 |
| `history` | `/api/a-share-index/prices/historical` | 单只、窗口 ≤10 年 |

### 2.8 `hithink_fund` — 公募基金（M3）

`GET /api/fund/*`，`action` 枚举（12 值）：`profile`/`nav`/`returns`/`holdings`/`holders`/`managers`/`company`/`snapshot`/`history`/`indicators`/`drawdowns`/`quota`。

窗口约束：`history` 与 `indicators-history` ≤5 年；`indicators-table` 用 json 游标分页；`news` 用 offset 分页。

### 2.9 `hithink_futures` — 公开期货（M3）

`GET /api/futures/*`，`action` 枚举（8 值）：`varieties`/`contracts`/`contract`/`main`/`daily`/`intraday`/`positions`/`basis`。

窗口约束：`positions/contract-historical` ≤1 年；`intraday` 为 today-only。

### 2.10 `hithink_calendar` — 交易日历（M3）

`GET /api/a-share/calendar/trading-days`，窗口 1 年。用途：判断「今天是否有数据」「这一天是不是交易日」，避免把节假日当空数据。

---

## 3. 明确没有的能力

以下不是「还没做」，是上游**不通过公开 API 提供**。工具不会假装有，也不会用近似值顶替。

| 能力 | 上游口径 |
| --- | --- |
| 分钟 K / tick / Level-2 | 不提供 |
| 港股 / 美股 | 不提供 |
| 宏观数据、新闻公告原文、研报原文 | 不提供 |
| 基金申赎、下单交易 | 不提供 |
| 主力资金流向、高频动向 | **端内专用**（`capital-flow.md` 明写「当前不作为端外接入入口」） |
| 投资建议 | 不提供，也不产出 |

数据缺失时返回 `EMPTY`（业务码 3002），**不补 0、不返回模拟数据**。

---

## 4. 窗口与分页速查

| 约束 | 端点 |
| --- | --- |
| 单只、≤10 年 | `/api/a-share/prices/historical`、`/api/a-share-index/prices/historical` |
| 单只、≤5 年 | `/api/fund/market/historical`、`/api/fund/performance/indicators-historical` |
| 单只、≤1 年 | `/api/futures/positions/contract-historical` |
| today-only | `/api/a-share/auction/snapshot`、`/api/a-share/special-data/anomaly-analysis-*`、`/api/futures/prices/intraday`、`/api/options/prices/intraday` |
| offset 分页 | `/api/meta/tickers/list`、`/api/a-share/prices/snapshot`（省略 `thscodes` 时）、`/api/futures/contracts/list`、`/api/options/contracts/list`、`/api/fund/news/article-list` |
| page/size 分页 | `/api/a-share/special-data/limit-*-pool` |
| json 游标 | `/api/fund/indicators/table` |

这些约束会写进各工具的 `description`（一行），让模型一次把参数传对，而不是靠试错。

---

## 5. 错误返回形状

所有工具失败时返回对象，不抛异常：

```json
{ "ok": false,
  "error": { "category": "AUTH_DENIED", "message": "...", "hint": "...",
             "retryable": false, "requestId": "..." } }
```

`category` 取值与处置见 [TROUBLESHOOTING.md](TROUBLESHOOTING.md)。`requestId` 来自上游信封，报障时能对上对方日志。
