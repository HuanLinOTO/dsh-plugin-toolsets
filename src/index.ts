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
