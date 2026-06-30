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

export type HermesAuxiliaryTaskSummary = {
  key: string;
  displayName: string;
  description: string;
  defaults: unknown;
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
  cliCommands: HermesCommandSummary[];
  skills: HermesSkillSummary[];
  auxiliaryTasks: HermesAuxiliaryTaskSummary[];
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
  stdout?: string;
  stderr?: string;
};

export type HermesSkillResult = {
  plugin: string;
  skill: string;
  description: string;
  text: string;
};

export type HermesHookResult = {
  hook: string;
  invoked: Array<{ plugin: string; hook: string }>;
  results: unknown[];
};

export type HermesMiddlewareResult = {
  middleware: string;
  invoked: Array<{ plugin: string; middleware: string }>;
  results: unknown[];
};

export type HermesRuntimeContext = {
  workspace?: string;
  sessionId?: string;
  sessionKey?: string;
  agentId?: string;
  model?: string;
  provider?: string;
  env?: Record<string, string>;
};

type BridgeRequest =
  | { op: "list"; installDir: string }
  | {
      op: "call";
      installDir: string;
      plugin?: string;
      tool: string;
      args: unknown;
      context?: HermesRuntimeContext;
    }
  | {
      op: "command";
      installDir: string;
      plugin?: string;
      command: string;
      args: unknown;
      context?: HermesRuntimeContext;
    }
  | {
      op: "cliCommand";
      installDir: string;
      plugin?: string;
      command: string;
      args: string[];
      context?: HermesRuntimeContext;
    }
  | { op: "skill"; installDir: string; plugin?: string; skill: string }
  | {
      op: "hook";
      installDir: string;
      hook: string;
      kwargs: Record<string, unknown>;
      context?: HermesRuntimeContext;
    }
  | {
      op: "middleware";
      installDir: string;
      kind: string;
      kwargs: Record<string, unknown>;
      context?: HermesRuntimeContext;
    };

function runHelper<T>(
  config: HermesBridgeConfig,
  request: BridgeRequest,
  options: { signal?: AbortSignal } = {},
): Promise<T> {
  return new Promise((resolve, reject) => {
    const child = spawn(config.python, [helperPath], {
      env: { ...process.env, ...config.env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Hermes Python bridge timed out after ${config.timeoutMs}ms`));
    }, config.timeoutMs);
    const abort = () => {
      child.kill("SIGTERM");
      reject(new Error("Hermes Python bridge call cancelled"));
    };
    options.signal?.addEventListener("abort", abort, { once: true });

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
      options.signal?.removeEventListener("abort", abort);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      if (options.signal?.aborted) {
        return;
      }
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
  params: { plugin?: string; tool: string; args: unknown; context?: HermesRuntimeContext },
  options?: { signal?: AbortSignal },
): Promise<HermesCallResult> {
  return runHelper(config, {
    op: "call",
    installDir: config.installDir,
    plugin: params.plugin,
    tool: params.tool,
    args: params.args,
    context: params.context,
  }, options);
}

export function callHermesCommand(
  config: HermesBridgeConfig,
  params: { plugin?: string; command: string; args: unknown; context?: HermesRuntimeContext },
  options?: { signal?: AbortSignal },
): Promise<HermesCommandResult> {
  return runHelper(config, {
    op: "command",
    installDir: config.installDir,
    plugin: params.plugin,
    command: params.command,
    args: params.args,
    context: params.context,
  }, options);
}

export function callHermesCliCommand(
  config: HermesBridgeConfig,
  params: { plugin?: string; command: string; args: string[]; context?: HermesRuntimeContext },
  options?: { signal?: AbortSignal },
): Promise<HermesCommandResult> {
  return runHelper(config, {
    op: "cliCommand",
    installDir: config.installDir,
    plugin: params.plugin,
    command: params.command,
    args: params.args,
    context: params.context,
  }, options);
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

export function invokeHermesHook(
  config: HermesBridgeConfig,
  params: { hook: string; kwargs: Record<string, unknown>; context?: HermesRuntimeContext },
): Promise<HermesHookResult> {
  return runHelper(config, {
    op: "hook",
    installDir: config.installDir,
    hook: params.hook,
    kwargs: params.kwargs,
    context: params.context,
  });
}

export function invokeHermesMiddleware(
  config: HermesBridgeConfig,
  params: { kind: string; kwargs: Record<string, unknown>; context?: HermesRuntimeContext },
): Promise<HermesMiddlewareResult> {
  return runHelper(config, {
    op: "middleware",
    installDir: config.installDir,
    kind: params.kind,
    kwargs: params.kwargs,
    context: params.context,
  });
}
