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
