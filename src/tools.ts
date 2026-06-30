import { jsonResult, readStringParam, type AnyAgentTool } from "openclaw/plugin-sdk/core";
import { Type } from "typebox";
import type { HermesBridgeConfig } from "./config.js";
import { installHermesPlugin } from "./git-install.js";
import { callHermesTool, listHermesPlugins } from "./hermes-python.js";

const EmptySchema = Type.Object({}, { additionalProperties: false });

const CallSchema = Type.Object(
  {
    plugin: Type.Optional(Type.String({ description: "Hermes plugin key/name. Optional when tool name is unique." })),
    tool: Type.String({ description: "Hermes tool name registered by ctx.register_tool." }),
    args: Type.Optional(Type.Any({ description: "JSON arguments passed to the Hermes tool handler." })),
  },
  { additionalProperties: false },
);

const InstallSchema = Type.Object(
  {
    source: Type.String({ description: "Git URL or local cloneable source for the Hermes plugin." }),
    name: Type.Optional(Type.String({ description: "Install directory name. Defaults to the repo name." })),
    force: Type.Optional(Type.Boolean({ description: "Replace an existing install with the same name." })),
  },
  { additionalProperties: false },
);

function asRecord(params: unknown): Record<string, unknown> {
  return params && typeof params === "object" && !Array.isArray(params)
    ? (params as Record<string, unknown>)
    : {};
}

export function createHermesBridgeTools(config: HermesBridgeConfig): AnyAgentTool[] {
  return [
    {
      name: "hermes_plugins_list",
      label: "Hermes Plugins List",
      description: "List installed Hermes Agent Python plugins and the compatible surfaces OpenClaw can call.",
      parameters: EmptySchema,
      execute: async () => jsonResult(await listHermesPlugins(config)),
    },
    {
      name: "hermes_tool_call",
      label: "Hermes Tool Call",
      description: "Call a tool registered by an installed Hermes Agent Python plugin.",
      parameters: CallSchema,
      execute: async (_toolCallId, rawParams) => {
        const params = asRecord(rawParams);
        const tool = readStringParam(params, "tool", { required: true });
        return jsonResult(
          await callHermesTool(config, {
            plugin: readStringParam(params, "plugin"),
            tool,
            args: params.args ?? {},
          }),
        );
      },
    },
    {
      name: "hermes_plugin_install",
      label: "Hermes Plugin Install",
      description: "Install a Hermes Agent Python plugin Git repository into the OpenClaw Hermes plugin bridge directory.",
      parameters: InstallSchema,
      execute: async (_toolCallId, rawParams) => {
        const params = asRecord(rawParams);
        const source = readStringParam(params, "source", { required: true });
        const installed = await installHermesPlugin({
          installDir: config.installDir,
          source,
          name: readStringParam(params, "name"),
          force: params.force === true,
        });
        return jsonResult({
          ...installed,
          summary: `installed Hermes plugin '${installed.name}'`,
        });
      },
    },
  ];
}
