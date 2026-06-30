# OpenClaw Hermes Plugin Bridge

OpenClaw bundle that exposes installed Hermes Agent Python plugin tools through
OpenClaw's existing bundle-MCP support.

After this package is installed and enabled as an OpenClaw plugin bundle,
OpenClaw automatically launches the bundled MCP server during agent turns. You
do not need to start a separate server command.

## What Maps

| Hermes surface | OpenClaw behavior |
| --- | --- |
| `ctx.register_tool(...)` | Exposed as MCP tools through OpenClaw `bundle-mcp`. |
| Tool JSON schemas | Passed through to MCP `tools/list` when Hermes provides a schema. |
| Tool calls | Routed back to the Python Hermes plugin callable. |
| Hooks, middleware, commands, skills | Listed by the bridge for inspection, not executed natively. |
| Provider/platform/dashboard/native host surfaces | Reported as unsupported. |

Unique Hermes tool names stay unchanged. Colliding names become
`<plugin>__<tool>`.

## Install

```bash
npm install
npm run build
openclaw plugins install --link .
```

Then enable the bundle:

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

OpenClaw loads the MCP server from `.mcp.json`:

```json
{
  "mcpServers": {
    "hermes": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/dist/bin.js", "mcp"],
      "transport": "stdio"
    }
  }
}
```

The default Hermes plugin install directory is
`~/.openclaw/hermes-plugins`. The default Python executable is `python3`.
Override them through MCP server env config if needed:

```jsonc
{
  "mcp": {
    "servers": {
      "hermes": {
        "env": {
          "OPENCLAW_HERMES_PLUGIN_DIR": "/path/to/hermes-plugins",
          "OPENCLAW_HERMES_PYTHON": "/path/to/python3",
          "OPENCLAW_HERMES_TIMEOUT_MS": "120000"
        }
      }
    }
  }
}
```

The Python environment must be able to import whatever each Hermes plugin
imports. For plugins that import Hermes internals, install `hermes-agent` in the
selected Python environment.

## CLI

The bundled binary is still useful for local diagnostics:

```bash
openclaw-hermes-plugin install https://github.com/owner/hermes-plugin-example.git
openclaw-hermes-plugin list
openclaw-hermes-plugin mcp
```

## Checks

```bash
npm run check
```
