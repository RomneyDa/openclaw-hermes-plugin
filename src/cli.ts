import { resolveConfig } from "./config.js";
import { installHermesPlugin } from "./git-install.js";
import { listHermesPlugins } from "./hermes-python.js";
import { startHermesMcpServer } from "./mcp-server.js";

type CliCommand = {
  description(text: string): CliCommand;
  argument(name: string, description: string): CliCommand;
  option(flags: string, description: string): CliCommand;
  action(handler: (...args: unknown[]) => void | Promise<void>): CliCommand;
  command(name: string): CliCommand;
};

export function registerHermesPluginCli(program: CliCommand, pluginConfig?: Record<string, unknown>): void {
  const root = program
    .command("hermes-plugin")
    .description("Install and inspect Hermes Agent Python plugins for the OpenClaw bridge");

  root
    .command("install")
    .argument("<source>", "Git URL or cloneable source")
    .option("--name <name>", "Install directory name")
    .option("--force", "Replace an existing install")
    .action(async (source, opts) => {
      const sourceText = typeof source === "string" ? source : "";
      const options = opts && typeof opts === "object" ? (opts as Record<string, unknown>) : {};
      const config = resolveConfig(pluginConfig);
      const result = await installHermesPlugin({
        installDir: config.installDir,
        source: sourceText,
        name: typeof options.name === "string" ? options.name : undefined,
        force: options.force === true,
      });
      console.log(JSON.stringify(result, null, 2));
    });

  root.command("list").description("List installed Hermes plugins").action(async () => {
    const config = resolveConfig(pluginConfig);
    console.log(JSON.stringify(await listHermesPlugins(config), null, 2));
  });

  root.command("mcp").description("Start an MCP stdio server for installed Hermes tools").action(async () => {
    await startHermesMcpServer(resolveConfig(pluginConfig));
  });
}
