# 上游、复用与许可证

## 1. 来源

| 项 | 值 |
| --- | --- |
| 本仓库 | `jinbasama/Financial-API`（fork） |
| fork 上游 | `20170922/Financial-API`，MIT，2026-10-08 建立，最后推送 2026-10-15 |
| 原始出处 | `HiThink-Tech/Financial-API` —— **2026-10-29 实测 404**（组织账号不存在） |
| npm 官方包 | `@hithink-tech/hithink-finance-cli@0.1.13`（MIT，最后发布 2026-09-22） |
| 数据源 | 同花顺扶摇 `https://fuyao.aicubes.cn`（**不是 iFinD**） |

镜像仓库不是 GitHub fork（`fork: false`），是重新上传。它保留完整 git 历史到 2026-10-15，内容与 npm 0.1.13 对齐。

## 2. 许可证

- 上游 monorepo：**MIT**（`LICENSE`）。
- 本插件：**MIT**，继承上游。
- **`@dshtrading/connector-hithink` 是 PolyForm-Noncommercial-1.0.0**。本插件**没有使用它的任何代码**，只在设计上参考了两个思路：`thscode` 的交易所后缀推断规则、错误分类的命名习惯。这类「公有领域常识 + 命名习惯」不构成代码复制。

## 3. 复用了什么（逐文件）

| 上游文件 | 行数 | 怎么用 | 本仓库落点 |
| --- | --- | --- | --- |
| `hithink-finance-cli/src/infrastructure/fuyao/client.ts` | 377 | 请求管道、业务码分段、错误分类、重试循环 | M1 `lib/http.js`（去 Zod，改 JS） |
| `.../fuyao/retry.ts` | 106 | 可重试码集合、`Retry-After` 解析、退避公式 | M1 直接搬（纯函数） |
| `.../fuyao/envelope.ts` | 41 | 信封契约 | M1，约 10 行手写校验 |
| `.../credentials/api-key-provider.ts` | 214 | Key 优先级策略 | **M0 已搬顺序**（`lib/credentials.js`），不搬 keyring |
| `python/marketdb/credentials.py` | 94 | 平台凭据路径、拒引号 | **M0 已照抄规则**（路径根改为 `DSH_HOME`） |
| `docs/api/**`（40+ 页） | — | 参数、字段、业务码 | schema 真源；[TOOLS.md](TOOLS.md) 的端点表 |
| `skills/hithink-finance/SKILL.md` | 86 | 路由与纪律 | M4 裁剪版 |
| CLI `capabilities.json` | 104 条 | 端点 + paging/window 元数据 | [TOOLS.md](TOOLS.md) 的约束表、M4 巡检基线 |

**只搬「规则」不搬「实现」的地方**：`normalizeThsCode`。本仓库的 `lib/thscode.js` 是自己写的（多了「拒中文名」「拒内部空格」两条上游没有的行为），因为这些边界是本插件的核心安全约束。

## 4. 刻意不复用

| 不复用 | 原因 |
| --- | --- |
| CLI 的 DuckDB 本地库（`infrastructure/duckdb/*`、`python/marketdb/*`） | 插件不做本地库：写盘副作用、原生模块依赖、与 agent 回合无关 |
| CLI 的 skills 生命周期（`infrastructure/skills/*`） | 那是「帮人装技能」的逻辑，DSH 自己管技能 |
| `@deepseek-ai/dsh-mcp-client` 挂官方 MCP | 无法过滤工具，72 个全量约 7–10k token/轮次 |
| Python SDK / toolkit | 与 DSH 无关，留在 fork 里供参考 |
| Zod 运行时校验 | 上游契约在演进，硬 schema 会把「上游加字段」误报成数据源故障 |

## 5. 同步上游

镜像仓库可能继续更新；官方若恢复，优先跟官方。

```bash
# 一次性：登记两个远端
git remote add mirror https://github.com/20170922/Financial-API.git
# 若官方恢复：git remote add upstream https://github.com/HiThink-Tech/Financial-API.git

git fetch mirror
git log --oneline HEAD..mirror/main        # 看有什么新提交
git merge --ff-only mirror/main            # 只快进，不产生 merge commit
```

**只快进的规矩**：我们在 `plugins/` 下新增目录，不碰上游文件，所以理论上永远可以 `--ff-only`。一旦需要冲突解决，说明有人改了上游文件——那是要停下来的信号。

合并后必做：

```bash
npm test                                    # 本地测试
cd plugins/dsh-hithink-finance && npm test
```

## 6. 契约漂移巡检（M4）

上游改字段不会通知我们。计划中的 `scripts/check-contract.mjs`：

1. 读本地端点映射表（`lib/tools/endpoints.json`）。
2. 跑 `hithink-finance capabilities --format json`（官方 CLI，需另装）。
3. diff：本地用到但上游没了的端点 → 报红；上游新增且属于已开域 → 提示。

退出码非 0 即漂移。**没跑通就等于没检查**，所以它必须能在 CI 或本地一条命令跑完。

## 7. 本仓库与上游的边界

```
Financial-API/
├── docs/ python/ skills/ hithink-finance-cli/ examples/ scripts/   ← 上游，不改
└── plugins/dsh-hithink-finance/                                    ← 本仓库新增，唯一改动区
```

`AGENTS.md`（上游）要求「不要在 Python、CLI、examples 或其他 README 中复制上游参数表」。本插件的 [TOOLS.md](TOOLS.md) 有端点与参数表，属于**插件自己的消费契约**（工具 schema 就是它），不是上游文档的复制品；字段全集仍以上游 `docs/api/` 为准，文档里也这么写了。
