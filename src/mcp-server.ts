import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import type { HermesBridgeConfig } from "./config.js";
import { installHermesPlugin } from "./git-install.js";
import {
  callHermesTool,
  callHermesCommand,
  listHermesPlugins,
  type HermesListResult,
  type HermesToolSummary,
} from "./hermes-python.js";
import { regenerateNativeTools } from "./native-tools.js";
import { syncHermesSkills } from "./skill-sync.js";

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
  "hermes_task_start",
  "hermes_task_status",
  "hermes_task_stop",
]);

type TaskState =
  | { id: string; status: "running"; startedAt: number; controller: AbortController }
  | { id: string; status: "completed"; startedAt: number; finishedAt: number; result: unknown }
  | { id: string; status: "failed"; startedAt: number; finishedAt: number; error: string }
  | { id: string; status: "stopped"; startedAt: number; finishedAt: number; error?: string };

const tasks = new Map<string, TaskState>();
let nextTaskId = 1;

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
      name: "hermes_task_start",
      description: "Run a Hermes tool or command in the background for later polling.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          kind: { type: "string", enum: ["tool", "command"] },
          plugin: { type: "string" },
          name: { type: "string" },
          args: { description: "Arguments passed to the Hermes tool or command." },
        },
        required: ["kind", "name"],
      },
    },
    {
      name: "hermes_task_status",
      description: "Return the status and result for a Hermes background task.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
    {
      name: "hermes_task_stop",
      description: "Stop a running Hermes background task.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: { id: { type: "string" } },
        required: ["id"],
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
        description: [
          command.description || `Run Hermes command ${plugin.key}/${command.name}`,
          command.argsHint ? `Args: ${command.argsHint}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: {
            args: {
              type: "string",
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

export function createHermesMcpServer(config: HermesBridgeConfig): Server {
  const server = new Server(
    { name: "openclaw-hermes-plugin", version: "0.1.0" },
    {
      capabilities: {
        tools: { listChanged: true },
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const index = buildHermesMcpToolIndex(await listHermesPlugins(config));
    return { tools: [...bridgeTools(), ...index.tools] };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    if (request.params.name === "hermes_plugins_list") {
      return {
        content: [{ type: "text", text: stringifyResult(await listHermesPlugins(config)) }],
      };
    }

    if (request.params.name === "hermes_task_start") {
      const args = asObject(request.params.arguments) ?? {};
      const kind = args.kind === "command" ? "command" : "tool";
      const name = typeof args.name === "string" ? args.name.trim() : "";
      if (!name) {
        return { isError: true, content: [{ type: "text", text: "name is required" }] };
      }
      const id = `hermes-task-${nextTaskId++}`;
      const startedAt = Date.now();
      const controller = new AbortController();
      tasks.set(id, { id, status: "running", startedAt, controller });
      const run =
        kind === "command"
          ? callHermesCommand(
              config,
              {
                plugin: typeof args.plugin === "string" ? args.plugin : undefined,
                command: name,
                args: args.args ?? "",
              },
              { signal: controller.signal },
            )
          : callHermesTool(
              config,
              {
                plugin: typeof args.plugin === "string" ? args.plugin : undefined,
                tool: name,
                args: args.args ?? {},
              },
              { signal: controller.signal },
            );
      void run.then(
        (result) => {
          if (tasks.get(id)?.status === "running") {
            tasks.set(id, { id, status: "completed", startedAt, finishedAt: Date.now(), result });
          }
        },
        (error: unknown) => {
          if (tasks.get(id)?.status === "running") {
            tasks.set(id, {
              id,
              status: "failed",
              startedAt,
              finishedAt: Date.now(),
              error: (error as Error).message,
            });
          }
        },
      );
      return {
        content: [{ type: "text", text: stringifyResult({ id, status: "running" }) }],
        structuredContent: { id, status: "running" },
      };
    }

    if (request.params.name === "hermes_task_status") {
      const id = String(asObject(request.params.arguments)?.id ?? "");
      const task = tasks.get(id);
      if (!task) {
        return { isError: true, content: [{ type: "text", text: `Unknown Hermes task: ${id}` }] };
      }
      const { controller: _controller, ...safeTask } =
        task.status === "running" ? task : { ...task, controller: undefined };
      return {
        content: [{ type: "text", text: stringifyResult(safeTask) }],
        structuredContent: asObject(safeTask),
      };
    }

    if (request.params.name === "hermes_task_stop") {
      const id = String(asObject(request.params.arguments)?.id ?? "");
      const task = tasks.get(id);
      if (!task) {
        return { isError: true, content: [{ type: "text", text: `Unknown Hermes task: ${id}` }] };
      }
      if (task.status === "running") {
        task.controller.abort();
        tasks.set(id, { id, status: "stopped", startedAt: task.startedAt, finishedAt: Date.now() });
      }
      return {
        content: [{ type: "text", text: stringifyResult(tasks.get(id)) }],
        structuredContent: asObject(tasks.get(id)),
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
      const generated = await regenerateNativeTools(config);
      await server.sendToolListChanged();
      return {
        content: [{ type: "text", text: stringifyResult({ installed: result, ...generated }) }],
        structuredContent: { installed: result, ...generated },
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
  await syncHermesSkills(config);
  const server = createHermesMcpServer(config);
  await server.connect(new StdioServerTransport());
}
