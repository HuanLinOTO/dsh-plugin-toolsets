/**
 * get-tools.ts — the model-facing `get_tools` catalog tool: result types,
 * pure renderings, and (Task 3) the tool definition + activation wiring.
 *
 * @module @huanlin/dsh-plugin-toolsets
 */

import { defineTool, ToolArgsError } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { renderCatalogDescription } from './registry.ts'
import type { ToolsetDefinition } from './registry.ts'

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
    async execute(args: unknown, exec: ToolRunContext) {
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
      // defineTool's InferValue materializes mutable arrays from the schema;
      // spread the readonly result into a JSON-identical mutable copy.
      const activated = deps.activate(agent, toolset)
      return { ...activated, tools: [...activated.tools] }
    },
  })
}
