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
