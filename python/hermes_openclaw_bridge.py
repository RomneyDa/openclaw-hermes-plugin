#!/usr/bin/env python3
"""Load Hermes Agent Python plugins for the OpenClaw Hermes bridge.

Input and output are JSON over stdio. This helper intentionally implements the
smallest Hermes host facade needed by OpenClaw:

- ctx.register_tool(...) is callable through hermes_tool_call.
- hooks, middleware, commands, and skills are visible in hermes_plugins_list.
- provider/platform/dashboard/native registrations are listed as unsupported.
"""

from __future__ import annotations

import asyncio
import importlib.util
import json
import os
import sys
import traceback
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable


def _load_yaml(path: Path) -> dict[str, Any]:
    try:
        import yaml  # type: ignore

        data = yaml.safe_load(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return _load_simple_yaml(path)


def _load_simple_yaml(path: Path) -> dict[str, Any]:
    data: dict[str, Any] = {}
    current_list: str | None = None
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.rstrip()
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if stripped.startswith("- ") and current_list:
            data.setdefault(current_list, []).append(stripped[2:].strip().strip("\"'"))
            continue
        current_list = None
        if ":" not in stripped:
            continue
        key, _, value = stripped.partition(":")
        key = key.strip()
        value = value.strip()
        if not value:
            data[key] = []
            current_list = key
        elif value.startswith("[") and value.endswith("]"):
            data[key] = [
                item.strip().strip("\"'")
                for item in value[1:-1].split(",")
                if item.strip()
            ]
        else:
            data[key] = value.strip("\"'")
    return data


def _jsonable(value: Any) -> Any:
    try:
        json.dumps(value)
        return value
    except TypeError:
        return repr(value)


@dataclass
class ToolRecord:
    name: str
    toolset: str
    schema: dict[str, Any]
    handler: Callable[..., Any]
    check_fn: Callable[..., Any] | None = None
    requires_env: list[str] = field(default_factory=list)
    is_async: bool = False
    description: str = ""
    emoji: str = ""

    def summary(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "toolset": self.toolset,
            "description": self.description or str(self.schema.get("description") or ""),
            "schema": _jsonable(self.schema),
            "isAsync": self.is_async,
            "requiresEnv": self.requires_env,
            "available": self.available(),
        }

    def available(self) -> bool:
        if self.requires_env and any(not os.getenv(name) for name in self.requires_env):
            return False
        if self.check_fn is None:
            return True
        try:
            return bool(self.check_fn())
        except Exception:
            return False


class RecordingContext:
    def __init__(self, manifest: dict[str, Any], key: str):
        self.manifest = manifest
        self.key = key
        self.tools: list[ToolRecord] = []
        self.hooks: list[str] = []
        self.middleware: list[str] = []
        self.commands: list[str] = []
        self.skills: list[str] = []
        self.unsupported: list[str] = []

    @property
    def profile_name(self) -> str:
        return os.environ.get("HERMES_PROFILE", "default")

    def register_tool(
        self,
        name: str,
        toolset: str,
        schema: dict[str, Any],
        handler: Callable[..., Any],
        check_fn: Callable[..., Any] | None = None,
        requires_env: list[str] | None = None,
        is_async: bool = False,
        description: str = "",
        emoji: str = "",
        **_: Any,
    ) -> None:
        self.tools.append(
            ToolRecord(
                name=name,
                toolset=toolset,
                schema=schema,
                handler=handler,
                check_fn=check_fn,
                requires_env=list(requires_env or []),
                is_async=is_async,
                description=description,
                emoji=emoji,
            )
        )

    def register_hook(self, hook_name: str, callback: Callable[..., Any]) -> None:
        del callback
        self.hooks.append(hook_name)

    def register_middleware(self, kind: str, callback: Callable[..., Any]) -> None:
        del callback
        self.middleware.append(kind)

    def register_command(
        self,
        name: str,
        handler: Callable[..., Any],
        description: str = "",
        args_hint: str = "",
    ) -> None:
        del handler, description, args_hint
        self.commands.append(name.lstrip("/"))

    def register_cli_command(
        self,
        name: str,
        help: str,
        setup_fn: Callable[..., Any],
        handler_fn: Callable[..., Any] | None = None,
        description: str = "",
    ) -> None:
        del help, setup_fn, handler_fn, description
        self.commands.append(name)

    def register_skill(self, name: str, path: Path, description: str = "") -> None:
        del path, description
        self.skills.append(name)

    def register_auxiliary_task(self, key: str, **_: Any) -> None:
        self.unsupported.append(f"auxiliary_task:{key}")

    def __getattr__(self, name: str) -> Callable[..., None]:
        if name.startswith("register_"):
            def recorder(*args: Any, **kwargs: Any) -> None:
                del kwargs
                label = name.removeprefix("register_")
                detail = getattr(args[0], "name", None) if args else None
                self.unsupported.append(f"{label}:{detail}" if detail else label)

            return recorder
        raise AttributeError(name)


def _plugin_dirs(install_dir: Path) -> list[Path]:
    if not install_dir.exists():
        return []
    if (install_dir / "plugin.yaml").is_file() and (install_dir / "__init__.py").is_file():
        return [install_dir]
    return [
        child
        for child in sorted(install_dir.iterdir())
        if child.is_dir()
        and (child / "plugin.yaml").is_file()
        and (child / "__init__.py").is_file()
    ]


def _load_plugin(plugin_dir: Path) -> tuple[dict[str, Any], RecordingContext]:
    manifest = _load_yaml(plugin_dir / "plugin.yaml")
    key = plugin_dir.name
    ctx = RecordingContext(manifest, key)

    parent = str(plugin_dir.parent)
    if parent not in sys.path:
        sys.path.insert(0, parent)

    parent_name = "openclaw_hermes_plugins"
    parent_module = sys.modules.get(parent_name)
    if parent_module is None:
        import types

        parent_module = types.ModuleType(parent_name)
        parent_module.__path__ = [str(plugin_dir.parent)]  # type: ignore[attr-defined]
        sys.modules[parent_name] = parent_module

    module_name = f"{parent_name}.{key.replace('-', '_').replace('.', '_')}"
    spec = importlib.util.spec_from_file_location(
        module_name,
        plugin_dir / "__init__.py",
        submodule_search_locations=[str(plugin_dir)],
    )
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load plugin module at {plugin_dir}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)

    register = getattr(module, "register", None)
    if not callable(register):
        raise RuntimeError("Hermes plugin has no callable register(ctx)")
    register(ctx)
    return manifest, ctx


