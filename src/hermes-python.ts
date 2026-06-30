import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { HermesBridgeConfig } from "./config.js";

const helperPath = fileURLToPath(new URL("../python/hermes_openclaw_bridge.py", import.meta.url));

export type HermesToolSummary = {
  name: string;
  toolset: string;
  description: string;
  schema: unknown;
  isAsync: boolean;
  requiresEnv: string[];
  available: boolean;
};

export type HermesCommandSummary = {
  name: string;
  description: string;
  argsHint: string;
  available: boolean;
};

export type HermesSkillSummary = {
  name: string;
  description: string;
  path: string;
  available: boolean;
};

export type HermesPluginSummary = {
  key: string;
  name: string;
  version: string;
  description: string;
  path: string;
  tools: HermesToolSummary[];
  hooks: string[];
  middleware: string[];
  commands: HermesCommandSummary[];
  skills: HermesSkillSummary[];
  unsupported: string[];
  error?: string;
};

export type HermesListResult = {
  installDir: string;
  plugins: HermesPluginSummary[];
};

export type HermesCallResult = {
  plugin: string;
  tool: string;
  result: unknown;
  parsedResult?: unknown;
};

export type HermesCommandResult = {
  plugin: string;
  command: string;
  result: unknown;
};

export type HermesSkillResult = {
  plugin: string;
  skill: string;
  description: string;
  text: string;
};

type BridgeRequest =
  | { op: "list"; installDir: string }
  | { op: "call"; installDir: string; plugin?: string; tool: string; args: unknown }
  | { op: "command"; installDir: string; plugin?: string; command: string; args: unknown }
  | { op: "skill"; installDir: string; plugin?: string; skill: string };

function runHelper<T>(config: HermesBridgeConfig, request: BridgeRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    const child = spawn(config.python, [helperPath], {
      env: { ...process.env, ...config.env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Hermes Python bridge timed out after ${config.timeoutMs}ms`));
    }, config.timeoutMs);

    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(stderr.trim() || `Hermes Python bridge exited with ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout) as T);
      } catch (error) {
        reject(new Error(`Hermes Python bridge returned invalid JSON: ${(error as Error).message}`));
      }
    });

    child.stdin.end(JSON.stringify(request));
  });
}

export function listHermesPlugins(config: HermesBridgeConfig): Promise<HermesListResult> {
  return runHelper(config, { op: "list", installDir: config.installDir });
}

export function callHermesTool(
  config: HermesBridgeConfig,
  params: { plugin?: string; tool: string; args: unknown },
): Promise<HermesCallResult> {
  return runHelper(config, {
    op: "call",
    installDir: config.installDir,
    plugin: params.plugin,
    tool: params.tool,
    args: params.args,
  });
}

export function callHermesCommand(
  config: HermesBridgeConfig,
  params: { plugin?: string; command: string; args: unknown },
): Promise<HermesCommandResult> {
  return runHelper(config, {
    op: "command",
    installDir: config.installDir,
    plugin: params.plugin,
    command: params.command,
    args: params.args,
  });
}

export function readHermesSkill(
  config: HermesBridgeConfig,
  params: { plugin?: string; skill: string },
): Promise<HermesSkillResult> {
  return runHelper(config, {
    op: "skill",
    installDir: config.installDir,
    plugin: params.plugin,
    skill: params.skill,
  });
}
