# 架构

本文件回答：插件在 DSH 里是怎么活起来的、一个工具调用经过哪些层、失败在哪一层被收口。工具契约见 [TOOLS.md](TOOLS.md)，配置见 [CONFIGURATION.md](CONFIGURATION.md)。

## 1. 运行时模型

DSH 是 Cordis 插件宿主。插件包只声明两样东西：

```json
"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
```

```yaml
# cordis.patch.yml
- insert:
    - id: hithink-finance
      name: dsh-hithink-finance
```

`name` 由 loader 从 profile 的 `node_modules` 解析，命中本包 `package.json` 的 `main`（`lib/index.js`），然后调用默认导出的 `apply(ctx, config)`。除此之外没有注册表、没有入口清单、没有构建步骤——源码即产物。

由此推出三条硬约束：

| 约束 | 原因 | 违反后果 |
| --- | --- | --- |
| `apply()` 绝不能抛 | 同步抛出会让该 loader 条目的 fiber 失败，boot 审计报 `Failed to load plugins`，**整个 Web UI 起不来** | 用户看到 HARNESS 失败页，且不知道是哪个插件 |
| 零运行时依赖 | 第三方插件不能 `import '@deepseek-ai/*'`（那些包在 `app.asar` 里，loader 不给第三方解析） | 加载期 `ERR_MODULE_NOT_FOUND`，同上 |
| 只 inject 一定存在的服务 | 注入一个没人提供的服务会让 fiber 永久 pending，拖住整棵插件树 | 插件「装着但不工作」 |

所以 `apply` 的整体形状是：`try { … 全部逻辑 … } catch {}`，每一次宿主交互再单独 try/catch 降级成一条 warn。

## 2. 模块图

```
lib/index.js            入口：配置 → 凭据 → 选工具 → 注册
├── lib/config.js       归一化 + 域开关 + 数值钳制（纯函数，零 IO）
├── lib/credentials.js  5 层 Key 解析 + redact（只读 2 个文件位置）
└── lib/tools/
    ├── diag.js         hithink_doctor（M0 唯一实现的工具）
    └── render.js       输出渲染 + objectOutput() 工厂

scripts/profile-link.mjs  安装期：改写 profile 清单（不进运行时）
install.ps1               安装期：junction + 调上面的脚本（不进运行时）
```

依赖单向：`index → tools → {config, credentials}`。`tools/*` 不碰 HTTP、不读配置对象以外的环境，因此可以脱离宿主单测。

**为什么 `IMPLEMENTED_TOOLS` 是空数组**：M0 只交付骨架与诊断。域工具在 M1 填进这个数组，`selectTools()` 与注册逻辑不用改一行——这是刻意留的接缝。

## 3. 一次调用的数据流

```
模型发出 tool call
  │  DSH 校验 arguments 符合 parameters schema
  ▼
tools.register 里的 execute(args)
  │  try { tool.execute(deps, args) } catch -> {ok:false, error:{category:'INTERNAL'}}
  ▼
tool.execute（M0 只有 diag）
  │  读 deps.settings / deps.creds，绝不重新读 process.env
  ▼
返回普通对象
  │  output.render(_args, value) -> [{type:'text', text: JSON}]
  ▼
模型看到文本
```

`render` 是唯一的出口：不经过它，工具结果到不了模型。这也是「大结果必须落盘」能统一施行的原因——将来 M2 的 `spill()` 在 `render` 之前把行数/字节数判掉。

## 4. 生命周期与 dispose

```
boot
 ├─ loader 读 cordis.patch.yml
 ├─ 解析 dsh-hithink-finance
 ├─ apply(ctx, config)
 │    ├─ enabled === false ─────────────────► return（一个工具都不注册）
 │    ├─ 缺 cordis.patch.yml ───────────────► warn（包不完整）
 │    ├─ 解析 Key 失败 ─────────────────────► warn 一次（工具仍注册，调用时报错）
 │    └─ ctx.inject(['tools'], scoped => {
 │         注册每个工具；
 │         dispose 挂到 scoped.on('dispose')
 │       })
 └─ 就绪
```

dispose 语义：宿主卸载该 fiber 时，`scoped.on('dispose', dispose)` 让每个工具的注册被撤销。**不共享全局状态**，所以重复 apply 不会串状态（重复注册由 `seen` 集合在单次 apply 内挡住）。

## 5. 失败收口

四层，越靠外越「不能抛」：

| 层 | 收口方式 | 对外表现 |
| --- | --- | --- |
| `apply` | 整体 try/catch | 大不了静默不工作，UI 正常 |
| `ctx.inject` | try/catch + warn | 工具缺失，日志说明原因 |
| `tools.register` | 单个工具 try/catch | 其余工具照常注册 |
| `execute` | try/catch → `{ok:false, error}` | 模型看到结构化错误，可以自己纠正 |

关键设计：**错误是「返回值」不是「异常」**。异常会变成工具故障（模型只看到一句 harness 报错），返回值能带上 `category` / `hint` / `retryable`，模型才知道下一步该干什么。

## 6. 为什么没有 HTTP 层（M0）

M0 刻意不带网络：先把「装得上、能诊断、不污染上下文」这三件与数据无关的事钉死。HTTP 层（`lib/http.js`）在 M1 引入，届时：

- 业务码解析（**不能看 HTTP 状态码**，实测鉴权失败也是 200）
- 重试与 `Retry-After`
- 超时与取消
- 响应体上限

这些都会集中在 `http.js` 一处，`tools/*` 只负责「参数 → 端点 + query」，不关心传输。

## 7. 上下文预算

常驻成本只有工具 schema（`name` + `description` + `parameters`）与插件对系统提示的贡献（本插件为零）。测算与目标见 [CONFIGURATION.md](CONFIGURATION.md#5-上下文预算)。
