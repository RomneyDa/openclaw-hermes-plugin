import json
from pathlib import Path


ECHO_SCHEMA = {
    "name": "simple_echo",
    "description": "Echo a value.",
    "parameters": {
        "type": "object",
        "properties": {"value": {"type": "string"}},
        "required": ["value"],
    },
}


def _echo(args):
    return json.dumps({"echo": args.get("value", "")})


def _hook(**kwargs):
    return None


def register(ctx):
    ctx.register_tool(
        name="simple_echo",
        toolset="simple",
        schema=ECHO_SCHEMA,
        handler=_echo,
    )
    ctx.register_hook("post_tool_call", _hook)
    ctx.register_command("simple", lambda raw: {"command": raw})
    ctx.register_skill("simple_skill", Path("skills/simple.md"), "Simple skill fixture")