def _summarize_plugin(plugin_dir: Path) -> dict[str, Any]:
    try:
        manifest, ctx = _load_plugin(plugin_dir)
        return {
            "key": plugin_dir.name,
            "name": str(manifest.get("name") or plugin_dir.name),
            "version": str(manifest.get("version") or ""),
            "description": str(manifest.get("description") or ""),
            "path": str(plugin_dir),
            "tools": [tool.summary() for tool in ctx.tools],
            "hooks": sorted(set(ctx.hooks)),
            "middleware": sorted(set(ctx.middleware)),
            "commands": sorted(set(ctx.commands)),
            "skills": sorted(set(ctx.skills)),
            "unsupported": sorted(set(ctx.unsupported)),
        }
    except Exception as exc:
        manifest = _load_yaml(plugin_dir / "plugin.yaml")
        return {
            "key": plugin_dir.name,
            "name": str(manifest.get("name") or plugin_dir.name),
            "version": str(manifest.get("version") or ""),
            "description": str(manifest.get("description") or ""),
            "path": str(plugin_dir),
            "tools": [],
            "hooks": [],
            "middleware": [],
            "commands": [],
            "skills": [],
            "unsupported": [],
            "error": f"{type(exc).__name__}: {exc}",
        }


def _list(payload: dict[str, Any]) -> dict[str, Any]:
    install_dir = Path(str(payload["installDir"])).expanduser().resolve()
    return {
        "installDir": str(install_dir),
        "plugins": [_summarize_plugin(plugin_dir) for plugin_dir in _plugin_dirs(install_dir)],
    }


def _call(payload: dict[str, Any]) -> dict[str, Any]:
    wanted_plugin = payload.get("plugin")
    wanted_tool = str(payload["tool"])
    matches: list[tuple[Path, ToolRecord]] = []

    for plugin_dir in _plugin_dirs(Path(str(payload["installDir"])).expanduser().resolve()):
        if wanted_plugin and wanted_plugin not in {plugin_dir.name}:
            manifest = _load_yaml(plugin_dir / "plugin.yaml")
            if wanted_plugin not in {manifest.get("name"), manifest.get("key")}:
                continue
        _manifest, ctx = _load_plugin(plugin_dir)
        for tool in ctx.tools:
            if tool.name == wanted_tool:
                matches.append((plugin_dir, tool))

    if not matches:
        raise RuntimeError(f"Hermes tool not found: {wanted_tool}")
    if len(matches) > 1 and not wanted_plugin:
        names = ", ".join(plugin_dir.name for plugin_dir, _tool in matches)
        raise RuntimeError(f"Hermes tool '{wanted_tool}' is ambiguous. Specify plugin. Matches: {names}")

    plugin_dir, tool = matches[0]
    if not tool.available():
        raise RuntimeError(f"Hermes tool '{wanted_tool}' is unavailable; check required env or check_fn.")

    args = payload.get("args")
    if not isinstance(args, dict):
        args = {}
    if tool.is_async:
        result = asyncio.run(tool.handler(args))
    else:
        result = tool.handler(args)

    response: dict[str, Any] = {
        "plugin": plugin_dir.name,
        "tool": tool.name,
        "result": _jsonable(result),
    }
    if isinstance(result, str):
        try:
            response["parsedResult"] = json.loads(result)
        except Exception:
            pass
    return response


def main() -> int:
    try:
        payload = json.loads(sys.stdin.read() or "{}")
        op = payload.get("op")
        if op == "list":
            result = _list(payload)
        elif op == "call":
            result = _call(payload)
        else:
            raise RuntimeError(f"Unknown operation: {op}")
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except Exception as exc:
        print(f"{type(exc).__name__}: {exc}", file=sys.stderr)
        if os.environ.get("OPENCLAW_HERMES_PLUGIN_DEBUG"):
            traceback.print_exc(file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
