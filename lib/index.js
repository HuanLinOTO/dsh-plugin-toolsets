import { Service } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";
import { ToolArgsError, assertSupportedJsonSchema, defineTool } from "@deepseek-ai/dsh-tools";
//#region src/registry.ts
/**
* registry.ts — toolset 注册表纯逻辑：定义形状、注册时校验（fail loud）。
*
* @module @huanlin/dsh-plugin-toolsets
*/
const TOOLSET_NAME_PATTERN = /^[a-z][a-z0-9_-]*$/;
const CATALOG_TOOL_NAME = "get_tools";
/**
* Validate one toolset at registration time (fail loud at the earliest
* resolvable point) against its own shape and the already-registered set.
* @param toolset - candidate toolset.
* @param existing - already-registered toolsets.
* @throws Error/TypeError describing the first violation found.
*/
function validateToolset(toolset, existing) {
	if (typeof toolset !== "object" || toolset === null) throw new TypeError("toolsets.register: toolset must be an object");
	const { name, description, tools } = toolset;
	if (typeof name !== "string" || !TOOLSET_NAME_PATTERN.test(name) || name.length > 64) throw new Error(`toolsets.register: toolset name must match /^[a-z][a-z0-9_-]*$/ and be at most 64 chars, got ${JSON.stringify(name)}`);
	if (typeof description !== "string" || description.trim() === "") throw new Error(`toolsets.register(${name}): description must be a non-empty string`);
	if (!Array.isArray(tools) || tools.length === 0) throw new Error(`toolsets.register(${name}): tools must be a non-empty array`);
	const seen = /* @__PURE__ */ new Set();
	for (const tool of tools) {
		if (typeof tool !== "object" || tool === null) throw new Error(`toolsets.register(${name}): every tool must be an object`);
		if (typeof tool.name !== "string" || tool.name === "") throw new Error(`toolsets.register(${name}): every tool needs a non-empty string name`);
		if (tool.name === "get_tools") throw new Error(`toolsets.register(${name}): tool name "${CATALOG_TOOL_NAME}" is reserved for the catalog tool`);
		if (typeof tool.execute !== "function") throw new Error(`toolsets.register(${name}): tool "${tool.name}" must declare an execute function`);
		const output = tool.output;
		if (typeof output !== "object" || output === null || typeof output.render !== "function" || output.schema === void 0) throw new Error(`toolsets.register(${name}): tool "${tool.name}" must declare output { schema, render }`);
		try {
			assertSupportedJsonSchema(output.schema);
		} catch (error) {
			throw new Error(`toolsets.register(${name}): tool "${tool.name}" output.schema is not a supported JSON Schema: ${error instanceof Error ? error.message : String(error)}`);
		}
		if (seen.has(tool.name)) throw new Error(`toolsets.register(${name}): duplicate tool name "${tool.name}" within the toolset`);
		seen.add(tool.name);
	}
	for (const other of existing) {
		if (other.name === name) throw new Error(`toolsets.register: toolset name "${name}" is already registered`);
		for (const tool of tools) if (other.tools.some((t) => t.name === tool.name)) throw new Error(`toolsets.register(${name}): tool name "${tool.name}" is already claimed by toolset "${other.name}"`);
	}
}
/** Collapse a multiline description to one trimmed line, truncated at 200 chars. */
function catalogLine(text) {
	const collapsed = text.trim().replace(/\s+/g, " ");
	return collapsed.length > 200 ? `${collapsed.slice(0, 197)}…` : collapsed;
}
/**
* Render the model-facing catalog: the usage preamble plus one line per
* toolset (name, collapsed when-to-use statement, tool count).
* @param toolsets - registered toolsets in registration order.
* @returns the `get_tools` tool description.
*/
function renderCatalogDescription(toolsets) {
	return [
		"On-demand toolsets. Each entry below names one toolset and when to use it.",
		"Call this tool with {\"toolset\": \"<name>\"} to load that toolset's tools into your tool list:",
		"they become callable from your next turn and stay available for the rest of the session.",
		"Loading an already-loaded toolset is a harmless no-op that returns its current tool list.",
		"",
		"Toolsets:",
		...toolsets.map((t) => `- ${t.name}: ${catalogLine(t.description)} (${t.tools.length} tool${t.tools.length === 1 ? "" : "s"})`)
	].join("\n");
}
//#endregion
//#region src/get-tools.ts
/**
* get-tools.ts — the model-facing `get_tools` catalog tool: result types,
* pure renderings, and (Task 3) the tool definition + activation wiring.
*
* @module @huanlin/dsh-plugin-toolsets
*/
/**
* Pure text projection of one {@link GetToolsResult} (C9).
* @param value - validated canonical value.
* @returns one-paragraph summary naming the now-available tools.
*/
function renderGetToolsResult(value) {
	const names = value.tools.map((t) => t.name).join(", ");
	return `${value.alreadyActive ? `Toolset "${value.toolset}" was already loaded; its tools remain available.` : `Loaded toolset "${value.toolset}".`} Tools now in your list (${value.tools.length}): ${names}`;
}
/**
* Build the `get_tools` catalog tool against the current registry snapshot.
* The service rebuilds (dispose + re-register) this tool on every catalog
* change so the embedded description stays current.
* @param deps - catalog source and activation callback.
* @returns the registry-ready tool definition.
*/
function buildGetToolsTool(deps) {
	return defineTool({
		name: "get_tools",
		description: renderCatalogDescription(deps.catalog()),
		parameters: { toolset: {
			type: "string",
			required: true,
			description: "Name of the toolset to load. See the toolsets listed in this tool's description."
		} },
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					toolset: {
						type: "string",
						required: true,
						description: "Loaded toolset name."
					},
					description: {
						type: "string",
						required: true,
						description: "The toolset's when-to-use statement."
					},
					alreadyActive: {
						type: "boolean",
						required: true,
						description: "True when the toolset was already loaded for this agent."
					},
					tools: {
						type: "array",
						required: true,
						description: "Tools now available in the calling agent's tool list.",
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								name: {
									type: "string",
									required: true
								},
								description: {
									type: "string",
									required: true
								}
							}
						}
					}
				}
			},
			render: (_args, value) => [{
				type: "text",
				text: renderGetToolsResult(value)
			}]
		},
		async execute(args, exec) {
			const toolset = args.toolset;
			const known = deps.catalog();
			if (!known.some((t) => t.name === toolset)) throw new ToolArgsError([`toolset: unknown toolset ${JSON.stringify(toolset)}; known toolsets: ${known.map((t) => t.name).join(", ") || "(none)"}`]);
			const agent = exec.agent;
			if (agent === void 0) throw new Error("get_tools: this execution carries no agent; toolsets activate per agent");
			const activated = deps.activate(agent, toolset);
			return {
				...activated,
				tools: [...activated.tools]
			};
		}
	});
}
//#endregion
//#region src/index.ts
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
/**
* Toolset registry service. Registrations are effect-owned by the calling
* plugin's fiber (HMR-safe); activations are effect-owned by the target
* agent's fiber (unwind with the agent).
*/
var ToolsetsService = class extends Service {
	static inject = ["tools"];
	static Config = z.object({});
	/** The service's own fiber context; `this.ctx` is tracker-rebound to callers. */
	ownCtx;
	toolsets = /* @__PURE__ */ new Map();
	activatedToolsets = /* @__PURE__ */ new WeakMap();
	catalogToolDispose;
	constructor(ctx, _config = {}) {
		super(ctx, "toolsets");
		this.ownCtx = ctx;
	}
	/**
	* Register one toolset. The effect (and its disposer) is owned by the
	* calling fiber when accessed through `ctx.toolsets`, so plugin unload or
	* HMR removes the toolset automatically.
	* @param toolset - validated toolset definition.
	* @returns disposer removing this toolset.
	*/
	register(toolset) {
		validateToolset(toolset, this.toolsets.values());
		const dispose = this.ctx.effect(() => {
			this.toolsets.set(toolset.name, toolset);
			this.refreshCatalogTool();
			return () => {
				this.toolsets.delete(toolset.name);
				this.refreshCatalogTool();
			};
		}, `toolsets.register(${toolset.name})`);
		return () => {
			dispose();
		};
	}
	/**
	* Snapshot of registered toolsets in registration order.
	* @returns a fresh array of definitions.
	*/
	list() {
		return [...this.toolsets.values()];
	}
	/**
	* Activate one toolset for one agent: register its tools into the agent's
	* own scope layer. Idempotent per (agent, toolset).
	* @param agent - the calling agent (structural: needs ctx.tools.register).
	* @param name - registered toolset name.
	* @returns the canonical get_tools result value.
	*/
	activate(agent, name) {
		const toolset = this.toolsets.get(name);
		if (toolset === void 0) throw new Error(`toolsets.activate: unknown toolset "${name}"`);
		let names = this.activatedToolsets.get(agent);
		if (names === void 0) {
			names = /* @__PURE__ */ new Set();
			this.activatedToolsets.set(agent, names);
		}
		const alreadyActive = names.has(name);
		if (!alreadyActive) {
			const visible = new Set(this.ownCtx.tools.schemas(agent).map((s) => s.name));
			const collisions = toolset.tools.filter((t) => visible.has(t.name)).map((t) => t.name);
			if (collisions.length > 0) throw new Error(`toolsets: toolset "${name}" tool(s) ${collisions.map((n) => `"${n}"`).join(", ")} already visible to this agent; refusing to shadow`);
			for (const tool of toolset.tools) agent.ctx.tools.register(tool);
			names.add(name);
		}
		return {
			toolset: toolset.name,
			description: toolset.description,
			alreadyActive,
			tools: toolset.tools.map((t) => ({
				name: t.name,
				description: t.description
			}))
		};
	}
	/** Dispose + (when non-empty) rebuild the catalog tool from the current registry. */
	refreshCatalogTool() {
		this.catalogToolDispose?.();
		this.catalogToolDispose = void 0;
		if (this.toolsets.size === 0) return;
		this.catalogToolDispose = this.ownCtx.tools.register(buildGetToolsTool({
			catalog: () => this.list(),
			activate: (agent, toolsetName) => this.activate(agent, toolsetName)
		}));
	}
};
//#endregion
export { ToolsetsService, ToolsetsService as default };
