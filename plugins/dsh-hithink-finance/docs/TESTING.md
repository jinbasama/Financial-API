# 测试

## 1. 怎么跑

```bash
npm test           # 三个文件全跑
npm run test:units # 纯函数：配置、凭据、代码归一化
npm run test:link  # profile 清单改写（含 BOM、幂等、逐字节回滚）
npm run test:plugin# 插件入口：注册、永不抛错、脱敏
```

只用 `node:test`，**无第三方测试框架、无网络、无临时全局状态**。

### 一个必须知道的坑

**不要用 `node --test test/`**。

这个命令会为每个测试文件 spawn 子进程，而本机沙箱禁止程序创建命名管道：

```
Error: spawn EPERM
```

所以 `npm test` 是逐个文件直接执行（`node test/x.test.mjs`）。直接执行时 `node:test` 会在进程内注册并跑完，不需要子进程。

判据是**各自退出码为 0**，不是看输出里有没有 `pass`：

```powershell
node test/units.test.mjs; $LASTEXITCODE
```

## 2. 覆盖了什么

| 文件 | 例数 | 覆盖 |
| --- | --- | --- |
| `units.test.mjs` | 22 | 配置默认值/钳制/域开关/baseUrl 校验；代码归一化（沪/深/北、前缀式、拒中文名、拒内部空格、**拒基金/债券/三板代码**、显式后缀放行）；凭据 5 层顺序、拒引号、BOM、空 `dshHome` 不退化；`redact` |
| `profile-link.test.mjs` | 8 | `add` 写入形状；幂等（二次运行不写文件、不产生新备份）；`remove` 后**逐字节等于原文件**；报告被替换的旧版本；`check` 退出码；BOM 清单；缺清单时报错；`dependencies` 结构异常时修复 |
| `plugin.test.mjs` | 7 | 只注册 doctor；有 Key 时零告警；`enabled:false` 注册为空；四种恶意上下文下不抛；重复 apply 不重复注册同 id；`selectTools` 的域语义；doctor 输出**不含 Key** |

合计 37 例。全部在重启 DSH 之前就能跑。

### 测试的环境隔离

所有 `apply()` 测试都跑在 `withCleanEnv()` 里：把 `DSH_HOME` 指到临时目录、清空 `APPDATA`、删掉 `HITHINK_FINANCE_API_KEY`/`FUYAO_TOKEN`/`API_KEY`，结束后恢复。

**为什么**：否则开发机上只要真的配了 Key，`auth.configured` 就会是 true，「缺 Key 告警」那条测试立刻假失败。同类的还有 `%APPDATA%\hithink-finance\credentials.env`——它是官方 CLI 的默认位置，装了 CLI 就有。

## 3. 没覆盖什么（诚实清单）

| 没测 | 为什么 | 什么时候补 |
| --- | --- | --- |
| 真实 HTTP 请求 | M0 没有 HTTP 层 | M1：用注入的 `fetch` 桩测业务码分支 |
| DSH 实际加载 | 要重启宿主 | 每次安装后手工 L1 |
| junction 在真实 profile 上的创建 | 会改用户环境 | `-DryRun` + 临时目录里的清单测试已覆盖逻辑 |
| Windows 5.1 下的完整安装 | 只验了 `-DryRun` | 第一次真装时验证 |
| 大结果落盘 | M2 | M2 |

**单测通过 ≠ 线上可用**。离线测试只证明「逻辑与契约一致」，真实可用性只能由一次带授权的请求证明（L4）。

## 4. 真实验收流程

装好后按 [OPERATIONS.md](OPERATIONS.md#2-验收分级) 的 L1–L9 走。M0 阶段实际能走到 L1/L2/L9：

```
1. 装 → 重启 → 调 hithink_doctor            → L1 过：说明 loader 认了、apply 跑完了
2. 看 domains.enabled 与 tools.registered    → L2 过：说明配置生效
3. install.ps1 -Remove → 比对清单            → L9 过：说明能回滚
```

L3 起需要 M1；L4 还需要 Key。

## 5. 加测试的规矩

- **一个测试只断言一件事**，失败信息要能直接说明哪儿坏了。
- **回归测试必须带注释**写清「为什么加」——本仓库的 `units.test.mjs` 末尾有一节 `regressions found during the M0 audit`，每条都注明是哪个缺陷。
- 不引入测试框架，不 mock 整个 fs；需要隔离就传参数（`dshHome`、`env`、`fetch`）。
- 断言用 `node:assert/strict`。
- 涉及密钥的测试，最后必须断言**输出里不含密钥**。

## 6. 提交前检查

```bash
npm run check   # 七个文件的语法检查
npm test        # 37 例
```

两个命令退出码都为 0 才算过。`npm run check` 覆盖 `lib/**` 与 `scripts/profile-link.mjs`；`install.ps1` 不进 node 检查，靠 `-DryRun` 实测。
