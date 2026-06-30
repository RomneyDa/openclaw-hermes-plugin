import { resolveConfig } from "./config.js";
import { installHermesPlugin } from "./git-install.js";
import { listHermesPlugins } from "./hermes-python.js";
import { startHermesMcpServer } from "./mcp-server.js";

function readOptionValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) {
    return undefined;
  }
  const value = args[index + 1];
  return value && !value.startsWith("--") ? value : undefined;
}

function usage(): string {
  return [
    "Usage:",
    "  openclaw-hermes-plugin mcp",
    "  openclaw-hermes-plugin list",
    "  openclaw-hermes-plugin install <source> [--name <name>] [--force]",
  ].join("\n");
}

export async function runHermesPluginCli(args: string[]): Promise<void> {
  const command = args[0];
  if (!command || command === "-h" || command === "--help") {
    console.log(usage());
    return;
  }

  const config = resolveConfig(undefined);
  if (command === "mcp") {
    await startHermesMcpServer(config);
    return;
  }

  if (command === "list") {
    console.log(JSON.stringify(await listHermesPlugins(config), null, 2));
    return;
  }

  if (command === "install") {
    const source = args[1];
    if (!source || source.startsWith("--")) {
      throw new Error(usage());
    }
    const result = await installHermesPlugin({
      installDir: config.installDir,
      source,
      name: readOptionValue(args, "--name"),
      force: args.includes("--force"),
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  throw new Error(usage());
}
