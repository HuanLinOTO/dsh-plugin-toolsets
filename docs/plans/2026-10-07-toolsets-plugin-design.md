# dsh-plugin-toolsets 设计文档

> 日期：2026-10-07 · 状态：已获用户确认
>
> 在 ctx 上提供统一的 toolset API：插件注册带"什么时候该用"说明的工具集，
> 模型需要时调用 `get_tools('toolset_name')` 按需获取这一系列工具。

## 背景与目标

DSH 插件注册的工具全部进入全局工具列表，每个 toolset 的全部 schema 每轮请求都在场，消耗上下文。目标：工具延迟物化——模型只看到一个目录（各 toolset 名称 + 用途摘要），确认需要时一次调用取回整组工具。

**已确认的两个设计分叉：**

1. **目录呈现**：目录动态嵌入 `get_tools` 工具的 description（目录变化时热重注册）；不做无参列目录调用，不进 system prompt 章节。
2. **激活粒度**：每个 agent 独立。`get_tools` 把工具注册进发起调用 agent 自己的 scope layer；子 agent 需自行调用。

## 方案选择

**采用：调用时按 agent 惰性注册（`exec.agent.ctx.tools.register()`）。**

DSH scope 机制原生语义：scoped 注册只对该 agent 可见、随 agent dispose 自动回收、`wireSchemas(scope)` 每次请求现算所以下一轮请求自动生效。`browser-use-runtime` 已有运行期改 per-agent 工具可见性的同款先例。

否决的替代：
- 全局注册 + 每 agent `restrict()` 遮罩：注册与 agent 创建时序竞态、全局注册表污染、遮罩状态分散。
- dispatcher 间接转发：破坏 DSH 工具契约（绕开 schema 校验/执行管线）。

## 组件设计

### 1. 服务（类式插件，提供 `ctx.toolsets`）

- 插件：`dsh-plugin-toolsets`，包名 `@huanlin/dsh-plugin-toolsets`，host-only。
- 类式（`extends Service`，`super(ctx, 'toolsets')`）——对外提供 service 的规范形态。
- `declare module '@deepseek-ai/cordis'` 合并 `Context.toolsets` 类型；消费方 peerDependencies 声明本包。
- `static inject = ['tools']`；`static Config = z.object({})`（v1 无部署可变项）。

```ts
ctx.toolsets.register({
  name: 'android',            // /^[a-z][a-z0-9_-]*$/，注册表内唯一
  description: 'Use when …',  // "什么时候该用"，模型可见，英文
  tools: [ /* ToolDefinition[]（完整 defineTool 契约） */ ],
}): () => void                // effect disposer
```

### 2. 目录与 `get_tools` 工具

- toolset 注册/注销驱动 `get_tools` 的注册生命周期：目录从空变非空时注册，变回空时回收，每次目录变化 dispose+重注册（description 热刷新）。
- 描述格式（模型可见，英文）：

```
On-demand toolsets. Call with {"toolset": "<name>"} to load that toolset's
tools into your tool list (usable from your next turn, for the rest of the session).

Toolsets:
- android: Automate a real Android phone over ADB … (7 tools)
```

- 参数：`toolset: string`（必填）。

### 3. 激活语义（execute）

1. `exec.agent` 缺失 → throw（基础设施错误）。
2. 未知 toolset 名 → 报错并列出全部已知名（模型下一轮自纠）。
3. 幂等：`WeakMap<Agent, Set<toolsetName>>`；重复调用返回 `alreadyActive: true`，不重复注册。
4. 碰撞检查：激活前查该 agent 当前可见 schema（`ctx.tools.schemas(agent)`），已有同名工具 → fail loud（遮蔽几乎必是配置错误）。
5. 逐个 `exec.agent.ctx.tools.register(tool)`；注册落 agent 自己的 layer，随 agent 销毁自动回收，无需善后。
6. 返回规范 JSON（C4）：

```json
{ "toolset": "android", "description": "…", "alreadyActive": false,
  "tools": [{ "name": "android_tap", "description": "…" }] }
```

render 为纯投影。

### 4. 注册时校验（fail loud，最早可解点）

- toolset 名格式 + 唯一性；description 非空字符串；tools 非空数组。
- 每个 tool：`output: { schema, render }` 形状（镜像 `tools.register` 检查）+ `assertSupportedJsonSchema`（`@deepseek-ai/dsh-tools` 已导出）；toolset 内工具名唯一。
- **跨 toolset 工具名全局唯一**：两个 toolset 含同名工具 → 注册时即抛，不等激活时撞。

### 5. 工程结构

```
dsh-plugin-toolsets/
├── src/index.ts        # ToolsetService（类插件）
├── src/registry.ts     # 校验 + 目录渲染（纯函数）
├── src/get-tools.ts    # get_tools 定义 + 激活逻辑
├── src/types.d.ts      # ambient peer 类型（同 dsh-sleep）
├── tests/registry.spec.ts
├── tests/get-tools.spec.ts
├── tests/service.spec.ts
├── cordis.patch.yml / package.json / tsconfig.json / tsdown.config.ts / vitest.config.ts
└── README.md / AGENTS.md
```

- 预构建 `lib/` 策略（`@deepseek-ai/*` private peer；无 `prepare`；`lib/` 不进 `.gitignore`）。
- peerDeps：`@deepseek-ai/cordis`、`@deepseek-ai/dsh-tools`、`@deepseek-ai/dsh-llm`、`@deepseek-ai/schemastery`（按实际用到）。

## 测试计划

Unit（mock ctx 边界，同 dsh-sleep 模式）：

- 注册校验：名格式/唯一、description、tools 形状、跨 toolset 名冲突。
- 目录生命周期：首个注册出现 `get_tools`、目录变化热重注册、清空回收。
- 激活：正常注册进 agent ctx、幂等、未知名、agent 缺失、可见工具碰撞拒绝、disposer 回收（HMR 安全）。

真实组合 preflight：`dsh plugin --profile web add link:` + 重启 + 验证。

## 已知取舍（写入 README）

- 激活后工具列表变化打断 provider 工具前缀缓存——这是按需加载特性的固有代价。
- 工具激活后下一轮请求才可调用（工具列表按请求固定）。
- 子 agent 不继承父 agent 的激活，需自行调用 `get_tools`。
- 激活状态在内存（WeakMap），会话重启后消失，模型可重新 `get_tools`（幂等）。
