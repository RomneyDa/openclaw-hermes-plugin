# OpenClaw Hermes Plugin Bridge

OpenClaw plugin that installs and calls Hermes Agent Python plugins.

It exposes a fixed OpenClaw surface:

| Tool | Purpose |
| --- | --- |
| `hermes_plugins_list` | Show installed Hermes plugins, tools, hooks, commands, skills, and unsupported surfaces. |
| `hermes_tool_call` | Call a Hermes tool registered with `ctx.register_tool(...)`. |
| `hermes_plugin_install` | Clone a Hermes plugin Git repo into the bridge install directory. |

It also exposes a stdio MCP server:

```bash
openclaw hermes-plugin mcp
```

That server maps every installed Hermes `ctx.register_tool(...)` tool into MCP
`tools/list` and routes MCP `tools/call` back to the Python plugin. Unique
Hermes tool names stay unchanged. Colliding names become
`<plugin>__<tool>`.

## Why tools are wrapped

Hermes plugins register arbitrary Python tool names at runtime. OpenClaw plugin manifests require static tool ownership before plugin code loads, so this bridge cannot safely expose every Hermes tool as a first-class OpenClaw tool after install. It uses `hermes_tool_call` as the stable OpenClaw tool and passes `{ plugin, tool, args }` to the Python plugin.

Mapped:

- `ctx.register_tool(...)` -> callable through `hermes_tool_call`
- `ctx.register_hook(...)`, `ctx.register_middleware(...)`, commands, skills -> listed for inspection
- provider/platform/dashboard/native host registrations -> reported as `unsupported`

## Install

```bash
npm install
npm run build
openclaw plugins install --link .
```

Enable the bridge and allow its optional tools for the agent that should use it:

```jsonc
{
  "agents": {
    "list": [
      {
        "id": "main",
        "tools": {
          "alsoAllow": [
            "hermes_plugins_list",
            "hermes_tool_call",
            "hermes_plugin_install"
          ]
        }
      }
    ]
  },
  "plugins": {
    "entries": {
      "hermes-plugin": {
        "enabled": true,
        "config": {
          "installDir": "~/.openclaw/hermes-plugins",
          "python": "python3",
          "timeoutMs": 120000
        }
      }
    }
  }
}
```

The Python environment must be able to import whatever the Hermes plugin imports. For plugins that use Hermes internals, install `hermes-agent` in the selected Python environment.

## CLI

```bash
openclaw hermes-plugin install https://github.com/owner/hermes-plugin-example.git
openclaw hermes-plugin list
openclaw hermes-plugin mcp
```

Add it to an MCP client as a stdio server whose command is `openclaw` and args
are `["hermes-plugin", "mcp"]`.

## Tool calls

Install from an agent:

```json
{
  "source": "https://github.com/owner/hermes-plugin-example.git",
  "name": "example"
}
```

Call a Hermes tool:

```json
{
  "plugin": "example",
  "tool": "example_search",
  "args": {
    "query": "openclaw"
  }
}
```

## Checks

```bash
npm run check
```
