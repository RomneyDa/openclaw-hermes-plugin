import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  type CallToolResult,
  type Prompt,
  type Resource,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import type { HermesBridgeConfig } from "./config.js";
import { installHermesPlugin } from "./git-install.js";
import {
  callHermesTool,
  callHermesCommand,
  listHermesPlugins,
  readHermesSkill,
  type HermesListResult,
  type HermesToolSummary,
} from "./hermes-python.js";

export type HermesMcpRoute = {
  plugin: string;
  name: string;
};

export type HermesMcpToolIndex = {
  tools: Tool[];
  toolRoutes: Map<string, HermesMcpRoute>;
  commandRoutes: Map<string, HermesMcpRoute>;
};

type JsonObject = Record<string, unknown>;
const BRIDGE_TOOL_NAMES = new Set([
  "hermes_plugins_list",
  "hermes_plugin_install",
  "hermes_skill_read",
]);
const SKILL_URI_PREFIX = "hermes-skill://";

function asObject(value: unknown): JsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function sanitizeName(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
  return cleaned || "plugin";
}

function inputSchemaFor(tool: HermesToolSummary): Tool["inputSchema"] {
  const schema = asObject(tool.schema);
  const parameters = asObject(schema?.parameters);
  if (parameters?.type === "object") {
    return parameters as Tool["inputSchema"];
  }
  if (schema?.type === "object") {
    return schema as Tool["inputSchema"];
  }
  return { type: "object", additionalProperties: true };
}

function stringifyResult(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function mcpToolName(params: {
  plugin: string;
  tool: string;
  duplicates: Set<string>;
}): string {
  if (!params.duplicates.has(params.tool) && !BRIDGE_TOOL_NAMES.has(params.tool)) {
    return params.tool;
  }
  return `${sanitizeName(params.plugin)}__${sanitizeName(params.tool)}`;
}

function commandToolName(plugin: string, command: string): string {
  return `hermes_command__${sanitizeName(plugin)}__${sanitizeName(command)}`;
}

function skillName(plugin: string, skill: string): string {
  return `${sanitizeName(plugin)}__${sanitizeName(skill)}`;
}

function skillUri(plugin: string, skill: string): string {
  return `${SKILL_URI_PREFIX}${encodeURIComponent(plugin)}/${encodeURIComponent(skill)}`;
}

function bridgeTools(): Tool[] {
  return [
    {
      name: "hermes_plugins_list",
      description: "List installed Hermes Agent Python plugins and their registered surfaces.",
      inputSchema: { type: "object", additionalProperties: false },
    },
    {
      name: "hermes_plugin_install",
      description: "Install a Hermes Agent Python plugin Git repository into the bridge directory.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          source: { type: "string", description: "Git URL or local cloneable source." },
          name: { type: "string", description: "Optional install directory name." },
          force: { type: "boolean", description: "Replace an existing install." },
        },
        required: ["source"],
      },
    },
    {
      name: "hermes_skill_read",
      description: "Read a skill registered by an installed Hermes Agent Python plugin.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          plugin: { type: "string", description: "Hermes plugin key/name." },
          skill: { type: "string", description: "Hermes skill name." },
        },
        required: ["skill"],
      },
    },
  ];
}

function commandTools(list: HermesListResult): { tools: Tool[]; routes: Map<string, HermesMcpRoute> } {
  const routes = new Map<string, HermesMcpRoute>();
  const tools: Tool[] = [];
  for (const plugin of list.plugins) {
    for (const command of plugin.commands) {
      if (!command.available) {
        continue;
      }
      const name = commandToolName(plugin.key, command.name);
      routes.set(name, { plugin: plugin.key, name: command.name });
      tools.push({
        name,
        description: command.description || `Run Hermes command ${plugin.key}/${command.name}`,
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: {
            args: {
              description: command.argsHint || "Arguments passed to the Hermes command handler.",
            },
          },
        },
        _meta: {
          "hermes/plugin": plugin.key,
          "hermes/command": command.name,
          "hermes/argsHint": command.argsHint,
        },
      });
    }
  }
  tools.sort((a, b) => a.name.localeCompare(b.name));
  return { tools, routes };
}

