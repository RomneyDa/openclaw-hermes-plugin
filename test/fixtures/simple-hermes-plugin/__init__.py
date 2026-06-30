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
    if set(args) != {"value"}:
        return json.dumps({"unexpected": sorted(args)})
    return json.dumps({"echo": args.get("value", "")})


def _hook(**kwargs):
    return None


def _no_arg_hook():
    return "no-arg"


def _rewrite_before_block(**kwargs):
    if kwargs.get("tool_name") == "blocked":
        return {"args": {"value": "rewritten"}}
    return None


def _pre_tool(**kwargs):
    if kwargs.get("tool_name") == "blocked":
        return {"action": "block", "message": "blocked"}
    return None


def _transform(**kwargs):
    if kwargs.get("tool_name") == "simple_echo":
        return "transformed"
    return None


def _context(**kwargs):
    return {"context": "fixture context"}


def _setup_cli(parser):
    parser.add_argument("value")


def _cli_command(args):
    print(f"printed:{args.value}")
    return {"cli": args.value}


def register(ctx):
    ctx.register_tool(
        name="simple_echo",
        toolset="simple",
        schema=ECHO_SCHEMA,
        handler=_echo,
    )
    ctx.register_hook("post_tool_call", _hook)
    ctx.register_hook("post_tool_call", _no_arg_hook)
    ctx.register_hook("pre_tool_call", _rewrite_before_block)
    ctx.register_hook("pre_tool_call", _pre_tool)
    ctx.register_hook("transform_tool_result", _transform)
    ctx.register_hook("pre_llm_call", _context)
    ctx.register_command("simple", lambda raw: {"command": raw}, "Simple command", "<raw text>")
    ctx.register_cli_command(
        "simplecli",
        "Simple CLI command",
        _setup_cli,
        _cli_command,
        "Simple CLI command",
    )
    ctx.register_skill("simple_skill", Path("skills/simple.md"), "Simple skill fixture")
