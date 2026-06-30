# OpenClaw Hermes Plugin Bridge

OpenClaw bridge for installed Hermes Agent Python plugins.

The default install path is a native OpenClaw plugin. It registers Hermes hooks
directly, exposes Hermes tools as generated native OpenClaw tools after
restart, maps Hermes slash commands to OpenClaw plugin commands, and maps
Hermes CLI commands to generated `openclaw <command>` CLI roots. A manual MCP
alternative lives under `mcp/`, but it is not activated by the default package
install.

## Quick Mapping

Hermes plugin surfaces are mapped to OpenClaw surfaces like this:

- Hermes tools become generated native OpenClaw tools. The bridge keeps their
  JSON schemas and calls the original Python handler.
- Hermes slash commands from `ctx.register_command(...)` become OpenClaw plugin
  commands, so users can invoke them as slash/native commands.
- Hermes terminal commands from `ctx.register_cli_command(...)` become
  generated OpenClaw CLI commands such as `openclaw meet ...`.
- Hermes skills become generated OpenClaw `SKILL.md` files under `skills/`.
- Hermes lifecycle and tool hooks become native OpenClaw plugin hooks where
  OpenClaw has a matching event.
- Hermes result-transform hooks become OpenClaw tool-result middleware.
- Hermes middleware is invoked only when OpenClaw has an equivalent hook or
  middleware seam.
- Hermes background tasks are available only through the manual MCP alternative:
  `hermes_task_start`, `hermes_task_status`, and `hermes_task_stop`.
- Hermes surfaces with no good OpenClaw equivalent are listed or warned about,
  not faked.

Hermes tool and command names are static in OpenClaw. `hermes_plugin_install` and
`hermes_plugin_uninstall` update `openclaw.plugin.json` and
`hermes-tools.generated.json`; restart or reload OpenClaw before the new tool,
slash-command, and CLI-command set is visible.

OpenClaw gates conversation-content hooks for external plugins. For full
message/run hook coverage, enable:

```jsonc
{
  "plugins": {
    "entries": {
      "hermes-plugin": {
        "hooks": {
          "allowConversationAccess": true
        }
      }
    }
  }
}
```

## What Maps

| Hermes surface | OpenClaw behavior |
| --- | --- |
| `ctx.register_tool(...)` | Exposed as generated native OpenClaw tools after restart/reload. |
| Tool JSON schemas | Stored in the generated native tool registry when Hermes provides a schema. |
| Tool calls | Routed back to the Python Hermes plugin callable. |
| `ctx.register_command(...)` | Exposed as OpenClaw plugin slash/native commands with descriptions and arg hints. |
| `ctx.register_cli_command(...)` | Exposed as generated `openclaw <command>` CLI roots. Duplicate Hermes names are prefixed with the plugin slug. |
| `ctx.register_skill(...)` | Synced to generated OpenClaw `SKILL.md` files under the bundle `skills/` root. |
| `pre_tool_call` / `post_tool_call` | Mapped to OpenClaw `before_tool_call` / `after_tool_call` hooks. |
| `transform_tool_result` / `transform_terminal_output` | Mapped through OpenClaw tool-result middleware. |
| `pre_llm_call` / `post_llm_call` | Mapped to OpenClaw turn prep and LLM output hooks. |
| `pre_api_request` / `post_api_request` / `api_request_error` | Mapped to OpenClaw model-call hooks. |
| `on_session_start` / `on_session_end` / `on_session_finalize` / `on_session_reset` | Mapped to OpenClaw session/run lifecycle hooks. |
| `subagent_start` / `subagent_stop` | Mapped to OpenClaw subagent lifecycle hooks. |
| `pre_gateway_dispatch` | Can skip/handle through OpenClaw `before_dispatch`; rewrite is not faked. |
| `pre_approval_request`, `post_approval_response`, `kanban_task_*` | Warned as unsupported. |
| Middleware | `tool_request`, `tool_execution`, `llm_request`, and `llm_execution` are invoked only where OpenClaw has matching hook/middleware seams. |
| Background work | Manual MCP alternative only: `hermes_task_start`, `hermes_task_status`, and `hermes_task_stop`; no scheduler daemon. |
| Provider/platform/dashboard/native host surfaces | Reported as unsupported. |

Unique Hermes tool names stay unchanged. Colliding names become
`<plugin>__<tool>`.

## Install

```bash
npm install
npm run build
openclaw plugins install --link .
```

Then enable the plugin:

```jsonc
{
  "plugins": {
    "entries": {
      "hermes-plugin": {
        "enabled": true
      }
    }
  }
}
```

Use the native bridge tool to install Hermes plugins:

```text
hermes_plugin_install({ "source": "https://github.com/owner/hermes-plugin-example.git" })
```

Restart or reload OpenClaw after install/uninstall so the generated static tool
contracts are loaded.

After restart, Hermes CLI commands are available through OpenClaw directly. For
example, a Hermes plugin that registers `ctx.register_cli_command("meet", ...)`
contributes:

```bash
openclaw meet ...
```

The default Hermes plugin install directory is
`~/.openclaw/hermes-plugins`. The default Python executable is `python3`.
Override them through environment if needed:

```bash
export OPENCLAW_HERMES_PLUGIN_DIR=/path/to/hermes-plugins
export OPENCLAW_HERMES_PYTHON=/path/to/python3
export OPENCLAW_HERMES_TIMEOUT_MS=120000
```

The Python environment must be able to import whatever each Hermes plugin
imports. For plugins that import Hermes internals, install `hermes-agent` in the
selected Python environment.

## Manual MCP Alternative

The MCP server is still available, but it is not part of the default install
path. Its bundle metadata is under `mcp/`, and the server can be run manually:

```bash
openclaw-hermes-plugin mcp
```

## CLI

The bundled binary is only for bridge maintenance and local diagnostics:

```bash
openclaw-hermes-plugin install https://github.com/owner/hermes-plugin-example.git
openclaw-hermes-plugin uninstall hermes-plugin-example
openclaw-hermes-plugin list
openclaw-hermes-plugin mcp
```

## Real Plugin Proof

Checked against Hermes bundled plugins:

| Plugin | Result |
| --- | --- |
| `disk-cleanup` | Loaded command plus `on_session_end` and `post_tool_call` hooks. |
| `google_meet` | Loaded five tools, `meet` command, and `on_session_end`; tools were unavailable when host dependencies/checks were missing. |
| `security-guidance` | Loaded `pre_tool_call` and `transform_tool_result` hooks. |
| `teams_pipeline` | Import failed when the selected Python did not have `yaml`. |

## Checks

```bash
npm run check
```
