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
