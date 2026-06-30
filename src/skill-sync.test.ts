import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { syncHermesSkills } from "./skill-sync.js";

async function copyFixture(target: string): Promise<void> {
  const fixture = path.join(process.cwd(), "test/fixtures/simple-hermes-plugin");
  await fs.cp(fixture, path.join(target, "simple"), { recursive: true });
}

describe("syncHermesSkills", () => {
  it("writes Hermes skills as OpenClaw SKILL.md files", async () => {
    const installDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-hermes-skills-"));
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-hermes-package-"));
    await copyFixture(installDir);

    const written = await syncHermesSkills(
      { installDir, python: "python3", timeoutMs: 10000, env: {} },
      rootDir,
    );

    expect(written).toEqual(["hermes-simple-simple_skill"]);
    const markdown = await fs.readFile(
      path.join(rootDir, "skills", "hermes-generated", "hermes-simple-simple_skill", "SKILL.md"),
      "utf-8",
    );
    expect(markdown).toContain("name: hermes-simple-simple_skill");
    expect(markdown).toContain("Simple Skill");
  });

  it("removes stale generated skills", async () => {
    const installDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-hermes-skills-"));
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-hermes-package-"));
    const staleDir = path.join(rootDir, "skills", "hermes-generated", "old");
    await fs.mkdir(staleDir, { recursive: true });
    await fs.writeFile(path.join(staleDir, "SKILL.md"), "old", "utf-8");
    await copyFixture(installDir);

    await syncHermesSkills({ installDir, python: "python3", timeoutMs: 10000, env: {} }, rootDir);

    await expect(fs.stat(staleDir)).rejects.toThrow();
  });

  it("suffixes generated skill slug collisions", async () => {
    const installDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-hermes-skills-"));
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-hermes-package-"));
    const fixture = path.join(process.cwd(), "test/fixtures/simple-hermes-plugin");
    await fs.cp(fixture, path.join(installDir, "a.b"), { recursive: true });
    await fs.cp(fixture, path.join(installDir, "a-b"), { recursive: true });

    await expect(
      syncHermesSkills({ installDir, python: "python3", timeoutMs: 10000, env: {} }, rootDir),
    ).resolves.toEqual(["hermes-a-b-simple_skill", "hermes-a-b-simple_skill-2"]);
  });
});
