import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildNativeToolEntries, regenerateNativeTools } from "./native-tools.js";

async function copyFixture(target: string): Promise<void> {
  const fixture = path.join(process.cwd(), "test/fixtures/simple-hermes-plugin");
  await fs.cp(fixture, path.join(target, "simple"), { recursive: true });
}

async function writeCommandFixture(root: string, name: string): Promise<void> {
  const target = path.join(root, name);
  await fs.mkdir(target, { recursive: true });
  await fs.writeFile(path.join(target, "plugin.yaml"), `name: ${name}\nversion: 0.0.0\n`);
  await fs.writeFile(
    path.join(target, "__init__.py"),
    [
      "def _handler(raw):",
      "    return raw",
      "",
      "def _setup(parser):",
      "    pass",
      "",
      "def register(ctx):",
      "    ctx.register_command('meet', _handler, 'Meet command')",
      "    ctx.register_cli_command('meet', 'Meet CLI', _setup, _handler, 'Meet CLI')",
      "",
    ].join("\n"),
  );
}

describe("native generated tools", () => {
  it("suffixes generated tool names that collide after sanitizing", () => {
    const tools = buildNativeToolEntries({
      installDir: "/tmp/hermes",
      plugins: [
        {
          key: "a.b",
          name: "A",
          version: "",
          description: "",
          path: "/tmp/hermes/a.b",
          tools: [
            {
              name: "shared",
              toolset: "a",
              description: "",
              schema: {},
              isAsync: false,
              requiresEnv: [],
              available: true,
            },
          ],
          hooks: [],
          middleware: [],
          commands: [],
          cliCommands: [],
          skills: [],
          auxiliaryTasks: [],
          unsupported: [],
        },
        {
          key: "a_b",
          name: "B",
          version: "",
          description: "",
          path: "/tmp/hermes/a_b",
          tools: [
            {
              name: "shared",
              toolset: "b",
              description: "",
              schema: {},
              isAsync: false,
              requiresEnv: [],
              available: true,
            },
            {
              name: "a_b__shared",
              toolset: "b",
              description: "",
              schema: {},
              isAsync: false,
              requiresEnv: [],
              available: true,
            },
          ],
          hooks: [],
          middleware: [],
          commands: [],
          cliCommands: [],
          skills: [],
          auxiliaryTasks: [],
          unsupported: [],
        },
      ],
    });

    expect(tools.map((tool) => tool.name)).toEqual([
      "a_b__shared",
      "a_b__shared_2",
      "a_b__shared_3",
    ]);
  });

  it("suffixes generated slash and CLI command names after sanitizing plugin slugs", async () => {
    const installDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-hermes-commands-"));
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-hermes-package-"));
    await Promise.all([writeCommandFixture(installDir, "a.b"), writeCommandFixture(installDir, "a_b")]);
    await fs.mkdir(path.join(root, "skills"), { recursive: true });
    await fs.writeFile(
      path.join(root, "openclaw.plugin.json"),
      JSON.stringify({ id: "hermes-plugin", contracts: {} }, null, 2),
    );

    await regenerateNativeTools(
      { installDir, python: "python3", timeoutMs: 10000, env: {} },
      { root },
    );

    const registry = JSON.parse(
      await fs.readFile(path.join(root, "hermes-tools.generated.json"), "utf8"),
    );
    expect(registry.commands.map((entry: { name: string }) => entry.name)).toEqual([
      "hermes_a_b_meet",
      "hermes_a_b_meet_2",
    ]);
    expect(registry.cliCommands.map((entry: { name: string }) => entry.name)).toEqual([
      "hermes_a_b_meet",
      "hermes_a_b_meet_2",
    ]);
  });

  it("writes generated registry and OpenClaw manifest tool contracts", async () => {
    const installDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-hermes-native-tools-"));
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-hermes-package-"));
    await copyFixture(installDir);
    await fs.mkdir(path.join(root, "skills"), { recursive: true });
    await fs.writeFile(
      path.join(root, "openclaw.plugin.json"),
      JSON.stringify(
        {
          id: "hermes-plugin",
          contracts: { agentToolResultMiddleware: ["openclaw", "codex"] },
        },
        null,
        2,
      ),
    );

    await expect(
      regenerateNativeTools(
        { installDir, python: "python3", timeoutMs: 10000, env: {} },
        { root },
      ),
    ).resolves.toEqual({
      generatedTools: ["simple_echo"],
      restartRequired: true,
    });

    const manifest = JSON.parse(await fs.readFile(path.join(root, "openclaw.plugin.json"), "utf8"));
    expect(manifest.contracts).toEqual({
      agentToolResultMiddleware: ["openclaw", "codex"],
      tools: [
        "hermes_plugins_list",
        "hermes_plugin_install",
        "hermes_plugin_uninstall",
        "simple_echo",
      ],
    });
    const registry = JSON.parse(
      await fs.readFile(path.join(root, "hermes-tools.generated.json"), "utf8"),
    );
    expect(registry.commands).toEqual([
      {
        name: "simple",
        plugin: "simple",
        originalName: "simple",
        description: "Simple command",
        argsHint: "<raw text>",
      },
    ]);
    expect(registry.cliCommands).toEqual([
      {
        name: "simplecli",
        plugin: "simple",
        originalName: "simplecli",
        description: "Simple CLI command",
        argsHint: "",
      },
    ]);
    await expect(
      fs.readFile(
        path.join(root, "skills", "hermes-generated", "hermes-simple-simple_skill", "SKILL.md"),
        "utf8",
      ),
    ).resolves.toContain("Simple Skill");
  });
});
