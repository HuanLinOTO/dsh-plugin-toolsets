# dsh-plugin-toolsets 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个 DSH 插件，在 ctx 上提供统一的 `ctx.toolsets` 服务：插件注册带"什么时候该用"说明的工具集，模型通过调用全局 `get_tools` 工具按名加载整组工具到自己所在 agent 的工具列表。

**Architecture:** 类式 Cordis 插件（`extends Service`，服务名 `toolsets`）维护 toolset 注册表。目录非空时在全局注册一个 `get_tools` 元工具（目录嵌入其 description，目录变化时 dispose+重注册）；`get_tools` 执行时把工具逐个注册进 `exec.agent.ctx`（发起调用 agent 自己的 scope layer），下一轮请求生效，随 agent 销毁自动回收。

**Tech Stack:** TypeScript (ESM, NodeNext)、Cordis 4（vendored peer）、`@deepseek-ai/dsh-tools`（defineTool/ToolDefinition/ToolArgsError/assertSupportedJsonSchema）、`@deepseek-ai/schemastery`（Config）、vitest、tsdown。

**Spec:** `docs/plans/2026-10-07-toolsets-plugin-design.md`（本目录，已获用户确认；本计划从 spec 出发，执行者需同时阅读两者）

## Global Constraints

- 零源码 patch：不修改 `D:\Projects\deepseek-harness\dsh\` 内任何文件（整目录只读）。
- 插件目录：`D:\Projects\deepseek-harness\dsh-plugin-toolsets\`（独立 git 仓库，已 init）。
- 包名 `@huanlin/dsh-plugin-toolsets`，仓库名 `dsh-plugin-toolsets`（SOP 命名强制）。
- 预构建 `lib/` 策略：`lib/` 不进 `.gitignore`；**无** `prepare` 脚本（`@deepseek-ai/*` private peer 无法在 pnpm git-install 临时目录拉取）。
- 禁止启动 `dsh web`（人类操作）；agent 只做 CLI 级安装与 dump-config 验证。
- ESM only：`"type": "module"`，相对导入带 `.js` 后缀。
- peerDependencies：`@deepseek-ai/cordis ^4.0.1`、`@deepseek-ai/dsh-tools ^0.2.0-rc.1`、`@deepseek-ai/dsh-llm ^0.2.0-rc.1`（全部 optional）；直接依赖 `@deepseek-ai/schemastery ^3.18.4`。
- devDependencies 本机链接（绝对路径，仅开发期；不影响发布安装）：cordis→`D:/Projects/deepseek-harness/dsh/vendor/cordis`、dsh-tools→`D:/Projects/deepseek-harness/dsh/packages/core/tools`、dsh-llm→`D:/Projects/deepseek-harness/dsh/packages/llm/llm`、dsh-system-prompt→`D:/Projects/deepseek-harness/dsh/packages/core/system-prompt`、dsh-scope→`D:/Projects/deepseek-harness/dsh/packages/core/scope`。
- 模型可见文本（工具描述、目录、结果 render）一律英文。
- 工具契约：execute 返回规范 JSON 值（C4）；render 为纯投影（C9）；未知 toolset 名是参数错误 → `ToolArgsError`；agent 缺失/名字碰撞是基础设施/配置错误 → throw（C5）。
- 每个 task 结束必须 `git commit`（在本插件目录内）。

---

### Task 1: 仓库脚手架 + `validateToolset`

**Files:**
- Create: `package.json`
- Create: `cordis.patch.yml`
- Create: `tsconfig.json`
- Create: `tsdown.config.ts`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `src/registry.ts`
- Create: `tests/registry.spec.ts`

**Interfaces:**
- Consumes: `@deepseek-ai/dsh-tools` 的 `ToolDefinition`（类型）与 `assertSupportedJsonSchema`（运行时）。
- Produces:
  - `interface ToolsetDefinition { readonly name: string; readonly description: string; readonly tools: readonly ToolDefinition[] }`
  - `const TOOLSET_NAME_PATTERN: RegExp`（`/^[a-z][a-z0-9_-]*$/`）
  - `const CATALOG_TOOL_NAME = 'get_tools'`
  - `function validateToolset(toolset: ToolsetDefinition, existing: Iterable<ToolsetDefinition>): void`（非法即 throw）

- [ ] **Step 1: 写配置文件**

`package.json`：

```json
{
  "name": "@huanlin/dsh-plugin-toolsets",
  "version": "0.1.0",
  "publishConfig": { "access": "public" },
  "keywords": ["dsh-plugin"],
  "description": "DSH plugin exposing a unified ctx.toolsets API: plugins register named toolsets with when-to-use descriptions; the model loads one on demand via the get_tools tool.",
  "type": "module",
  "license": "AGPL-3.0",
  "main": "./lib/index.js",
  "types": "./lib/index.d.ts",
  "exports": {
    ".": { "types": "./lib/index.d.ts", "import": "./lib/index.js" },
    "./package.json": "./package.json"
  },
  "files": ["lib/", "cordis.patch.yml"],
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } },
  "scripts": {
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "build": "tsc -p tsconfig.json && tsdown -c tsdown.config.ts"
  },
  "dependencies": {
    "@deepseek-ai/schemastery": "^3.18.4"
  },
  "peerDependencies": {
    "@deepseek-ai/cordis": "^4.0.1",
    "@deepseek-ai/dsh-tools": "^0.2.0-rc.1",
    "@deepseek-ai/dsh-llm": "^0.2.0-rc.1"
  },
  "peerDependenciesMeta": {
    "@deepseek-ai/cordis": { "optional": true },
    "@deepseek-ai/dsh-tools": { "optional": true },
    "@deepseek-ai/dsh-llm": { "optional": true }
  },
  "devDependencies": {
    "@deepseek-ai/cordis": "link:D:/Projects/deepseek-harness/dsh/vendor/cordis",
    "@deepseek-ai/dsh-tools": "link:D:/Projects/deepseek-harness/dsh/packages/core/tools",
    "@deepseek-ai/dsh-llm": "link:D:/Projects/deepseek-harness/dsh/packages/llm/llm",
    "@deepseek-ai/dsh-system-prompt": "link:D:/Projects/deepseek-harness/dsh/packages/core/system-prompt",
    "@deepseek-ai/dsh-scope": "link:D:/Projects/deepseek-harness/dsh/packages/core/scope",
    "@types/node": "^22.20.0",
    "tsdown": "^0.22.2",
    "typescript": "^5.9.0",
    "vitest": "^3.2.0"
  },
  "engines": { "node": ">=18.0.0" }
}
```

`cordis.patch.yml`：

```yaml
# dsh-plugin-toolsets bundle layer: inserts the toolsets service plugin row.
# Loaded by `dsh plugin --profile <name> add link:<this dir>` (or github:/npm).
# The `name` is the package entry; Loader resolves it from profile node_modules.
# The plugin default-exports the ToolsetsService class (service name: 'toolsets').
- insert:
    - id: toolsets
      name: '@huanlin/dsh-plugin-toolsets'
```

`tsconfig.json`（照抄 dsh-sleep）：

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "strict": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "outDir": "lib",
    "rootDir": "src",
    "declaration": true,
    "declarationMap": false,
    "sourceMap": false,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "allowImportingTsExtensions": true,
    "rewriteRelativeImportExtensions": true,
    "types": ["node"]
  },
  "include": ["src"]
}
```

`tsdown.config.ts`：

```ts
import { defineConfig, type UserConfig } from 'tsdown'

const ID = '@huanlin/dsh-plugin-toolsets'

const HOST_EXTERNALS = [
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-tools',
  '@deepseek-ai/dsh-llm',
  '@deepseek-ai/schemastery',
]

const libConfig: UserConfig = {
  name: ID,
  entry: { index: 'src/index.ts' },
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: true,
  clean: true,
  external: HOST_EXTERNALS,
}

export default defineConfig([libConfig])
```

`vitest.config.ts`：

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
    pool: 'forks',
  },
})
```

`.gitignore`（预构建策略：**不含** `lib/`）：

```
node_modules/
*.tsbuildinfo
*.tgz
coverage/
.vitest-cache/
# Local dev-only pnpm files: profile provides its own on github: install.
# Committing these without active maintenance breaks github: install resolution.
pnpm-lock.yaml
pnpm-workspace.yaml
```

- [ ] **Step 2: `pnpm install`（在插件目录）**

Run: `pnpm install`
Expected: 成功；`node_modules/@deepseek-ai/` 下出现 cordis/dsh-tools/dsh-llm/dsh-system-prompt/dsh-scope 链接。

- [ ] **Step 3: 写失败测试 `tests/registry.spec.ts`**

```ts
import { describe, expect, it, vi } from 'vitest'

vi.mock('@deepseek-ai/dsh-tools', () => ({
  defineTool: (options: unknown) => options,
  assertSupportedJsonSchema: () => {},
}))

import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { validateToolset } from '../src/registry.ts'
import type { ToolsetDefinition } from '../src/registry.ts'

function makeTool(name: string): ToolDefinition {
  return {
    name,
    description: `tool ${name}`,
    parameters: {},
    output: { schema: { type: 'json' }, render: () => [] },
    execute: async () => ({}),
  }
}

function makeToolset(overrides: Partial<ToolsetDefinition> = {}): ToolsetDefinition {
  return {
    name: 'demo',
    description: 'Use when demoing.',
    tools: [makeTool('demo_greet')],
    ...overrides,
  }
}

describe('validateToolset', () => {
  it('accepts a well-formed toolset with no existing ones', () => {
    expect(() => validateToolset(makeToolset(), [])).not.toThrow()
  })

  it('rejects toolset names that are not lowercase identifiers', () => {
    for (const bad of ['Demo', '1x', 'has space', 'camelCase', '', 'a'.repeat(65)]) {
      expect(() => validateToolset(makeToolset({ name: bad }), [])).toThrow(/toolset name/)
    }
  })

  it('rejects empty or non-string descriptions', () => {
    expect(() => validateToolset(makeToolset({ description: '' }), [])).toThrow(/description/)
    expect(() => validateToolset(makeToolset({ description: '   ' }), [])).toThrow(/description/)
  })

  it('rejects empty tools arrays', () => {
    expect(() => validateToolset(makeToolset({ tools: [] }), [])).toThrow(/tools/)
  })

  it('rejects tools missing output schema/render or execute', () => {
    const noRender = makeTool('x') as ToolDefinition & { output: Record<string, unknown> }
    delete noRender.output.render
    expect(() => validateToolset(makeToolset({ tools: [noRender] }), [])).toThrow(/output/)
    const noExecute = makeTool('x') as ToolDefinition & { execute?: unknown }
    delete noExecute.execute
    expect(() => validateToolset(makeToolset({ tools: [noExecute] }), [])).toThrow(/execute/)
  })

  it('rejects a tool named get_tools (would shadow the catalog tool)', () => {
    expect(() => validateToolset(makeToolset({ tools: [makeTool('get_tools')] }), [])).toThrow(/get_tools/)
  })

  it('rejects duplicate tool names within one toolset', () => {
    expect(() => validateToolset(makeToolset({ tools: [makeTool('dup'), makeTool('dup')] }), [])).toThrow(/duplicate/)
  })

  it('rejects a duplicate toolset name against existing registrations', () => {
    expect(() => validateToolset(makeToolset(), [makeToolset()])).toThrow(/already registered/)
  })

  it('rejects a tool name already claimed by another toolset', () => {
    const other = makeToolset({ name: 'other', tools: [makeTool('demo_greet'), makeTool('other_tool')] })
    expect(() => validateToolset(makeToolset(), [other])).toThrow(/already claimed by toolset "other"/)
  })
})
```

- [ ] **Step 4: 跑测试确认失败**

Run: `pnpm test`
Expected: FAIL —— 找不到 `../src/registry.ts`。

- [ ] **Step 5: 写 `src/registry.ts` 最小实现**

```ts
/**
 * registry.ts — toolset 注册表纯逻辑：定义形状、注册时校验（fail loud）。
 *
 * @module @huanlin/dsh-plugin-toolsets
 */

