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