export function buildHermesMcpToolIndex(list: HermesListResult): HermesMcpToolIndex {
  const counts = new Map<string, number>();
  for (const plugin of list.plugins) {
    for (const tool of plugin.tools) {
      counts.set(tool.name, (counts.get(tool.name) ?? 0) + 1);
    }
  }

  const duplicates = new Set(
    [...counts.entries()].filter(([, count]) => count > 1).map(([name]) => name),
  );
  const toolRoutes = new Map<string, HermesMcpRoute>();
  const tools: Tool[] = [];

  for (const plugin of list.plugins) {
    for (const hermesTool of plugin.tools) {
      const name = mcpToolName({
        plugin: plugin.key,
        tool: hermesTool.name,
        duplicates,
      });
      toolRoutes.set(name, { plugin: plugin.key, name: hermesTool.name });
      tools.push({
        name,
        description: hermesTool.description || `Hermes ${plugin.key}/${hermesTool.name}`,
        inputSchema: inputSchemaFor(hermesTool),
        _meta: {
          "hermes/plugin": plugin.key,
          "hermes/tool": hermesTool.name,
          "hermes/toolset": hermesTool.toolset,
          "hermes/available": hermesTool.available,
          "hermes/requiresEnv": hermesTool.requiresEnv,
        },
      });
    }
  }

  tools.sort((a, b) => a.name.localeCompare(b.name));
  const commands = commandTools(list);
  return { tools: [...commands.tools, ...tools], toolRoutes, commandRoutes: commands.routes };
}

function skillEntries(list: HermesListResult): {
  prompts: Prompt[];
  resources: Resource[];
  routes: Map<string, HermesMcpRoute>;
  uriRoutes: Map<string, HermesMcpRoute>;
} {
  const routes = new Map<string, HermesMcpRoute>();
  const uriRoutes = new Map<string, HermesMcpRoute>();
  const prompts: Prompt[] = [];
  const resources: Resource[] = [];

  for (const plugin of list.plugins) {
    for (const skill of plugin.skills) {
      if (!skill.available) {
        continue;
      }
      const name = skillName(plugin.key, skill.name);
      const uri = skillUri(plugin.key, skill.name);
      routes.set(name, { plugin: plugin.key, name: skill.name });
      uriRoutes.set(uri, { plugin: plugin.key, name: skill.name });
      prompts.push({
        name,
        title: skill.name,
        description: skill.description || `Hermes skill ${plugin.key}/${skill.name}`,
        _meta: { "hermes/plugin": plugin.key, "hermes/skill": skill.name },
      });
      resources.push({
        uri,
        name,
        title: skill.name,
        description: skill.description || `Hermes skill ${plugin.key}/${skill.name}`,
        mimeType: "text/markdown",
        _meta: { "hermes/plugin": plugin.key, "hermes/skill": skill.name },
      });
    }
  }

  prompts.sort((a, b) => a.name.localeCompare(b.name));
  resources.sort((a, b) => a.name.localeCompare(b.name));
  return { prompts, resources, routes, uriRoutes };
}

async function readSkillByRoute(config: HermesBridgeConfig, route: HermesMcpRoute) {
  return await readHermesSkill(config, { plugin: route.plugin, skill: route.name });
}

