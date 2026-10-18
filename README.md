<p align="center">
  <a href="https://dshfind.com/zh/plugins/huanlinoto/dsh-plugin-toolsets"><img src="https://dshfind.com/api/card/huanlinoto/dsh-plugin-toolsets?lang=zh" alt="dsh-plugin-toolsets card"></a>
</p>

# dsh-plugin-toolsets

在 ctx 上提供统一的 toolset API：插件注册带"什么时候该用"说明的命名工具集，模型需要时调用全局 `get_tools` 工具按名把整组工具加载进自己所在 agent 的工具列表。

**动机**：DSH 插件注册的工具全部进入全局工具列表，每轮请求都要为所有工具的 schema 付出上下文成本。本插件把成本推迟到"模型确认需要"的那一刻——平时只有一条目录（各 toolset 的名称 + 用途摘要），模型调用 `get_tools('name')` 后整组工具下一轮生效。

## 工作机制

- 插件通过 `ctx.toolsets.register({ name, description, tools })` 注册 toolset（`description` 即"什么时候该用"，模型可见，建议英文）。
- 目录非空时，插件在全局注册唯一的 `get_tools` 元工具，目录嵌入其 description；目录变化（注册/注销）时热重建。
- 模型调用 `get_tools({ toolset: 'name' })` 时，插件把这组工具逐个注册进**发起调用的 agent 自己的 scope layer**（`exec.agent.ctx`）：
  - 下一轮模型请求即可调用（工具列表按请求组装，会随请求头部记录入会话日志）；
  - 仅对该 agent 可见；子 agent 需自行调用 `get_tools`；
  - 随 agent 销毁自动回收，无需善后；
  - 同一 agent 重复调用是幂等 no-op（返回当前工具清单）。
- 注册时严格校验（fail loud）：toolset 名唯一且匹配 `^[a-z][a-z0-9_-]*$`；工具须为完整 `defineTool` 契约（`output: { schema, render }`）；**跨 toolset 工具名全局唯一**；工具名 `get_tools` 保留。
- 激活时若工具名与该 agent 当前可见工具冲突，拒绝注册（遮蔽几乎必是配置错误）。
- 未知的 toolset 名按参数错误处理（`ToolArgsError`，结果里列出全部已知名，模型下一轮自纠）。

## 消费方接入

其他插件声明 `inject: ['toolsets']` 并在 `peerDependencies` 加上 `@huanlin/dsh-plugin-toolsets`：

```ts
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

const androidTap = defineTool({
  name: 'android_tap',
  description: 'Tap a point on the Android screen.',
  parameters: { x: { type: 'integer', required: true }, y: { type: 'integer', required: true } },
  output: { schema: { type: 'json' }, render: () => [] },
  async execute(args) { /* … */ },
})
// …其余工具…

export const name = 'my-android-plugin'
export const inject = ['toolsets']

export function apply(ctx: Context): void {
  ctx.toolsets.register({
    name: 'android',
    description: 'Operate a real Android phone over ADB — tap, swipe, screenshot, UI dump.',
    tools: [androidTap, /* … */],
  })
}
```

模型侧看到的效果（`get_tools` 描述节选）：

```
Toolsets:
- android: Operate a real Android phone over ADB — tap, swipe, screenshot, UI dump. (7 tools)
```

## 开发（本仓库）

```powershell
pnpm install        # 需要本机 dsh checkout 位于 D:/Projects/deepseek-harness/dsh
                    # （devDependencies 以绝对路径 link 到其中的 vendored/workspace 包）
pnpm test           # 单元测试（mock 宿主边界）+ 真实组合测试（真实 cordis + ToolRuntime + SystemPrompt，不 mock）
pnpm run typecheck  # tsc --noEmit（src/）
pnpm run build      # tsc + tsdown → lib/（单 bundle：index.js + index.d.ts）
```

无 `prepare` 脚本、`lib/` 入库（预构建策略）：`@deepseek-ai/*` private peer 无法在 pnpm git-install 的临时 `prepare` 目录解析，`github:` 安装直接使用仓库内 `lib/`。

## 运行

```powershell
dsh plugin --profile <name> add "link:D:/Projects/deepseek-harness/dsh-plugin-toolsets"
# 或 github:huanlinoto/dsh-plugin-toolsets / @huanlin/dsh-plugin-toolsets（npm）
```

安装后**重启 `dsh web`**（人类操作）。注意：本插件自身不提供任何 toolset——装好后工具列表暂时无变化；装载任一 `inject: ['toolsets']` 的消费插件后，`get_tools` 才会出现。

## 检查

```powershell
pnpm test                                        # 30 个测试（27 单元 + 3 真实组合）
pnpm run build                                   # 重建 lib/
pnpm pack --dry-run                              # 清单只含 lib/ + cordis.patch.yml
dsh --profile <name> --dump-config               # 应出现 id: toolsets 的 insert 行
```

## 已知取舍

- **工具前缀缓存**：激活改变工具列表，会打断 provider 的工具前缀缓存——这是按需加载特性的固有代价（以一次缓存失效换取长期上下文节省）。
- **下一轮生效**：`get_tools` 返回后工具下一轮请求才可调用（工具列表按请求固定，所有延迟方案共性）。
- **子 agent 不继承**：激活绑定发起调用的 agent；子 agent 需自行调用 `get_tools`。
- **激活态为内存态**（`WeakMap`，不持久化）：会话重启/agent 替换后激活消失，模型可重新 `get_tools`（幂等）。
- **与 `deferLoading` 正交**：dsh-llm 内建的 `deferLoading`（provider 层延迟声明 + developer 工具添加记录）与本品（注册表层按 agent 惰性物化）是不同机制，可组合但互不替代。
- **保留名**：工具名 `get_tools` 与 toolset 名空间（`^[a-z][a-z0-9_-]*$`）由本插件管理。

## 许可

AGPL-3.0