import { assertSupportedJsonSchema } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'

/** One lazily-loadable tool group registered by a plugin. */
export interface ToolsetDefinition {
  /** Registry-unique identifier matching {@link TOOLSET_NAME_PATTERN}, at most 64 chars. */
  readonly name: string
  /** Model-facing "when to use this toolset" statement (English). */
  readonly description: string
  /** Complete tool definitions; activated verbatim into one agent's scope. */
  readonly tools: readonly ToolDefinition[]
}

export const TOOLSET_NAME_PATTERN = /^[a-z][a-z0-9_-]*$/

export const CATALOG_TOOL_NAME = 'get_tools'

/**
 * Validate one toolset at registration time (fail loud at the earliest
 * resolvable point) against its own shape and the already-registered set.
 * @param toolset - candidate toolset.
 * @param existing - already-registered toolsets.
 * @throws Error/TypeError describing the first violation found.
 */
export function validateToolset(toolset: ToolsetDefinition, existing: Iterable<ToolsetDefinition>): void {
  if (typeof toolset !== 'object' || toolset === null) {
    throw new TypeError('toolsets.register: toolset must be an object')
  }
  const { name, description, tools } = toolset
  if (typeof name !== 'string' || !TOOLSET_NAME_PATTERN.test(name) || name.length > 64) {
    throw new Error(`toolsets.register: toolset name must match /^[a-z][a-z0-9_-]*$/ and be at most 64 chars, got ${JSON.stringify(name)}`)
  }
  if (typeof description !== 'string' || description.trim() === '') {
    throw new Error(`toolsets.register(${name}): description must be a non-empty string`)
  }
  if (!Array.isArray(tools) || tools.length === 0) {
    throw new Error(`toolsets.register(${name}): tools must be a non-empty array`)
  }
  const seen = new Set<string>()
  for (const tool of tools) {
    if (typeof tool !== 'object' || tool === null) {
      throw new Error(`toolsets.register(${name}): every tool must be an object`)
    }
    if (typeof tool.name !== 'string' || tool.name === '') {
      throw new Error(`toolsets.register(${name}): every tool needs a non-empty string name`)
    }
    if (tool.name === CATALOG_TOOL_NAME) {
      throw new Error(`toolsets.register(${name}): tool name "${CATALOG_TOOL_NAME}" is reserved for the catalog tool`)
    }
    if (typeof tool.execute !== 'function') {
      throw new Error(`toolsets.register(${name}): tool "${tool.name}" must declare an execute function`)
    }
    const output = (tool as Partial<ToolDefinition>).output
    if (typeof output !== 'object' || output === null
      || typeof output.render !== 'function'
      || output.schema === undefined) {
      throw new Error(`toolsets.register(${name}): tool "${tool.name}" must declare output { schema, render }`)
    }
    try {
      assertSupportedJsonSchema(output.schema)
    } catch (error) {
      throw new Error(`toolsets.register(${name}): tool "${tool.name}" output.schema is not a supported JSON Schema: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (seen.has(tool.name)) {
      throw new Error(`toolsets.register(${name}): duplicate tool name "${tool.name}" within the toolset`)
    }
    seen.add(tool.name)
  }
  for (const other of existing) {
    if (other.name === name) {
      throw new Error(`toolsets.register: toolset name "${name}" is already registered`)
    }
    for (const tool of tools) {
      if (other.tools.some(t => t.name === tool.name)) {
        throw new Error(`toolsets.register(${name}): tool name "${tool.name}" is already claimed by toolset "${other.name}"`)
      }
    }
  }
}
```

- [ ] **Step 6: 跑测试确认通过**

Run: `pnpm test && pnpm run typecheck`
Expected: 全部 PASS；typecheck 无错误。

- [ ] **Step 7: Commit**

```powershell
git add -A
git commit -m "feat: scaffold + toolset registration validation"
```

---

### Task 2: 目录与结果渲染（纯函数）

**Files:**
- Modify: `src/registry.ts`（追加导出）
- Modify: `src/get-tools.ts`（Create，本 task 只放结果 render；工具定义 Task 3 补）
- Modify: `tests/registry.spec.ts`（追加 describe）

说明：为保持每个文件单一职责，目录描述渲染放 `registry.ts`（它属于注册表投影），`get_tools` 的结果值/渲染放 `get-tools.ts`。本 task 先建 `get-tools.ts` 只含类型 + `renderGetToolsResult`。

**Interfaces:**
- Consumes: Task 1 的 `ToolsetDefinition`。
- Produces:
  - `function renderCatalogDescription(toolsets: readonly ToolsetDefinition[]): string`
  - `interface GetToolsResult { readonly toolset: string; readonly description: string; readonly alreadyActive: boolean; readonly tools: readonly { readonly name: string; readonly description: string }[] }`
  - `function renderGetToolsResult(value: GetToolsResult): string`

- [ ] **Step 1: 追加失败测试到 `tests/registry.spec.ts`**

```ts
import { renderCatalogDescription } from '../src/registry.ts'

describe('renderCatalogDescription', () => {
  it('renders one line per toolset with a collapsed description and tool count', () => {
    const toolsets = [
      makeToolset({ name: 'android', description: 'Operate a real\n  Android phone.' , tools: [makeTool('a'), makeTool('b')] }),
      makeToolset({ name: 'gaokao', description: 'Chinese college admission data.' }),
    ]
    const text = renderCatalogDescription(toolsets)
    expect(text).toContain('- android: Operate a real Android phone. (2 tools)')
    expect(text).toContain('- gaokao: Chinese college admission data. (1 tool)')
    expect(text).toContain('{"toolset": "<name>"}')
  })

  it('truncates descriptions over 200 chars to 197 + ellipsis', () => {
    const long = 'x'.repeat(300)
    const text = renderCatalogDescription([makeToolset({ description: long })])
    expect(text).toContain(`- demo: ${'x'.repeat(197)}… (1 tool)`)
  })
})
```

新建 `tests/get-tools.spec.ts`：

```ts
import { describe, expect, it, vi } from 'vitest'

vi.mock('@deepseek-ai/dsh-tools', () => ({
  defineTool: (options: unknown) => options,
  assertSupportedJsonSchema: () => {},
  ToolArgsError: class ToolArgsError extends Error {},
}))

import { renderGetToolsResult } from '../src/get-tools.ts'
import type { GetToolsResult } from '../src/get-tools.ts'

describe('renderGetToolsResult', () => {
  it('lists loaded tool names', () => {
    const value: GetToolsResult = {
      toolset: 'demo',
      description: 'Use when demoing.',
      alreadyActive: false,
      tools: [{ name: 'a', description: 'da' }, { name: 'b', description: 'db' }],
    }
    const text = renderGetToolsResult(value)
    expect(text).toContain('Loaded toolset "demo".')
    expect(text).toContain('(2): a, b')
  })

  it('states idempotence for an already-active toolset', () => {
    const value: GetToolsResult = {
      toolset: 'demo',
      description: 'Use when demoing.',
      alreadyActive: true,
      tools: [{ name: 'a', description: 'da' }],
    }
    expect(renderGetToolsResult(value)).toContain('already loaded')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test`
Expected: FAIL —— `renderCatalogDescription` / `renderGetToolsResult` 不存在。

- [ ] **Step 3: 实现**

追加到 `src/registry.ts`：

```ts
/** Collapse a multiline description to one trimmed line, truncated at 200 chars. */
function catalogLine(text: string): string {
  const collapsed = text.trim().replace(/\s+/g, ' ')
  return collapsed.length > 200 ? `${collapsed.slice(0, 197)}…` : collapsed
}

/**
 * Render the model-facing catalog: the usage preamble plus one line per
 * toolset (name, collapsed when-to-use statement, tool count).
 * @param toolsets - registered toolsets in registration order.
 * @returns the `get_tools` tool description.
 */
export function renderCatalogDescription(toolsets: readonly ToolsetDefinition[]): string {
  const lines = toolsets.map(t =>
    `- ${t.name}: ${catalogLine(t.description)} (${t.tools.length} tool${t.tools.length === 1 ? '' : 's'})`)
  return [
    'On-demand toolsets. Each entry below names one toolset and when to use it.',
    'Call this tool with {"toolset": "<name>"} to load that toolset\'s tools into your tool list:',
    'they become callable from your next turn and stay available for the rest of the session.',
    'Loading an already-loaded toolset is a harmless no-op that returns its current tool list.',
    '',
    'Toolsets:',
    ...lines,
  ].join('\n')
}
```

新建 `src/get-tools.ts`：

```ts
/**
 * get-tools.ts — the model-facing `get_tools` catalog tool: result types,
 * pure renderings, and (Task 3) the tool definition + activation wiring.
 *
 * @module @huanlin/dsh-plugin-toolsets
 */

import type { ContentBlock } from '@deepseek-ai/dsh-llm'

/** Canonical result value returned by `get_tools`. */
export interface GetToolsResult {
  readonly toolset: string
  readonly description: string
  readonly alreadyActive: boolean
  readonly tools: readonly { readonly name: string; readonly description: string }[]
}

/**
 * Pure text projection of one {@link GetToolsResult} (C9).
 * @param value - validated canonical value.
 * @returns one-paragraph summary naming the now-available tools.
 */
export function renderGetToolsResult(value: GetToolsResult): string {
  const names = value.tools.map(t => t.name).join(', ')
  const prefix = value.alreadyActive
    ? `Toolset "${value.toolset}" was already loaded; its tools remain available.`
    : `Loaded toolset "${value.toolset}".`
  return `${prefix} Tools now in your list (${value.tools.length}): ${names}`
}

/** Re-exported for the tool definition's render callback. */
export type { ContentBlock }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test && pnpm run typecheck`
Expected: PASS。

- [ ] **Step 5: Commit**

```powershell
git add -A
git commit -m "feat: catalog description + get_tools result rendering"
```

---

### Task 3: `get_tools` 工具定义与 execute 分支

**Files:**
- Modify: `src/get-tools.ts`（追加工具构建）
- Modify: `tests/get-tools.spec.ts`（追加 describe）

**Interfaces:**
- Consumes: Task 1 `ToolsetDefinition`/`renderCatalogDescription`（经 registry）、Task 2 `GetToolsResult`。
- Produces:
  - `interface AgentToolScope { readonly ctx: { readonly tools: { register(definition: ToolDefinition): () => void } } }`
  - `interface GetToolsDeps { catalog(): readonly ToolsetDefinition[]; activate(agent: AgentToolScope, name: string): GetToolsResult }`
  - `function buildGetToolsTool(deps: GetToolsDeps): ToolDefinition`
  - execute 分支：未知名 → `ToolArgsError`（消息列出已知名）；`exec.agent === undefined` → `Error`；否则 `deps.activate(exec.agent, name)`。

- [ ] **Step 1: 追加失败测试到 `tests/get-tools.spec.ts`**

```ts
import { buildGetToolsTool } from '../src/get-tools.ts'
import type { ToolsetDefinition } from '../src/registry.ts'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { ToolArgsError } from '@deepseek-ai/dsh-tools'

function makeToolDef(name: string): ToolDefinition {
  return {
    name,
    description: `tool ${name}`,
    parameters: {},
    output: { schema: { type: 'json' }, render: () => [] },
    execute: async () => ({}),
  }
}

const demoToolset: ToolsetDefinition = {
  name: 'demo',
  description: 'Use when demoing.',
  tools: [makeToolDef('demo_greet')],
}

function makeExec(agent?: object): { signal: AbortSignal; callId: string; rootCallId: string; name: string; arguments: unknown; agent?: object } {
  return {
    signal: new AbortController().signal,
    callId: 'c1',
    rootCallId: 'c1',
    name: 'get_tools',
    arguments: { toolset: 'demo' },
    ...(agent === undefined ? {} : { agent }),
  }
}

describe('buildGetToolsTool', () => {
  it('names the tool get_tools and embeds the catalog in its description', () => {
    const tool = buildGetToolsTool({ catalog: () => [demoToolset], activate: () => { throw new Error('unused') } })
    expect(tool.name).toBe('get_tools')
    expect(tool.description).toContain('- demo: Use when demoing. (1 tool)')
  })

  it('executes activation for the calling agent', async () => {
    const agent = { ctx: { tools: { register: () => () => {} } } }
    const tool = buildGetToolsTool({
      catalog: () => [demoToolset],
      activate: (a, name) => {
        expect(a).toBe(agent)
        expect(name).toBe('demo')
        return { toolset: name, description: 'd', alreadyActive: false, tools: [{ name: 'demo_greet', description: 'g' }] }
      },
    })
    const result = await tool.execute({ toolset: 'demo' }, makeExec(agent) as never)
    expect(result).toMatchObject({ toolset: 'demo', alreadyActive: false })
  })

  it('throws ToolArgsError naming the known toolsets for an unknown name', async () => {
    const tool = buildGetToolsTool({ catalog: () => [demoToolset], activate: () => { throw new Error('unused') } })
    await expect(tool.execute({ toolset: 'nope' }, makeExec(agentDummy) as never)).rejects.toThrow(ToolArgsError)
    await expect(tool.execute({ toolset: 'nope' }, makeExec(agentDummy) as never)).rejects.toThrow(/known toolsets: demo/)
  })

  it('throws a plain Error when the execution carries no agent', async () => {
    const tool = buildGetToolsTool({ catalog: () => [demoToolset], activate: () => { throw new Error('unused') } })
    await expect(tool.execute({ toolset: 'demo' }, makeExec() as never)).rejects.toThrow(/no agent/)
  })
})

const agentDummy = { ctx: { tools: { register: () => () => {} } } }
```

（注意：`agentDummy` 声明放在 describe 之后亦可——测试文件内 hoisting 由 vitest 处理变量提升问题不存在，它只在 it 回调运行时求值。）

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test`
Expected: FAIL —— `buildGetToolsTool` 不存在。

- [ ] **Step 3: 追加实现到 `src/get-tools.ts`**

在文件头部 import 区补充：

```ts
import { defineTool, ToolArgsError } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { renderCatalogDescription } from './registry.ts'
import type { ToolsetDefinition } from './registry.ts'
```

（删除 Task 2 里临时加的 `export type { ContentBlock }` 再导出行，改为直接 `import type` 使用。）

追加：

```ts
/** Minimal structural view of the calling agent: its scoped context's tool registrar. */
export interface AgentToolScope {
  readonly ctx: {
    readonly tools: {
      register(definition: ToolDefinition): () => void
    }
  }
}

/** Wiring the service injects when building the catalog tool. */
export interface GetToolsDeps {
  /** Current registered toolsets, in registration order. */
  catalog(): readonly ToolsetDefinition[]
  /** Service-owned activation for the calling agent. */
  activate(agent: AgentToolScope, name: string): GetToolsResult
}

/**
 * Build the `get_tools` catalog tool against the current registry snapshot.
 * The service rebuilds (dispose + re-register) this tool on every catalog
 * change so the embedded description stays current.
 * @param deps - catalog source and activation callback.
 * @returns the registry-ready tool definition.
 */
export function buildGetToolsTool(deps: GetToolsDeps): ToolDefinition {
  return defineTool({
    name: 'get_tools',
    description: renderCatalogDescription(deps.catalog()),
    parameters: {
      toolset: {
        type: 'string',
        required: true,
        description: 'Name of the toolset to load. See the toolsets listed in this tool\'s description.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          toolset: { type: 'string', required: true, description: 'Loaded toolset name.' },
          description: { type: 'string', required: true, description: 'The toolset\'s when-to-use statement.' },
          alreadyActive: { type: 'boolean', required: true, description: 'True when the toolset was already loaded for this agent.' },
          tools: {
            type: 'array',
            required: true,
            description: 'Tools now available in the calling agent\'s tool list.',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string', required: true },
                description: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args: unknown, value: unknown): ContentBlock[] => [
        { type: 'text', text: renderGetToolsResult(value as GetToolsResult) },
      ],
    },
    async execute(args: unknown, exec: ToolRunContext): Promise<GetToolsResult> {
      const toolset = (args as { toolset: string }).toolset
      const known = deps.catalog()
      if (!known.some(t => t.name === toolset)) {
        throw new ToolArgsError([
          `toolset: unknown toolset ${JSON.stringify(toolset)}; known toolsets: ${known.map(t => t.name).join(', ') || '(none)'}`,
        ])
      }
      const agent = (exec as { agent?: AgentToolScope }).agent
      if (agent === undefined) {
        throw new Error('get_tools: this execution carries no agent; toolsets activate per agent')
      }
      return deps.activate(agent, toolset)
    },
  })
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test && pnpm run typecheck`
Expected: PASS。注意：mock 的 `defineTool` 是直通函数，返回原对象，`tool.execute` 可直接调用。

- [ ] **Step 5: Commit**

```powershell
git add -A
git commit -m "feat: get_tools catalog tool definition + execute branches"
```

---

### Task 4: `ToolsetsService` 装配（ctx.toolsets）

**Files:**
- Create: `src/index.ts`
- Create: `tests/service.spec.ts`

**Interfaces:**
- Consumes: Task 1–3 全部导出。
- Produces:
  - `class ToolsetsService extends Service`：`static inject = ['tools']`、`static Config`、`register(toolset): () => void`、`list(): readonly ToolsetDefinition[]`、`activate(agent: AgentToolScope, name: string): GetToolsResult`
  - `declare module '@deepseek-ai/cordis' { interface Context { toolsets: ToolsetsService } }`
  - `export default ToolsetsService`（Loader 用）+ 具名导出。
  - `re-export`：`ToolsetDefinition`（消费方类型）。

- [ ] **Step 1: 写失败测试 `tests/service.spec.ts`**

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('@deepseek-ai/cordis', () => ({
  Service: class {
    ctx: unknown
    constructor(ctx: unknown) { this.ctx = ctx }
  },
}))

vi.mock('@deepseek-ai/dsh-tools', () => ({
  defineTool: (options: unknown) => options,
  assertSupportedJsonSchema: () => {},
  ToolArgsError: class ToolArgsError extends Error {},
}))

import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { ToolsetsService } from '../src/index.ts'
import type { ToolsetDefinition } from '../src/registry.ts'

function makeTool(name: string): ToolDefinition {
  return {
    name,
    description: `tool ${name}`,
    parameters: {},
    output: { schema: { type: 'json' }, render: () => [] },
    execute: async () => ({}),
  }
}

interface Harness {
  service: ToolsetsService
  registeredNames(): string[]
  agentRegistered(agent: object): ToolDefinition[]
}

function makeHarness(): Harness {
  const registered: { def: ToolDefinition }[] = []
  const disposers = new Map<ToolDefinition, () => void>()
  const register = (def: ToolDefinition): (() => void) => {
    registered.push({ def })
    const dispose = (): void => {
      const i = registered.findIndex(r => r.def === def)
      if (i >= 0) registered.splice(i, 1)
    }
    disposers.set(def, dispose)
    return dispose
  }
  const ctx = {
    tools: {
      register,
      schemas(): { name: string }[] {
        return registered.map(r => ({ name: r.def.name }))
      },
    },
    effect(fn: () => (() => void) | void): () => void {
      const teardown = fn() ?? ((): void => {})
      return (): void => { teardown() }
    },
  } as unknown as Context
  const service = new ToolsetsService(ctx, {})
  return {
    service,
    registeredNames: () => registered.map(r => r.def.name),
    agentRegistered: (agent: object): ToolDefinition[] => {
      const store = agentStores.get(agent)!
      return [...store]
    },
  }
}

const agentStores = new WeakMap<object, ToolDefinition[]>()

function makeAgent(): object & { ctx: { tools: { register(def: ToolDefinition): () => void } } } {
  const store: ToolDefinition[] = []
  const agent = {
    ctx: {
      tools: {
        register(def: ToolDefinition): () => void {
          store.push(def)
          return () => {
            const i = store.indexOf(def)
            if (i >= 0) store.splice(i, 1)
          }
        },
      },
    },
  }
  agentStores.set(agent, store)
  return agent
}

const demo: ToolsetDefinition = { name: 'demo', description: 'Use when demoing.', tools: [makeTool('demo_greet')] }
const extra: ToolsetDefinition = { name: 'extra', description: 'Extra utilities.', tools: [makeTool('extra_tool')] }

describe('ToolsetsService catalog lifecycle', () => {
  beforeEach(() => { /* each test builds its own harness */ })

  it('registers no catalog tool while the registry is empty', () => {
    const h = makeHarness()
    expect(h.registeredNames()).toEqual([])
  })

  it('registers get_tools once the first toolset registers', () => {
    const h = makeHarness()
    h.service.register(demo)
    expect(h.registeredNames()).toEqual(['get_tools'])
  })

  it('hot-refreshes the catalog description when a second toolset registers', () => {
    const h = makeHarness()
    h.service.register(demo)
    const first = h.registeredNames()
    h.service.register(extra)
    expect(h.registeredNames()).toEqual(['get_tools'])
    expect(first).toEqual(['get_tools'])
  })

  it('removes get_tools when the last toolset unregisters', () => {
    const h = makeHarness()
    const dispose = h.service.register(demo)
    dispose()
    expect(h.registeredNames()).toEqual([])
  })

  it('rejects duplicate toolset names', () => {
    const h = makeHarness()
    h.service.register(demo)
    expect(() => h.service.register({ ...demo, tools: [makeTool('other')] })).toThrow(/already registered/)
  })
})

describe('ToolsetsService.activate', () => {
  it('registers the toolset tools into the calling agent scope and reports them', () => {
    const h = makeHarness()
    h.service.register(demo)
    const agent = makeAgent()
    const result = h.service.activate(agent, 'demo')
    expect(result).toMatchObject({ toolset: 'demo', alreadyActive: false })
    expect(result.tools.map(t => t.name)).toEqual(['demo_greet'])
    expect(h.agentRegistered(agent).map(t => t.name)).toEqual(['demo_greet'])
  })

  it('is idempotent per agent (alreadyActive, no duplicate registration)', () => {
    const h = makeHarness()
    h.service.register(demo)
    const agent = makeAgent()
    h.service.activate(agent, 'demo')
    const second = h.service.activate(agent, 'demo')
    expect(second.alreadyActive).toBe(true)
    expect(h.agentRegistered(agent)).toHaveLength(1)
  })

  it('tracks agents independently', () => {
    const h = makeHarness()
    h.service.register(demo)
    const a1 = makeAgent()
    const a2 = makeAgent()
    h.service.activate(a1, 'demo')
    h.service.activate(a2, 'demo')
    expect(h.agentRegistered(a1)).toHaveLength(1)
    expect(h.agentRegistered(a2)).toHaveLength(1)
  })

  it('throws for an unknown toolset name', () => {
    const h = makeHarness()
    h.service.register(demo)
    expect(() => h.service.activate(makeAgent(), 'nope')).toThrow(/unknown toolset/)
  })

  it('throws and registers nothing when a tool name already visible to the agent collides', () => {
    const h = makeHarness()
    const colliding: ToolsetDefinition = { name: 'collide', description: 'Collision case.', tools: [makeTool('demo_greet')] }
    h.service.register(collide)
    // visible-to-agent check reads the SERVICE registry (get_tools + toolset tool presence):
    // pre-activate demo for this agent so demo_greet is already visible.
    h.service.register(demo)
    const agent = makeAgent()
    h.service.activate(agent, 'demo')
    expect(() => h.service.activate(agent, 'collide')).toThrow(/already visible/)
  })
})
```

（注：上面 "collide" 用例依赖 activate 的碰撞检查读取**服务级** `schemas(agent)`；fake ctx 的 `schemas()` 忽略 scope 返回全局注册表——其中只有 `get_tools`。为让用例成立，碰撞检查实现必须读服务级 schemas 而非 agent 自己的 store。看 Step 3 实现的 `this.ownCtx.tools.schemas(agent)`。**修正用例**：fake `schemas()` 应返回全局注册的名字；而 demo_greet 激活后注册进的是 agent store，不在全局注册表里——所以该用例改为：先在 fake ctx 全局注册一个与 toolset 工具同名的工具。最终用例：）

```ts
  it('throws and registers nothing when a tool name already visible to the agent collides', () => {
    const h = makeHarness()
    // 预置一个与 toolset 工具同名的全局工具（对 fake 而言即“对该 agent 可见”）
    const preset = makeHarnessWithPresetTool('demo_greet')
    void preset
    void h
  })
```

——以上占位必须替换为真实实现。实际写法（执行者按此落盘）：`makeHarness` 增加参数 `presetGlobalTools: string[]`，构造时先 `register(makeTool(name))` 进全局 fake 注册表；碰撞用例：

```ts
  it('throws and registers nothing when a tool name already visible to the agent collides', () => {
    const h = makeHarness(['demo_greet'])
    h.service.register(demo)
    const agent = makeAgent()
    expect(() => h.service.activate(agent, 'demo')).toThrow(/already visible/)
    expect(h.agentRegistered(agent)).toEqual([])
  })
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test`
Expected: FAIL —— `../src/index.ts` 不存在。

- [ ] **Step 3: 写 `src/index.ts`**

```ts
/**
 * index.ts — ToolsetsService: the ctx.toolsets seam.
 *
 * Class-form Cordis plugin (service name 'toolsets'). Other plugins
 * `inject: ['toolsets']` and register named tool groups; the model loads
 * one on demand through the `get_tools` catalog tool, which registers the
 * group's tools into the calling agent's own scope layer.
 *
 * @module @huanlin/dsh-plugin-toolsets
 */

import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { validateToolset } from './registry.ts'
import { buildGetToolsTool } from './get-tools.ts'
import type { ToolsetDefinition } from './registry.ts'
import type { AgentToolScope, GetToolsResult } from './get-tools.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Registry of lazily-loaded tool groups (provided by dsh-plugin-toolsets). */
    toolsets: ToolsetsService
  }
}

export interface Config {}

/**
 * Toolset registry service. Registrations are effect-owned by the calling
 * plugin's fiber (HMR-safe); activations are effect-owned by the target
 * agent's fiber (unwind with the agent).
 */
export class ToolsetsService extends Service {
  static inject = ['tools']

  static Config: z<Config> = z.object({})

  /** The service's own fiber context; `this.ctx` is tracker-rebound to callers. */
  private readonly ownCtx: Context
  private readonly toolsets = new Map<string, ToolsetDefinition>()
  private readonly activatedToolsets = new WeakMap<object, Set<string>>()
  private catalogToolDispose: (() => void) | undefined

  constructor(ctx: Context, _config: Config = {}) {
    super(ctx, 'toolsets')
    this.ownCtx = ctx
  }

  /**
   * Register one toolset. The effect (and its disposer) is owned by the
   * calling fiber when accessed through `ctx.toolsets`, so plugin unload or
   * HMR removes the toolset automatically.
   * @param toolset - validated toolset definition.
   * @returns disposer removing this toolset.
   */
  register(toolset: ToolsetDefinition): () => void {
    validateToolset(toolset, this.toolsets.values())
    const caller = this.ctx
    const dispose = caller.effect(() => {
      this.toolsets.set(toolset.name, toolset)
      this.refreshCatalogTool()
      return () => {
        this.toolsets.delete(toolset.name)
        this.refreshCatalogTool()
      }
    }, `toolsets.register(${toolset.name})`)
    return (): void => {
      void dispose()
    }
  }

  /**
   * Snapshot of registered toolsets in registration order.
   * @returns a fresh array of definitions.
   */
  list(): readonly ToolsetDefinition[] {
    return [...this.toolsets.values()]
  }

  /**
   * Activate one toolset for one agent: register its tools into the agent's
   * own scope layer. Idempotent per (agent, toolset).
   * @param agent - the calling agent (structural: needs ctx.tools.register).
   * @param name - registered toolset name.
   * @returns the canonical get_tools result value.
   */
  activate(agent: AgentToolScope, name: string): GetToolsResult {
    const toolset = this.toolsets.get(name)
    if (toolset === undefined) {
      throw new Error(`toolsets.activate: unknown toolset "${name}"`)
    }
    let names = this.activatedToolsets.get(agent)
    if (names === undefined) {
      names = new Set<string>()
      this.activatedToolsets.set(agent, names)
    }
    const alreadyActive = names.has(name)
    if (!alreadyActive) {
      const visible = new Set(this.ownCtx.tools.schemas(agent as object).map(s => s.name))
      const collisions = toolset.tools.filter(t => visible.has(t.name)).map(t => t.name)
      if (collisions.length > 0) {
        throw new Error(`toolsets: toolset "${name}" tool(s) ${collisions.map(n => `"${n}"`).join(', ')} already visible to this agent; refusing to shadow`)
      }
      for (const tool of toolset.tools) {
        agent.ctx.tools.register(tool)
      }
      names.add(name)
    }
    return {
      toolset: toolset.name,
      description: toolset.description,
      alreadyActive,
      tools: toolset.tools.map(t => ({ name: t.name, description: t.description })),
    }
  }

  /** Dispose + (when non-empty) rebuild the catalog tool from the current registry. */
  private refreshCatalogTool(): void {
    this.catalogToolDispose?.()
    this.catalogToolDispose = undefined
    if (this.toolsets.size === 0) return
    this.catalogToolDispose = this.ownCtx.tools.register(buildGetToolsTool({
      catalog: () => this.list(),
      activate: (agent, toolsetName) => this.activate(agent, toolsetName),
    }))
  }
}

export default ToolsetsService
export type { ToolsetDefinition } from './registry.ts'
export type { GetToolsResult, AgentToolScope } from './get-tools.ts'
```

注意 `makeHarness` 相应改造：`function makeHarness(presetGlobalToolNames: string[] = [])` —— 构造 fake ctx 时先对每个预设名 `register(makeTool(name))`。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test && pnpm run typecheck`
Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```powershell
git add -A
git commit -m "feat: ToolsetsService — ctx.toolsets seam, catalog lifecycle, per-agent activation"
```

---

### Task 5: 真实组合测试 + 构建 + 文档 + 安装 preflight

**Files:**
- Create: `tests/composition.spec.ts`
- Create: `README.md`
- Create: `AGENTS.md`
- Modify: `lib/`（构建产物，入 git）

**Interfaces:**
- Consumes: 真实（非 mock）`@deepseek-ai/cordis` Context、`@deepseek-ai/dsh-system-prompt`、`@deepseek-ai/dsh-tools` ToolRuntime、`@deepseek-ai/dsh-scope` createScope。
- Produces: 可安装 bundle（lib/ + cordis.patch.yml）+ 文档。

- [ ] **Step 1: 写真实组合测试 `tests/composition.spec.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { createScope } from '@deepseek-ai/dsh-scope'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import ToolsetsService from '../src/index.ts'

async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(ToolsetsService)
  return ctx
}

const demoGreet = defineTool({
  name: 'demo_greet',
  description: 'Greet by name (composition-test fixture).',
  parameters: { name: { type: 'string', required: true } },
  output: {
    schema: { type: 'string' },
    render: (_args, value) => [{ type: 'text', text: String(value) }],
  },
  async execute(args) {
    return `hi ${(args as { name?: string }).name ?? ''}`
  },
}) as ToolDefinition

describe('toolsets composition (real ToolRuntime + SystemPrompt)', () => {
  it('catalog appears/disappears with registry state and reaches the prompt assembly', async () => {
    const ctx = await setup()
    try {
      expect(ctx.tools.schemas().map(s => s.name)).toEqual([])
      const dispose = ctx.toolsets.register({
        name: 'demo',
        description: 'Use when demoing the toolsets plugin.',
        tools: [demoGreet],
      })
      expect(ctx.tools.schemas().map(s => s.name)).toEqual(['get_tools'])
      const schema = ctx.tools.schemas()[0]!
      expect(schema.description).toContain('- demo: Use when demoing the toolsets plugin. (1 tool)')
      const prompt = await ctx.systemPrompt.assemble()
      expect(prompt.tools.map(t => t.name)).toEqual(['get_tools'])

      dispose()
      expect(ctx.tools.schemas().map(s => s.name)).toEqual([])
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('get_tools activates the toolset into the calling agent scope only', async () => {
    const ctx = await setup()
    const agentKey: object = {}
    const scope = createScope(ctx, agentKey)
    try {
      ctx.toolsets.register({
        name: 'demo',
        description: 'Use when demoing the toolsets plugin.',
        tools: [demoGreet],
      })
      const agent = { ctx: scope.ctx } as never
      const result = await ctx.tools.execute({
        signal: new AbortController().signal,
        callId: ToolCallId('c1'),
        name: 'get_tools',
        arguments: { toolset: 'demo' },
        agent,
      })
      expect(result.isError).not.toBe(true)
      const names = ctx.tools.schemas(agentKey).map(s => s.name).sort()
      expect(names).toEqual(['demo_greet', 'get_tools'])
      // 其他 scope 不受影响：
      expect(ctx.tools.schemas().map(s => s.name)).toEqual(['get_tools'])
      // 幂等：
      const again = await ctx.tools.execute({
        signal: new AbortController().signal,
        callId: ToolCallId('c2'),
        name: 'get_tools',
        arguments: { toolset: 'demo' },
        agent,
      })
      expect(again.isError).not.toBe(true)
      expect(again.content[0]).toMatchObject({ type: 'text' })
      const text = (again.content[0] as { text: string }).text
      expect(text).toContain('already loaded')
      // 激活的工具真实可执行：
      const greeted = await ctx.tools.execute({
        signal: new AbortController().signal,
        callId: ToolCallId('c3'),
        name: 'demo_greet',
        arguments: { name: 'toolsets' },
        agent,
      })
      expect(greeted.isError).not.toBe(true)
      expect((greeted.content[0] as { text: string }).text).toBe('hi toolsets')
    } finally {
      await scope.dispose()
      await ctx.fiber.dispose()
    }
  })

  it('an unknown toolset name is an argument error; a missing agent is an execution error', async () => {
    const ctx = await setup()
    try {
      ctx.toolsets.register({
        name: 'demo',
        description: 'Use when demoing the toolsets plugin.',
        tools: [demoGreet],
      })
      const bad = await ctx.tools.execute({
        signal: new AbortController().signal,
        callId: ToolCallId('c1'),
        name: 'get_tools',
        arguments: { toolset: 'nope' },
      })
      expect(bad.isError).toBe(true)
      expect((bad.content[0] as { text: string }).text).toContain('unknown toolset')
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
```

（执行者注：`result.isError` / `result.content` 是 dsh tools 执行管线的公开结果形状，见 dsh/packages/core/tools/tests/tools.spec.ts 同款断言。）

- [ ] **Step 2: 跑测试**

Run: `pnpm test`
Expected: 全部 PASS（含此前单元测试）。若真实管线结果形状与断言不符（例如字段名差异），以 dsh 源码测试为准修正断言，不改产品代码迁就。

- [ ] **Step 3: 构建**

Run: `pnpm run build`
Expected: `lib/index.js`、`lib/index.d.ts`（tsdown dts）生成；`lib/registry.js`、`lib/get-tools.js` 亦在（tsc 产物 + tsdown entry 仅 index 时以 bundle 为准，两者共存无碍——以 tsdown `clean: true` 后的最终目录为准核对 `pnpm pack --dry-run` 只含 `lib/` 与 `cordis.patch.yml`）。

- [ ] **Step 4: 写 `README.md`（中文，开发/运行/检查三节）**

内容必须涵盖：
- 一句话功能 + 动机（上下文经济）。
- 消费方接入示例（完整代码）：`inject: ['toolsets']` + `ctx.toolsets.register({ name, description, tools })`，peerDependencies 加 `@huanlin/dsh-plugin-toolsets`。
- 模型侧行为说明：目录在 `get_tools` 描述中；激活下一轮生效；会话内持续；幂等。
- 开发（本仓库）：`pnpm install`（需本机 dsh checkout 于 `D:/Projects/deepseek-harness/dsh`，devDep 绝对链接）、`pnpm test`、`pnpm run typecheck`、`pnpm run build`。
- 运行：`dsh plugin --profile <name> add link:<本目录>`（或 github:/npm），重启 dsh web（人类操作）。
- 检查：`pnpm test`（单元 + 真实组合）、`pnpm run build`、`dsh --profile <name> --dump-config` 出现 `toolsets` 行。
- 已知取舍：激活后工具列表变化打断 provider 工具前缀缓存；下一轮才可调用；子 agent 不继承激活需自行调用；激活态为内存态（WeakMap），重启后可重新 `get_tools`；与 dsh-llm 内建 `deferLoading`（provider 层延迟声明）是正交机制，可组合但互不替代；工具名 `get_tools` 保留。

- [ ] **Step 5: 写 `AGENTS.md`（面向 agent 的仓库约定，简短）**

涵盖：bundle 形式、预构建 lib/ 策略（lib/ 入库、无 prepare）、host-only（无 client）、peer 集、测试分层（单元 mock 边界 + composition 用真实模块不 mock）、目录工具名保留 `get_tools`、模型可见文本英文、`this.ctx` tracker 语义与 `ownCtx` 捕获的原因、devDep 绝对链接为本机开发态。

- [ ] **Step 6: 安装 preflight（CLI 级；不启动 dsh web）**

```powershell
dsh plugin --profile web add "link:D:/Projects/deepseek-harness/dsh-plugin-toolsets"
dsh --profile web --dump-config | Select-String -Pattern "toolsets" -Context 1,2
```

Expected: add 成功；dump-config 输出含 `id: toolsets` / `name: '@huanlin/dsh-plugin-toolsets'` 的 insert 行。
随后**提示用户**：重启 `dsh web`（人类操作）后，装载任一提供 toolset 的消费插件即可在工具列表看到 `get_tools`。

- [ ] **Step 7: Commit**

```powershell
git add -A
git commit -m "feat: real-composition tests, build artifacts, docs, profile preflight"
```

---

## Self-Review 结论

- **Spec 覆盖**：服务 API（§1）→ Task 4；目录呈现（§2）→ Task 2/3/4 生命周期；激活语义六条（§3）→ Task 3（execute 分支）+ Task 4（幂等/碰撞/注册）；注册校验（§4）→ Task 1；工程与测试（§5）→ Task 1 配置 + Task 5 组合/preflight；已知取舍 → Task 5 README。无缺口。
- **占位符**：Task 4 Step 1 中间出现的修正段落是有意保留的推导记录，其下已给出最终用例代码；执行者落盘时只写最终版（`makeHarness(presetGlobalToolNames)` 版本）。
- **类型一致性**：`ToolsetDefinition`（Task 1）贯穿；`GetToolsResult`/`AgentToolScope`（Task 2/3）被 Task 4 `activate` 签名引用；`buildGetToolsTool(deps)`（Task 3）与 Task 4 `refreshCatalogTool` 调用一致；`renderCatalogDescription`（Task 2）由 Task 3 description 使用。