export function createHermesMcpServer(config: HermesBridgeConfig): Server {
  const server = new Server(
    { name: "openclaw-hermes-plugin", version: "0.1.0" },
    {
      capabilities: {
        tools: { listChanged: true },
        prompts: { listChanged: true },
        resources: { listChanged: true },
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const index = buildHermesMcpToolIndex(await listHermesPlugins(config));
    return { tools: [...bridgeTools(), ...index.tools] };
  });

  server.setRequestHandler(ListPromptsRequestSchema, async () => {
    return { prompts: skillEntries(await listHermesPlugins(config)).prompts };
  });

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const entries = skillEntries(await listHermesPlugins(config));
    const route = entries.routes.get(request.params.name);
    if (!route) {
      throw new Error(`Unknown Hermes skill prompt: ${request.params.name}`);
    }
    const skill = await readSkillByRoute(config, route);
    return {
      description: skill.description,
      messages: [{ role: "user", content: { type: "text", text: skill.text } }],
    };
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return { resources: skillEntries(await listHermesPlugins(config)).resources };
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const entries = skillEntries(await listHermesPlugins(config));
    const route = entries.uriRoutes.get(request.params.uri);
    if (!route) {
      throw new Error(`Unknown Hermes skill resource: ${request.params.uri}`);
    }
    const skill = await readSkillByRoute(config, route);
    return {
      contents: [{ uri: request.params.uri, mimeType: "text/markdown", text: skill.text }],
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    if (request.params.name === "hermes_plugins_list") {
      return {
        content: [{ type: "text", text: stringifyResult(await listHermesPlugins(config)) }],
      };
    }

    if (request.params.name === "hermes_plugin_install") {
      const args = asObject(request.params.arguments) ?? {};
      const source = typeof args.source === "string" ? args.source.trim() : "";
      if (!source) {
        return {
          isError: true,
          content: [{ type: "text", text: "source is required" }],
        };
      }
      const result = await installHermesPlugin({
        installDir: config.installDir,
        source,
        name: typeof args.name === "string" ? args.name : undefined,
        force: args.force === true,
      });
      await server.sendToolListChanged();
      await server.sendPromptListChanged();
      await server.sendResourceListChanged();
      return {
        content: [{ type: "text", text: stringifyResult(result) }],
        structuredContent: result,
      };
    }

    if (request.params.name === "hermes_skill_read") {
      const args = asObject(request.params.arguments) ?? {};
      const skillNameArg = typeof args.skill === "string" ? args.skill.trim() : "";
      if (!skillNameArg) {
        return { isError: true, content: [{ type: "text", text: "skill is required" }] };
      }
      const result = await readHermesSkill(config, {
        plugin: typeof args.plugin === "string" ? args.plugin : undefined,
        skill: skillNameArg,
      });
      return {
        content: [{ type: "text", text: result.text }],
        structuredContent: result,
      };
    }

    const list = await listHermesPlugins(config);
    const index = buildHermesMcpToolIndex(list);
    const commandRoute = index.commandRoutes.get(request.params.name);
    if (commandRoute) {
      const result = await callHermesCommand(config, {
        plugin: commandRoute.plugin,
        command: commandRoute.name,
        args: asObject(request.params.arguments)?.args ?? request.params.arguments ?? "",
      });
      return {
        content: [{ type: "text", text: stringifyResult(result.result) }],
        structuredContent: asObject(result.result),
        _meta: {
          "hermes/plugin": result.plugin,
          "hermes/command": result.command,
        },
      };
    }

    const route = index.toolRoutes.get(request.params.name);
    if (!route) {
      return {
        isError: true,
        content: [{ type: "text", text: `Unknown Hermes MCP tool: ${request.params.name}` }],
      };
    }

    try {
      const result = await callHermesTool(config, {
        plugin: route.plugin,
        tool: route.name,
        args: request.params.arguments ?? {},
      });
      return {
        content: [
          {
            type: "text",
            text: stringifyResult(result.parsedResult ?? result.result),
          },
        ],
        structuredContent: asObject(result.parsedResult ?? result.result),
        _meta: {
          "hermes/plugin": result.plugin,
          "hermes/tool": result.tool,
        },
      };
    } catch (error) {
      return {
        isError: true,
        content: [{ type: "text", text: (error as Error).message }],
      };
    }
  });

  return server;
}

export async function startHermesMcpServer(config: HermesBridgeConfig): Promise<void> {
  const server = createHermesMcpServer(config);
  await server.connect(new StdioServerTransport());
}
