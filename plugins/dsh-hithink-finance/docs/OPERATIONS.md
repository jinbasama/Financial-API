# 运维：安装、验收、回滚

本文件只讲「怎么安全地装上并证明它真的好了」。工具契约见 [TOOLS.md](TOOLS.md)。

## 1. 安装

**前提**：DSH 已关闭。运行中改 profile 清单会被实例回写覆盖——本机实测过把一整份配置覆盖成只剩几条的后果，所以 `install.ps1` 会检测 DSH 进程并拒绝执行。

```powershell
cd <repo>\plugins\dsh-hithink-finance
.\install.ps1 -DryRun      # 先看要改什么
.\install.ps1              # 真装
```

`install.ps1` 只做三件事：

1. `dependencies["dsh-hithink-finance"] = "link:<包根>"`
2. `dsh.profile.bundles += "dsh-hithink-finance"`
3. `node_modules\dsh-hithink-finance` → 包根的 **junction**

不做的事：不装依赖（本包零依赖）、不连网、不启动/停止 DSH、不改 `cordis.patch.yml`。

**参数**：

| 参数 | 说明 |
| --- | --- |
| `-Remove` | 反向：删 junction → 去掉依赖与 bundles 条目 |
| `-DryRun` | 只打印计划 |
| `-Profile <name>` | 默认 `desktop` |
| `-NodePath <node.exe>` | node 不在 PATH 时指定 |
| `-Force` | 明知 DSH 在跑也要改（不建议） |

**node 要求 ≥ 22.12**。脚本用 node 改 JSON 而不是 PowerShell，是因为 `JSON.stringify` 能保留键序，而 PowerShell 的 JSON 往返会重排并踩编码坑。node 查找顺序：`-NodePath` → `$env:DSH_NODE` → PATH → `%ProgramFiles%\nodejs` → `%LOCALAPPDATA%\Programs\nodejs`。

**兼容性**：`install.ps1` 是纯 ASCII，可在 Windows PowerShell 5.1 与 PowerShell 7 下运行（两种都实测过 `-DryRun`）。

## 2. 验收分级

每级都能**只凭命令**判定，不靠「应该没问题」。

| 级 | 判什么 | 怎么判 | 现在能否验 |
| --- | --- | --- | --- |
| L1 | 插件加载了 | 重启后调 `hithink_doctor`，能返回 JSON | 能（需重启） |
| L2 | 工具数与域开关一致 | `hithink_doctor` 的 `tools.registered` / `domains.enabled` | 能 |
| L3 | 缺 Key 不崩、给指引 | 不设 Key 调任一数据工具 → `AUTH_MISSING` + admin 链接 | 能（M1 起） |
| L4 | 有 Key 能取数 | `hithink_quote` 返回合理价格 | **待 Key** |
| L5 | 假 Key 归入 AUTH_DENIED | 塞假 Key 调一次 | 能（M1 起） |
| L6 | 大结果落盘 | 查 5 年日 K → 返回 `path` + `rows`，正文只有 head | 待 M2 |
| L7 | 代码归一化三态 | `600519` / `sh600519` 成功，`贵州茅台` 报 `SYMBOL_INVALID` | 能（M1 起） |
| L8 | 关闭开关后工具消失 | `enabled:false` → 重启 → 工具不再出现 | 能 |
| L9 | 能干净回滚 | `install.ps1 -Remove` 后清单回到安装前 | 能 |

**安装期可判的两条**（不需要重启）：

```powershell
# 清单是否指向本包（退出码 0 = 是）
node scripts\profile-link.mjs --action check --profile desktop --name dsh-hithink-finance

# 单元与集成测试（35 例，不联网）
npm test
```

## 3. 升级

```powershell
# 关 DSH
cd <repo>
git -c http.sslBackend=openssl pull --ff-only        # 上游契约更新
cd plugins\dsh-hithink-finance
.\install.ps1                                        # 幂等；清单未变则不写文件、不产生新备份
# 开 DSH
```

插件源码改完不需要重新 link（junction 已经指过去），**但需要重启 DSH**：ESM 模块缓存不会因为文件变了就失效。

## 4. 回滚

**按程度从轻到重**：

| 想要 | 做法 | 结果 |
| --- | --- | --- |
| 临时停用 | patch 里 `enabled: false` → 重启 | 工具消失，包仍在 |
| 完整卸载 | `.\install.ps1 -Remove` → 重启 | 依赖与 bundle 条目消失，junction 删除 |
| 回到安装前 | 用 `package.json.bak-hithink-<时间戳>` 覆盖回 profile 清单 | 逐字节还原 |

备份文件在 profile 目录，每次实际写入才产生一个。确认无事可删。

**失败面**：最坏情况是 profile 清单被改坏导致 boot 失败。此时 DSH 会从 `bundles` 里自动移除加载失败的包（依赖仍留着），表现为「插件路由 404 / 功能整块消失」。恢复：把包名加回 `bundles` 数组，热加载即可，无需重装。

## 5. 重启语义

插件代码、配置、凭据**都只在 `apply` 时读一次**。因此：

| 改了什么 | 要重启吗 |
| --- | --- |
| `lib/**` 源码 | 是 |
| `cordis.patch.yml` 的 `config` | 是 |
| 环境变量 / 凭据文件 | 是 |
| `install.ps1` 的依赖与 bundles | 是（且建议关着 DSH 装） |

DSH 桌面版的 Web 端口每次启动都变，所以不要记端口；用启动后窗口里的 URL。

## 6. 卸载干净了吗

三条都要过：

```powershell
# 1. 清单里没有残留
node -e "const p=require(process.env.DSH_HOME+'/profiles/desktop/package.json'); console.log(p.dependencies['dsh-hithink-finance'] ?? 'gone', p.dsh.profile.bundles.includes('dsh-hithink-finance'))"

# 2. junction 已删
Test-Path "$env:DSH_HOME\profiles\desktop\node_modules\dsh-hithink-finance"   # 期望 False

# 3. 重启后工具列表里没有 hithink_*
```

**不会**被删的东西：`$DSH_HOME\hithink-finance\credentials.env`（凭据是你自己的，插件不碰）、备份文件、仓库本身。要清就自己删——插件不替你做不可逆删除。
