import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import type { HermesBridgeConfig } from "./config.js";
import { callHermesTool, listHermesPlugins, type HermesListResult, type HermesToolSummary } from "./hermes-python.js";

export type HermesMcpToolRoute = {
  plugin: string;
  tool: string;
};

export type HermesMcpToolIndex = {
  tools: Tool[];
  routes: Map<string, HermesMcpToolRoute>;
};

type JsonObject = Record<string, unknown>;

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
  if (!params.duplicates.has(params.tool)) {
    return params.tool;
  }
  return `${sanitizeName(params.plugin)}__${sanitizeName(params.tool)}`;
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
  const routes = new Map<string, HermesMcpToolRoute>();
  const tools: Tool[] = [];

  for (const plugin of list.plugins) {
    for (const hermesTool of plugin.tools) {
      const name = mcpToolName({
        plugin: plugin.key,
        tool: hermesTool.name,
        duplicates,
      });
      routes.set(name, { plugin: plugin.key, tool: hermesTool.name });
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
  return { tools, routes };
}

export function createHermesMcpServer(config: HermesBridgeConfig): Server {
  const server = new Server(
    { name: "openclaw-hermes-plugin", version: "0.1.0" },
    {
      capabilities: {
        tools: { listChanged: false },
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const index = buildHermesMcpToolIndex(await listHermesPlugins(config));
    return { tools: index.tools };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    const list = await listHermesPlugins(config);
    const index = buildHermesMcpToolIndex(list);
    const route = index.routes.get(request.params.name);
    if (!route) {
      return {
        isError: true,
        content: [{ type: "text", text: `Unknown Hermes MCP tool: ${request.params.name}` }],
      };
    }

    try {
      const result = await callHermesTool(config, {
        plugin: route.plugin,
        tool: route.tool,
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
