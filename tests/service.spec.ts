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
    output: { schema: { type: 'string' }, render: () => [] },
    execute: async () => ({}),
  }
}

interface Harness {
  service: ToolsetsService
  registeredNames(): string[]
  agentRegistered(agent: object): ToolDefinition[]
}

function makeHarness(presetGlobalToolNames: string[] = []): Harness {
  const registered: { def: ToolDefinition }[] = []
  const register = (def: ToolDefinition): (() => void) => {
    registered.push({ def })
    return (): void => {
      const i = registered.findIndex(r => r.def === def)
      if (i >= 0) registered.splice(i, 1)
    }
  }
  for (const name of presetGlobalToolNames) register(makeTool(name))
  const ctx = {
    tools: {
      register,
      schemas(): { name: string }[] {
        return registered.map(r => ({ name: r.def.name }))
      },
    },
    effect(fn: () => (() => void) | void, _label?: string): () => void {
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
    const h = makeHarness(['demo_greet'])
    h.service.register(demo)
    const agent = makeAgent()
    expect(() => h.service.activate(agent, 'demo')).toThrow(/already visible/)
    expect(h.agentRegistered(agent)).toEqual([])
  })
})
