import { Context, Service } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";
import { ToolDefinition } from "@deepseek-ai/dsh-tools";
//#region src/registry.d.ts
/** One lazily-loadable tool group registered by a plugin. */
interface ToolsetDefinition {
  /** Registry-unique identifier matching {@link TOOLSET_NAME_PATTERN}, at most 64 chars. */
  readonly name: string;
  /** Model-facing "when to use this toolset" statement (English). */
  readonly description: string;
  /** Complete tool definitions; activated verbatim into one agent's scope. */
  readonly tools: readonly ToolDefinition[];
}
//#endregion
//#region src/get-tools.d.ts
/** Canonical result value returned by `get_tools`. */
interface GetToolsResult {
  readonly toolset: string;
  readonly description: string;
  readonly alreadyActive: boolean;
  readonly tools: readonly {
    readonly name: string;
    readonly description: string;
  }[];
}
/** Minimal structural view of the calling agent: its scoped context's tool registrar. */
interface AgentToolScope {
  readonly ctx: {
    readonly tools: {
      register(definition: ToolDefinition): () => void;
    };
  };
}
//#endregion
//#region src/index.d.ts
declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Registry of lazily-loaded tool groups (provided by dsh-plugin-toolsets). */
    toolsets: ToolsetsService;
  }
}
interface Config {}
/**
 * Toolset registry service. Registrations are effect-owned by the calling
 * plugin's fiber (HMR-safe); activations are effect-owned by the target
 * agent's fiber (unwind with the agent).
 */
declare class ToolsetsService extends Service {
  static inject: string[];
  static Config: z<Config>;
  /** The service's own fiber context; `this.ctx` is tracker-rebound to callers. */
  private readonly ownCtx;
  private readonly toolsets;
  private readonly activatedToolsets;
  private catalogToolDispose;
  constructor(ctx: Context, _config?: Config);
  /**
   * Register one toolset. The effect (and its disposer) is owned by the
   * calling fiber when accessed through `ctx.toolsets`, so plugin unload or
   * HMR removes the toolset automatically.
   * @param toolset - validated toolset definition.
   * @returns disposer removing this toolset.
   */
  register(toolset: ToolsetDefinition): () => void;
  /**
   * Snapshot of registered toolsets in registration order.
   * @returns a fresh array of definitions.
   */
  list(): readonly ToolsetDefinition[];
  /**
   * Activate one toolset for one agent: register its tools into the agent's
   * own scope layer. Idempotent per (agent, toolset).
   * @param agent - the calling agent (structural: needs ctx.tools.register).
   * @param name - registered toolset name.
   * @returns the canonical get_tools result value.
   */
  activate(agent: AgentToolScope, name: string): GetToolsResult;
  /** Dispose + (when non-empty) rebuild the catalog tool from the current registry. */
  private refreshCatalogTool;
}
//#endregion
export { type AgentToolScope, Config, type GetToolsResult, type ToolsetDefinition, ToolsetsService, ToolsetsService as default };