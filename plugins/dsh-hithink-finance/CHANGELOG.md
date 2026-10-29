# 更新日志

格式按 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号按语义化版本。

## [未发布]

### 计划

- M1：`lib/http.js`（信封/业务码/重试/超时/响应体上限）、core 域 5 个工具、doctor 的网络探针。
- M2：`hithink_special` + `lib/spill.js`（大结果落盘）。
- M3：index / fund / futures / calendar 四个可选域。
- M4：改造版 `SKILL.md`、`scripts/check-contract.mjs`（契约漂移巡检）。

## [0.1.0] - 2026-10-29

M0：骨架 + 诊断。**唯一可调用的工具是 `hithink_doctor`**，不含任何数据工具、不发网络请求。

### 新增

- 插件骨架：`package.json`（`dsh.bundle.patch`）、`cordis.patch.yml`、`lib/index.js`（`apply` 永不抛错）。
- `lib/config.js`：域级开关（core/special/index/fund/futures/calendar）、数值钳制、`baseUrl` 校验。关闭的域不注册工具。
- `lib/credentials.js`：5 层 Key 解析（config → env → `$DSH_HOME` → `%APPDATA%` → 旧变量）、拒引号、BOM 容错、`redact()`。
- `lib/thscode.js`：`600519` / `sh600519` / `600519.SH` 归一化，含北交所段；**中文名一律拒绝**（不猜交易所）。
- `lib/tools/diag.js`：`hithink_doctor`，报告 Key 来源、已注册工具、域开关、限额；不输出 Key 本身或长度。
- `scripts/profile-link.mjs`：改 profile 清单，保留键序与行尾，剥 BOM，报告被替换的旧依赖。
- `install.ps1`：幂等 junction + 清单改写；DSH 在跑时拒绝执行；`-DryRun` / `-Remove` / `-NodePath`；Windows PowerShell 5.1 与 7 均可运行。
- 文档：`README.md`、`DESIGN.md`、`docs/`（架构、工具、配置、凭据、运维、排障、测试、上游与许可、本次审计）。

### 变更（相对初稿）

- M0 从「注册 0 个工具」改为「注册 `hithink_doctor`」：既无工具又无路由的插件无法证明自己加载成功。
- 移除未使用的 `errorResult()`：M1 用真实错误模型重建，不留空壳。

### 修复（自查，详见 `docs/AUDIT-2026-10-29.md` 第一轮）

- 同一 apply 内重复注册未去重。
- 多个工具注册共享同一个 `output` 对象引用。
- `dshHome` 为空字符串时凭据查找退化为相对路径。
- 代码归一化会静默把 `600 519` 拼成 `600519.SH`。
- `baseUrl` 非法时不退回默认，产生必然失败的请求。
- 清单带 BOM 时解析失败且错误信息误导。
- `install.ps1` 硬性要求 PowerShell 7、且依赖 `node` 必在 PATH。
- 代码归一化的兜底 `→ SZ` 把沪市 ETF/转债/老三板判成深市（`510300` → `510300.SZ`）。
- 认证错误按 `2001`/`2003` 分类，与线上实测（全部 `2003`）不符。

### 修复（独立复核，详见 `docs/AUDIT-2026-10-29.md` 第二轮）

- `install.ps1` 先改清单、后建 junction：任一步失败都会留下半坏的 profile。改为 junction 优先 + 失败回滚。
- `apiKeyEnv` 命中原型链属性名（`constructor`）会抛 TypeError 并被 `apply` 静默吞掉：注册 0 个工具、0 条日志。
- 清单改写不保留 CRLF，也不保留「无尾换行」；无 `dependencies` 的清单卸载后残留 `"dependencies": {}`。
- 数字 `0`/`1` 不当布尔：`enabled: 0` 仍是启用、`fund: 1` 仍是关闭。
- 非字符串入参被报成 `reason: 'empty'`，错误原因错。
- `baseUrl` 接受路径/查询串/userinfo 与非回环的明文 `http`。
- `redact()` 没有生产调用点，文档却声称所有对外文本都过它。
- 兜底读取通用 `API_KEY`，会把别的服务的密钥当 fuyao Key 发出。
- `plannedButNotRegistered` 未减去已注册工具。
- 测试：`register` 载荷未被校验；「不重复注册」的断言实际锁定了重复注册；`%APPDATA%` 层与「无 dependencies」清单没有覆盖。

### 测试

- 48 例，`node:test`，无第三方框架、无网络：`units` 28、`profile-link` 12、`plugin` 8。
