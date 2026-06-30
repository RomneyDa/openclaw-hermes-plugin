import { definePluginEntry, type OpenClawPluginDefinition } from "openclaw/plugin-sdk/plugin-entry";
import { resolveConfig } from "./config.js";
import { registerHermesPluginCli } from "./cli.js";
import { createHermesBridgeTools } from "./tools.js";

const plugin: OpenClawPluginDefinition = definePluginEntry({
  id: "hermes-plugin",
  name: "Hermes Plugin Bridge",
  description: "Installs and calls Hermes Agent Python plugins from OpenClaw.",
  register(api) {
    const config = resolveConfig(api.pluginConfig);
    for (const tool of createHermesBridgeTools(config)) {
      api.registerTool(tool, { optional: true });
    }
    api.registerCli(
      ({ program }) => {
        registerHermesPluginCli(program, api.pluginConfig);
      },
      {
        descriptors: [
          {
            name: "hermes-plugin",
            description: "Install and inspect Hermes Agent Python plugins",
            hasSubcommands: true,
          },
        ],
      },
    );
  },
});

export default plugin;
