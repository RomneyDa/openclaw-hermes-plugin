import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { HermesBridgeConfig } from "./config.js";
import { listHermesPlugins, readHermesSkill } from "./hermes-python.js";

function packageRoot(): string {
  return path.dirname(path.dirname(fileURLToPath(import.meta.url)));
}

function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "") || "hermes"
  );
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function skillMarkdown(params: {
  name: string;
  description: string;
  plugin: string;
  skill: string;
  text: string;
}): string {
  return [
    "---",
    `name: ${params.name}`,
    `description: ${yamlString(params.description || `Hermes skill ${params.plugin}/${params.skill}`)}`,
    "---",
    "",
    params.text,
    "",
  ].join("\n");
}

export async function syncHermesSkills(
  config: HermesBridgeConfig,
  rootDir = packageRoot(),
): Promise<string[]> {
  const list = await listHermesPlugins(config);
  const written: string[] = [];
  for (const plugin of list.plugins) {
    for (const skill of plugin.skills) {
      if (!skill.available) {
        continue;
      }
      const name = `hermes-${slug(plugin.key)}-${slug(skill.name)}`;
      const loaded = await readHermesSkill(config, { plugin: plugin.key, skill: skill.name });
      const dir = path.join(rootDir, "skills", "hermes-generated", name);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(
        path.join(dir, "SKILL.md"),
        skillMarkdown({
          name,
          description: loaded.description || skill.description,
          plugin: plugin.key,
          skill: skill.name,
          text: loaded.text,
        }),
        "utf-8",
      );
      written.push(name);
    }
  }
  return written;
}
