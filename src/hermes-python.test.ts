import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  callHermesCommand,
  callHermesTool,
  listHermesPlugins,
  readHermesSkill,
} from "./hermes-python.js";

async function copyFixture(target: string): Promise<void> {
  const fixture = path.join(process.cwd(), "test/fixtures/simple-hermes-plugin");
  await fs.cp(fixture, path.join(target, "simple"), { recursive: true });
}

async function copyRelativeFixture(target: string): Promise<void> {
  const fixture = path.join(process.cwd(), "test/fixtures/relative-hermes-plugin");
  await fs.cp(fixture, path.join(target, "relative"), { recursive: true });
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
    expect(listed.plugins[0]?.commands.map((command) => command.name)).toEqual(["simple"]);
    expect(listed.plugins[0]?.skills.map((skill) => skill.name)).toEqual(["simple_skill"]);

    const called = await callHermesTool(config, {
      plugin: "simple",
      tool: "simple_echo",
      args: { value: "ok" },
    });
    expect(called.parsedResult).toEqual({ echo: "ok" });

    await expect(
      callHermesCommand(config, {
        plugin: "simple",
        command: "simple",
        args: "raw",
      }),
    ).resolves.toMatchObject({ result: { command: "raw" } });

    await expect(
      readHermesSkill(config, { plugin: "simple", skill: "simple_skill" }),
    ).resolves.toMatchObject({ text: expect.stringContaining("Simple Skill") });
  });

  it("loads Hermes plugins that use package-relative imports", async () => {
    const installDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-hermes-plugin-"));
    await copyRelativeFixture(installDir);

    const config = {
      installDir,
      python: "python3",
      timeoutMs: 10000,
      env: {},
    };

    const listed = await listHermesPlugins(config);
    expect(listed.plugins[0]?.error).toBeUndefined();
    expect(listed.plugins[0]?.tools.map((tool) => tool.name)).toEqual(["relative_echo"]);

    const called = await callHermesTool(config, {
      plugin: "relative",
      tool: "relative_echo",
      args: { value: "ok" },
    });
    expect(called.result).toEqual({ echo: "ok" });
  });
});
