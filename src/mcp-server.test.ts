import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildHermesMcpToolIndex, createHermesMcpServer } from "./mcp-server.js";

async function copyFixture(target: string, fixtureName: string, installedName: string): Promise<void> {
  const fixture = path.join(process.cwd(), "test/fixtures", fixtureName);
  await fs.cp(fixture, path.join(target, installedName), { recursive: true });
}

describe("Hermes MCP server", () => {
  it("keeps unique tool names and prefixes collisions", () => {
    const index = buildHermesMcpToolIndex({
      installDir: "/tmp/hermes",
      plugins: [
        {
          key: "one",
          name: "one",
          version: "",
          description: "",
          path: "/tmp/hermes/one",
          tools: [
            {
              name: "shared",
              toolset: "one",
              description: "one shared",
              schema: { parameters: { type: "object", properties: {} } },
              isAsync: false,
              requiresEnv: [],
              available: true,
            },
            {
              name: "unique",
              toolset: "one",
              description: "unique",
              schema: { parameters: { type: "object", properties: {} } },
              isAsync: false,
              requiresEnv: [],
              available: true,
            },
          ],
          hooks: [],
          middleware: [],
          commands: [],
          skills: [],
          unsupported: [],
        },
        {
          key: "two",
          name: "two",
          version: "",
          description: "",
          path: "/tmp/hermes/two",
          tools: [
            {
              name: "shared",
              toolset: "two",
              description: "two shared",
              schema: { parameters: { type: "object", properties: {} } },
              isAsync: false,
              requiresEnv: [],
              available: true,
            },
          ],
          hooks: [],
          middleware: [],
          commands: [],
          skills: [],
          unsupported: [],
        },
      ],
    });

    expect(index.tools.map((tool) => tool.name)).toEqual(["one__shared", "two__shared", "unique"]);
  });

  it("serves installed Hermes tools over MCP", async () => {
    const installDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-hermes-mcp-"));
    await copyFixture(installDir, "simple-hermes-plugin", "simple");

    const server = createHermesMcpServer({
      installDir,
      python: "python3",
      timeoutMs: 10000,
      env: {},
    });
    const client = new Client({ name: "test", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toEqual([
        "hermes_plugins_list",
        "hermes_plugin_install",
        "hermes_skill_read",
        "hermes_command__simple__simple",
        "simple_echo",
      ]);

      const result = await client.callTool({
        name: "simple_echo",
        arguments: { value: "mcp-ok" },
      });
      expect(result.content).toEqual([{ type: "text", text: '{\n  "echo": "mcp-ok"\n}' }]);

      await expect(
        client.callTool({
          name: "hermes_command__simple__simple",
          arguments: { args: "from-command" },
        }),
      ).resolves.toMatchObject({
        content: [{ type: "text", text: '{\n  "command": "from-command"\n}' }],
      });

      await expect(
        client.callTool({
          name: "hermes_skill_read",
          arguments: { plugin: "simple", skill: "simple_skill" },
        }),
      ).resolves.toMatchObject({
        content: [{ type: "text", text: expect.stringContaining("Simple Skill") }],
      });

      const prompts = await client.listPrompts();
      expect(prompts.prompts.map((prompt) => prompt.name)).toEqual(["simple__simple_skill"]);
      await expect(client.getPrompt({ name: "simple__simple_skill" })).resolves.toMatchObject({
        messages: [{ role: "user", content: { type: "text", text: expect.stringContaining("Simple Skill") } }],
      });

      const resources = await client.listResources();
      expect(resources.resources.map((resource) => resource.uri)).toEqual([
        "hermes-skill://simple/simple_skill",
      ]);
      await expect(
        client.readResource({ uri: "hermes-skill://simple/simple_skill" }),
      ).resolves.toMatchObject({
        contents: [
          {
            uri: "hermes-skill://simple/simple_skill",
            text: expect.stringContaining("Simple Skill"),
          },
        ],
      });
    } finally {
      await client.close();
      await server.close();
    }
  });
});
