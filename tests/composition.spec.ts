import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { createScope } from '@deepseek-ai/dsh-scope'
import type { Scope } from '@deepseek-ai/dsh-scope'
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import ToolsetsService from '../src/index.ts'

async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(NativeToolExecutor)
  await ctx.plugin(ToolsetsService)
  return ctx
}

/** One-call batch through the selected executor, unwrapped to the settled result. */
async function executeOne(
  ctx: Context,
  call: {
    callId: string
    name: string
    arguments: Record<string, unknown>
    signal: AbortSignal
    agent?: unknown
  },
): Promise<ToolExecutionResult> {
  const batch = await ctx.tools.execute({
    calls: [{ type: 'tool-call', id: ToolCallId(call.callId), name: call.name, arguments: JSON.stringify(call.arguments) }],
    signal: call.signal,
    agent: call.agent as Parameters<Context['tools']['execute']>[0]['agent'],
  })
  return batch.results[0]!.result
}

/**
 * Mint a scope whose key doubles as the Agent-like object, with `ctx` wired
 * back to the scoped context — mirroring dsh-agent-loop's
 * `createScope(loopCtx, this)` where the Agent IS the scope key and the
 * pipeline resolves scoped tools by `exec.agent` identity. The scoped
 * context resolves services through the MINTING plugin's dependency chain —
 * the minter must inject what scope holders will reach. Canonical pattern:
 * dsh packages/core/tools/tests/scoped.spec.ts `mintAgentScope`.
 */
interface FixtureAgent {
  readonly ctx: Context
}

/** The agent type `ctx.tools.execute` accepts, derived in place to keep the fixture dependency-free. */
type ExecAgent = NonNullable<Parameters<Context['tools']['execute']>[0]['agent']>

/** Comparable cast: the runtime Agent carries `ctx: Context`, satisfying FixtureAgent structurally. */
const execAgent = (agent: FixtureAgent): ExecAgent => agent as ExecAgent

async function mintAgentScope(ctx: Context): Promise<{ agent: FixtureAgent; dispose: () => Promise<void> }> {
  const agent = { ctx: undefined as unknown as Context }
  let scope!: Scope
  await ctx.plugin(Object.assign((inner: Context) => {
    scope = createScope(inner, agent)
    agent.ctx = scope.ctx
  }, { inject: ['tools'] }))
  return { agent, dispose: () => scope.dispose() }
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
    const { agent, dispose: disposeScope } = await mintAgentScope(ctx)
    try {
      ctx.toolsets.register({
        name: 'demo',
        description: 'Use when demoing the toolsets plugin.',
        tools: [demoGreet],
      })
      const result = await executeOne(ctx, {
        signal: new AbortController().signal,
        callId: 'c1',
        name: 'get_tools',
        arguments: { toolset: 'demo' },
        agent: execAgent(agent),
      })
      expect(result.isError).not.toBe(true)
      const names = ctx.tools.schemas(agent).map(s => s.name).sort()
      expect(names).toEqual(['demo_greet', 'get_tools'])
      // 其他 scope 不受影响：
      expect(ctx.tools.schemas().map(s => s.name)).toEqual(['get_tools'])
      // 幂等：
      const again = await executeOne(ctx, {
        signal: new AbortController().signal,
        callId: 'c2',
        name: 'get_tools',
        arguments: { toolset: 'demo' },
        agent: execAgent(agent),
      })
      expect(again.isError).not.toBe(true)
      expect(again.content[0]).toMatchObject({ type: 'text' })
      const text = (again.content[0] as { text: string }).text
      expect(text).toContain('already loaded')
      // 激活的工具真实可执行：
      const greeted = await executeOne(ctx, {
        signal: new AbortController().signal,
        callId: 'c3',
        name: 'demo_greet',
        arguments: { name: 'toolsets' },
        agent: execAgent(agent),
      })
      expect(greeted.isError).not.toBe(true)
      expect((greeted.content[0] as { text: string }).text).toBe('hi toolsets')
    } finally {
      await disposeScope()
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
      const bad = await executeOne(ctx, {
        signal: new AbortController().signal,
        callId: 'c1',
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
