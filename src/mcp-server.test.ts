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
          cliCommands: [],
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
          cliCommands: [],
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
        "hermes_task_start",
        "hermes_task_status",
        "hermes_task_stop",
        "hermes_command__simple__simple",
        "simple_echo",
      ]);
      expect(
        tools.tools.find((tool) => tool.name === "hermes_command__simple__simple")?.description,
      ).toContain("Args: <raw text>");

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

      const started = await client.callTool({
        name: "hermes_task_start",
        arguments: { kind: "tool", name: "simple_echo", args: { value: "task-ok" } },
      });
      const task = JSON.parse(String(started.content?.[0]?.text));
      expect(task.status).toBe("running");

      let finalStatus = "running";
      for (let attempt = 0; attempt < 20 && finalStatus === "running"; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        const status = await client.callTool({
          name: "hermes_task_status",
          arguments: { id: task.id },
        });
        finalStatus = JSON.parse(String(status.content?.[0]?.text)).status;
      }
      expect(finalStatus).toBe("completed");
    } finally {
      await client.close();
      await server.close();
    }
  });
});
