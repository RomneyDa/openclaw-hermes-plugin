import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { HermesBridgeConfig } from "./config.js";
import { installHermesPlugin, uninstallHermesPlugin } from "./git-install.js";
import {
  callHermesTool,
  listHermesPlugins,
  type HermesCommandSummary,
  type HermesListResult,
  type HermesRuntimeContext,
  type HermesToolSummary,
} from "./hermes-python.js";
import { syncHermesSkills } from "./skill-sync.js";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const generatedRegistryFile = "hermes-tools.generated.json";

export const NATIVE_BRIDGE_TOOL_NAMES = [
  "hermes_plugins_list",
  "hermes_plugin_install",
  "hermes_plugin_uninstall",
] as const;

type JsonObject = Record<string, unknown>;

export type NativeToolContext = {
  workspaceDir?: string;
  sessionId?: string;
  sessionKey?: string;
  agentId?: string;
  modelId?: string;
  modelProviderId?: string;
  activeModel?: {
    provider?: string;
    modelId?: string;
    modelRef?: string;
  };
};

export type NativeTool = {
  name: string;
  label?: string;
  description: string;
  parameters: unknown;
  execute(
    toolCallId: string,
    params: unknown,
    signal?: AbortSignal,
  ): Promise<{ content: Array<{ type: "text"; text: string }>; details?: unknown }>;
};

export type NativeToolEntry = {
  kind: "tool";
  name: string;
  plugin: string;
  originalName: string;
  description: string;
  inputSchema: JsonObject;
};

export type GeneratedCommandEntry = {
  name: string;
  plugin: string;
  originalName: string;
  description: string;
  argsHint: string;
};

export type GeneratedNativeToolRegistry = {
  generatedAt: string;
  installDir: string;
  tools: NativeToolEntry[];
  commands: GeneratedCommandEntry[];
  cliCommands: GeneratedCommandEntry[];
};

function asObject(value: unknown): JsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function sanitizeName(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
  return cleaned || "plugin";
}

