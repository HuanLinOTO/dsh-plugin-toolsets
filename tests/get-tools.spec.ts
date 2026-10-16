import { describe, expect, it, vi } from 'vitest'

vi.mock('@deepseek-ai/dsh-tools', () => ({
  defineTool: (options: unknown) => options,
  assertSupportedJsonSchema: () => {},
  ToolArgsError: class ToolArgsError extends Error {},
}))

import { buildGetToolsTool, renderGetToolsResult } from '../src/get-tools.ts'
import type { GetToolsResult } from '../src/get-tools.ts'
import type { ToolsetDefinition } from '../src/registry.ts'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { ToolArgsError } from '@deepseek-ai/dsh-tools'

function makeToolDef(name: string): ToolDefinition {
  return {
    name,
    description: `tool ${name}`,
    parameters: {},
    output: { schema: { type: 'string' }, render: () => [] },
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
