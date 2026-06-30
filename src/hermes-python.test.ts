import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { callHermesTool, listHermesPlugins } from "./hermes-python.js";

async function copyFixture(target: string): Promise<void> {
  const fixture = path.join(process.cwd(), "test/fixtures/simple-hermes-plugin");
  await fs.cp(fixture, path.join(target, "simple"), { recursive: true });
}

describe("Hermes Python bridge", () => {
  it("lists and calls a Hermes register(ctx) tool", async () => {
    const installDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-hermes-plugin-"));
    await copyFixture(installDir);

    const config = {
      installDir,
      python: "python3",
      timeoutMs: 10000,
      env: {},
    };

    const listed = await listHermesPlugins(config);
    expect(listed.plugins).toHaveLength(1);
    expect(listed.plugins[0]?.tools.map((tool) => tool.name)).toEqual(["simple_echo"]);
    expect(listed.plugins[0]?.hooks).toEqual(["post_tool_call"]);
    expect(listed.plugins[0]?.commands).toEqual(["simple"]);

    const called = await callHermesTool(config, {
      plugin: "simple",
      tool: "simple_echo",
      args: { value: "ok" },
    });
    expect(called.parsedResult).toEqual({ echo: "ok" });
  });
});