function stringifyResult(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function result(value: unknown): { content: Array<{ type: "text"; text: string }>; details: unknown } {
  return { content: [{ type: "text", text: stringifyResult(value) }], details: value };
}

function inputSchemaFor(tool: HermesToolSummary): JsonObject {
  const schema = asObject(tool.schema);
  const parameters = asObject(schema?.parameters);
  if (parameters?.type === "object") {
    return parameters;
  }
  if (schema?.type === "object") {
    return schema;
  }
  return { type: "object", additionalProperties: true };
}

function generatedToolName(params: {
  plugin: string;
  tool: string;
  duplicates: Set<string>;
}): string {
  if (
    !params.duplicates.has(params.tool) &&
    !NATIVE_BRIDGE_TOOL_NAMES.includes(params.tool as (typeof NATIVE_BRIDGE_TOOL_NAMES)[number])
  ) {
    return params.tool;
  }
  return `${sanitizeName(params.plugin)}__${sanitizeName(params.tool)}`;
}

function uniqueName(base: string, used: Set<string>): string {
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${base}_${suffix}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

function commandBaseName(command: string): string {
  return sanitizeName(command).replace(/^[^A-Za-z]+/, "").toLowerCase();
}

function commandName(params: { plugin: string; command: string; duplicates: Set<string> }): string {
  const cleaned = commandBaseName(params.command);
  const fallback = `hermes_${sanitizeName(params.plugin)}_${sanitizeName(params.command)}`.toLowerCase();
  const base = cleaned || fallback;
  if (!params.duplicates.has(base)) {
    return base;
  }
  return fallback;
}

export function buildNativeToolEntries(list: HermesListResult): NativeToolEntry[] {
  const counts = new Map<string, number>();
  for (const plugin of list.plugins) {
    for (const tool of plugin.tools) {
      if (tool.available) {
        counts.set(tool.name, (counts.get(tool.name) ?? 0) + 1);
      }
    }
  }
  const duplicates = new Set(
    [...counts.entries()].filter(([, count]) => count > 1).map(([name]) => name),
  );
  const entries: NativeToolEntry[] = [];
  const usedNames = new Set<string>(NATIVE_BRIDGE_TOOL_NAMES);

  for (const plugin of list.plugins) {
    for (const tool of plugin.tools) {
      if (!tool.available) {
        continue;
      }
      entries.push({
        kind: "tool",
        name: uniqueName(
          generatedToolName({ plugin: plugin.key, tool: tool.name, duplicates }),
          usedNames,
        ),
        plugin: plugin.key,
        originalName: tool.name,
        description: tool.description || `Hermes ${plugin.key}/${tool.name}`,
        inputSchema: inputSchemaFor(tool),
      });
    }
  }

  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

function buildCommandEntries(
  list: HermesListResult,
  select: (plugin: HermesListResult["plugins"][number]) => HermesCommandSummary[],
): GeneratedCommandEntry[] {
  const counts = new Map<string, number>();
  for (const plugin of list.plugins) {
    for (const command of select(plugin)) {
      if (command.available) {
        const key = commandBaseName(command.name) || `${plugin.key}/${command.name}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
  }
  const duplicates = new Set(
    [...counts.entries()].filter(([, count]) => count > 1).map(([name]) => name),
  );
  const usedNames = new Set<string>();
  return list.plugins.flatMap((plugin) =>
    select(plugin)
      .filter((entry) => entry.available)
      .map((entry) => ({
        name: uniqueName(
          commandName({ plugin: plugin.key, command: entry.name, duplicates }),
          usedNames,
        ),
        plugin: plugin.key,
        originalName: entry.name,
        description: entry.description || `Run Hermes command ${plugin.key}/${entry.name}`,
        argsHint: entry.argsHint,
      })),
  ).sort((a, b) => a.name.localeCompare(b.name));
}

function registryPath(root = packageRoot): string {
  return path.join(root, generatedRegistryFile);
}

function manifestPath(root = packageRoot): string {
  return path.join(root, "openclaw.plugin.json");
}

export function readGeneratedNativeToolRegistry(root = packageRoot): GeneratedNativeToolRegistry {
  try {
    const parsed = JSON.parse(fs.readFileSync(registryPath(root), "utf8")) as Partial<GeneratedNativeToolRegistry>;
    return {
      generatedAt: typeof parsed.generatedAt === "string" ? parsed.generatedAt : "",
      installDir: typeof parsed.installDir === "string" ? parsed.installDir : "",
      tools: Array.isArray(parsed.tools) ? parsed.tools.filter(isNativeToolEntry) : [],
      commands: Array.isArray(parsed.commands) ? parsed.commands.filter(isCommandEntry) : [],
      cliCommands: Array.isArray(parsed.cliCommands)
        ? parsed.cliCommands.filter(isCommandEntry)
        : [],
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
    return { generatedAt: "", installDir: "", tools: [], commands: [], cliCommands: [] };
  }
}

function isNativeToolEntry(value: unknown): value is NativeToolEntry {
  const item = asObject(value);
  return (
    item?.kind === "tool" &&
    typeof item.name === "string" &&
    typeof item.plugin === "string" &&
    typeof item.originalName === "string" &&
    typeof item.description === "string" &&
    asObject(item.inputSchema) !== undefined
  );
}

function isCommandEntry(value: unknown): value is GeneratedCommandEntry {
  const item = asObject(value);
  return (
    typeof item?.name === "string" &&
    typeof item.plugin === "string" &&
    typeof item.originalName === "string" &&
    typeof item.description === "string" &&
    typeof item.argsHint === "string"
  );
}

async function writeManifestTools(names: string[], root: string): Promise<void> {
  const target = manifestPath(root);
  const manifest = JSON.parse(await fsp.readFile(target, "utf8")) as JsonObject;
  const contracts = asObject(manifest.contracts) ?? {};
  contracts.tools = names;
  manifest.contracts = contracts;
  await fsp.writeFile(target, `${JSON.stringify(manifest, null, 2)}\n`);
}

export async function regenerateNativeTools(
  config: HermesBridgeConfig,
  options: { root?: string } = {},
): Promise<{ generatedTools: string[]; restartRequired: true }> {
  const root = options.root ?? packageRoot;
  const list = await listHermesPlugins(config);
  const tools = buildNativeToolEntries(list);
  const commands = buildCommandEntries(list, (plugin) => plugin.commands);
  const cliCommands = buildCommandEntries(list, (plugin) => plugin.cliCommands ?? []);
  const registry: GeneratedNativeToolRegistry = {
    generatedAt: new Date().toISOString(),
    installDir: list.installDir,
    tools,
    commands,
    cliCommands,
  };
  await fsp.writeFile(registryPath(root), `${JSON.stringify(registry, null, 2)}\n`);
  await writeManifestTools([...NATIVE_BRIDGE_TOOL_NAMES, ...tools.map((tool) => tool.name)], root);
  await syncHermesSkills(config, root);
  return { generatedTools: tools.map((tool) => tool.name), restartRequired: true };
}

function runtimeContext(ctx: NativeToolContext): HermesRuntimeContext {
  return {
    workspace: ctx.workspaceDir ?? process.cwd(),
    sessionId: ctx.sessionId,
    sessionKey: ctx.sessionKey,
    agentId: ctx.agentId,
    model: ctx.modelId ?? ctx.activeModel?.modelId ?? ctx.activeModel?.modelRef,
    provider: ctx.modelProviderId ?? ctx.activeModel?.provider,
    env: {},
  };
}

function bridgeTools(config: HermesBridgeConfig): NativeTool[] {
  return [
    {
      name: "hermes_plugins_list",
      description: "List installed Hermes Agent Python plugins and their registered surfaces.",
      parameters: { type: "object", additionalProperties: false },
      execute: async () => result(await listHermesPlugins(config)),
    },
    {
      name: "hermes_plugin_install",
      description:
        "Install a Hermes Agent Python plugin Git repository and generate native OpenClaw tools for the next restart.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          source: { type: "string", description: "Git URL or local cloneable source." },
          name: { type: "string", description: "Optional install directory name." },
          force: { type: "boolean", description: "Replace an existing install." },
        },
        required: ["source"],
      },
      execute: async (_toolCallId, params) => {
        const args = asObject(params) ?? {};
        const source = typeof args.source === "string" ? args.source.trim() : "";
        if (!source) {
          throw new Error("source is required");
        }
        const installed = await installHermesPlugin({
          installDir: config.installDir,
          source,
          name: typeof args.name === "string" ? args.name : undefined,
          force: args.force === true,
        });
        return result({ installed, ...(await regenerateNativeTools(config)) });
      },
    },
    {
      name: "hermes_plugin_uninstall",
      description:
        "Uninstall an installed Hermes Agent Python plugin and generate native OpenClaw tools for the next restart.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string", description: "Installed Hermes plugin directory name." },
        },
        required: ["name"],
      },
      execute: async (_toolCallId, params) => {
        const name = typeof asObject(params)?.name === "string" ? String(asObject(params)?.name) : "";
        if (!name.trim()) {
          throw new Error("name is required");
        }
        const removed = await uninstallHermesPlugin({ installDir: config.installDir, name });
        return result({ removed, ...(await regenerateNativeTools(config)) });
      },
    },
  ];
}

function generatedTools(
  config: HermesBridgeConfig,
  entries: NativeToolEntry[],
  ctx: NativeToolContext,
): NativeTool[] {
  return entries.map((entry) => ({
    name: entry.name,
    description: entry.description,
    parameters: entry.inputSchema,
    execute: async (_toolCallId, params, signal) => {
      const openclawContext = runtimeContext(ctx);
      const tool = await callHermesTool(
        config,
        {
          plugin: entry.plugin,
          tool: entry.originalName,
          args: params ?? {},
          context: openclawContext,
        },
        { signal },
      );
      return result(tool.parsedResult ?? tool.result);
    },
  }));
}

export function createNativeTools(
  config: HermesBridgeConfig,
  entries: NativeToolEntry[],
  ctx: NativeToolContext,
): NativeTool[] {
  return [...bridgeTools(config), ...generatedTools(config, entries, ctx)];
}
