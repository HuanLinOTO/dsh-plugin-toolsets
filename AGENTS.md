# dsh-plugin-toolsets — Agent Guide

## 插件概览

Bundle 形式 DSH 插件：`ctx.toolsets` 服务（类式插件，default-export `ToolsetsService`，服务名 `toolsets`）。其他插件 `inject: ['toolsets']` 注册命名工具组；模型经全局 `get_tools` 元工具按名加载到所在 agent 的 scope。纯 host 半边，无 client UI，无 CSS 管线。

## 关键约定

- **Bundle 形式**：`cordis.patch.yml` insert 一行插件；`package.json` 带 `dsh.bundle.patch`。零源码 patch（`dsh/` checkout 只读）。
- **预构建 `lib/` 策略**：`lib/` 入库（不在 `.gitignore`）；**无** `prepare` 脚本（`@deepseek-ai/*` private peer 在 pnpm git-install 临时目录解析不到）。改源码后必须 `pnpm run build` 重建 `lib/` 再提交。
- **Host-only**：tsdown 单 bundle（entry 仅 `src/index.ts`，dts: true，`clean: true` 后 `lib/` 只有 index.js/index.d.ts）。
- **Peer 集**：`@deepseek-ai/cordis` / `@deepseek-ai/dsh-tools` / `@deepseek-ai/dsh-llm`（全 optional，宿主提供）；`@deepseek-ai/schemastery` 为直接依赖（Config 校验）。
- **测试分层**：`tests/{registry,get-tools,service}.spec.ts` mock `@deepseek-ai/dsh-tools`/`@deepseek-ai/cordis` 边界（快速单元）；`tests/composition.spec.ts` **不 mock**——真实 `new Context()` + SystemPrompt + ToolRuntime + ToolsetsService + `createScope`，走真实 `ctx.tools.execute` 管线。改产品代码后两层都要绿。
- **组合测试夹具要点**（血泪教训）：
  1. scoped context 经**铸造它的插件**的依赖链解析服务——铸造 scope 的插件必须 `inject: ['tools']`（dsh 官方夹具 `mintAgentScope` 模式）；
  2. 管线用 `exec.agent` **对象身份**作 ScopeKey——夹具里 scope key 必须就是 agent 对象本身（`createScope(inner, agent)` 后回填 `agent.ctx = scope.ctx`），镜像 dsh-agent-loop 的 `createScope(loopCtx, this)`。
- **目录工具名保留**：`get_tools`；toolset 名空间 `^[a-z][a-z0-9_-]*$`（≤64 字符）。
- **模型可见文本一律英文**（工具描述、目录、结果 render）。目录描述超过 200 字符截断为 197 + `…`。
- **`this.ctx` tracker 语义**：service 方法经 `ctx.toolsets` 代理调用时 `this.ctx` 重绑为调用方 fiber ctx（注册 effect 归调用插件所有，HMR 自动回收）；service 自有的 `get_tools` 注册/碰撞检查必须用构造器捕获的 `ownCtx`，不能用 `this.ctx`（会被最后一个调用方污染）。
- **devDependencies 的 `link:D:/…` 绝对路径**是本机开发态（dsh checkout 兄弟目录），发布安装不受影响（devDeps 不随包安装）。

## 文件职责

| 文件 | 职责 |
|------|------|
| `src/registry.ts` | `ToolsetDefinition` 形状、`validateToolset`（fail loud）、`renderCatalogDescription` |
| `src/get-tools.ts` | `get_tools` 工具定义（`buildGetToolsTool(deps)`）、execute 分支、`GetToolsResult` + render |
| `src/index.ts` | `ToolsetsService`（`ctx.toolsets`）、目录生命周期、per-agent 激活 |
| `tests/*.spec.ts` | 单元（mock 边界）+ composition（真实模块） |

## 命令

```powershell
pnpm run typecheck   # tsc --noEmit（src/）
pnpm test            # vitest run（30 测试）
pnpm run build       # tsc + tsdown → lib/（单 bundle）
```

## 坑位记录

- tsdown `external` 字段已标记 deprecated（建议 `deps.neverBundle`）——与 dsh-sleep 保持一致暂用旧写法，仅 WARN 不影响产物。
- 组合测试里对激活工具的执行断言必须传 `agent`（即 scope key 对象），无 agent 的执行解析不到 scoped layer（`unknown tool`）。
- `pnpm pack --dry-run` 清单必须只含 `lib/` + `cordis.patch.yml` + `package.json`。
