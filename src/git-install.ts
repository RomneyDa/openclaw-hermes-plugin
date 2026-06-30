import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type InstallHermesPluginParams = {
  installDir: string;
  source: string;
  name?: string;
  force?: boolean;
};

export type UninstallHermesPluginParams = {
  installDir: string;
  name: string;
};

function repoNameFromSource(source: string): string {
  const clean = source.trim().replace(/[#?].*$/, "").replace(/\/$/, "");
  const last = clean.split(/[/:]/).filter(Boolean).at(-1) ?? "plugin";
  return last.replace(/\.git$/, "");
}

export function sanitizePluginName(name: string): string {
  const clean = name.trim();
  if (!/^[A-Za-z0-9._-]+$/.test(clean) || clean === "." || clean === "..") {
    throw new Error("Plugin name must contain only letters, numbers, dot, underscore, or dash.");
  }
  return clean;
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.stat(target);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

export async function installHermesPlugin({
  installDir,
  source,
  name,
  force = false,
}: InstallHermesPluginParams): Promise<{ name: string; path: string }> {
  if (!source.trim()) {
    throw new Error("source required");
  }

  const pluginName = sanitizePluginName(name ?? repoNameFromSource(source));
  const target = path.join(installDir, pluginName);
  await fs.mkdir(installDir, { recursive: true });

  if (await pathExists(target)) {
    if (!force) {
      throw new Error(`Hermes plugin '${pluginName}' already exists. Pass force=true to reinstall.`);
    }
    await fs.rm(target, { recursive: true, force: true });
  }

  await execFileAsync("git", ["clone", "--depth", "1", source, target], {
    maxBuffer: 1024 * 1024,
  });

  return { name: pluginName, path: target };
}

export async function uninstallHermesPlugin({
  installDir,
  name,
}: UninstallHermesPluginParams): Promise<{ name: string; path: string }> {
  const pluginName = sanitizePluginName(name);
  const target = path.join(installDir, pluginName);
  if (!(await pathExists(target))) {
    throw new Error(`Hermes plugin '${pluginName}' is not installed.`);
  }
  await fs.rm(target, { recursive: true, force: true });
  return { name: pluginName, path: target };
}
