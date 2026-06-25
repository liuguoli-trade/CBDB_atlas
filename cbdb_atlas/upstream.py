"""Resolve optional cbdb_sqlite upstream (git submodule at vendor/cbdb_sqlite)."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any

UPSTREAM_REPO = "https://github.com/cbdb-project/cbdb_sqlite.git"
SUBMODULE_REL = Path("vendor") / "cbdb_sqlite"


def _looks_like_upstream(root: Path) -> bool:
    return (root / "latest.json").is_file() and (root / "scripts").is_dir()


def resolve_upstream_root(project_root: Path) -> Path | None:
    """Return local cbdb_sqlite tree when vendor submodule is initialized."""
    project_root = project_root.resolve()
    candidate = (project_root / SUBMODULE_REL).resolve()
    if _looks_like_upstream(candidate):
        return candidate
    return None


def upstream_latest_json(project_root: Path) -> Path | None:
    root = resolve_upstream_root(project_root)
    if root is None:
        return None
    path = root / "latest.json"
    return path if path.is_file() else None


def upstream_create_views_script(project_root: Path) -> Path | None:
    root = resolve_upstream_root(project_root)
    if root is not None:
        script = root / "scripts" / "create_views.sh"
        if script.is_file():
            return script
    bundled = project_root / "scripts" / "create_views.sh"
    return bundled if bundled.is_file() else None


def upstream_status(project_root: Path) -> dict[str, Any]:
    project_root = project_root.resolve()
    root = resolve_upstream_root(project_root)
    submodule_path = (project_root / SUBMODULE_REL).resolve()
    is_submodule = root is not None and root == submodule_path
    commit: str | None = None
    if is_submodule and (root / ".git").exists():
        try:
            out = subprocess.check_output(
                ["git", "-C", str(root), "rev-parse", "--short", "HEAD"],
                text=True,
                stderr=subprocess.DEVNULL,
            )
            commit = out.strip() or None
        except (subprocess.CalledProcessError, FileNotFoundError, OSError):
            commit = None
    latest = upstream_latest_json(project_root)
    latest_data: dict[str, Any] | None = None
    if latest is not None:
        try:
            latest_data = json.loads(latest.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            latest_data = None
    return {
        "repo": UPSTREAM_REPO,
        "root": str(root) if root else None,
        "is_submodule": is_submodule,
        "submodule_path": str(submodule_path),
        "submodule_initialized": is_submodule,
        "commit": commit,
        "latest_json": str(latest) if latest else None,
        "release": latest_data,
    }


def sync_upstream_submodule(project_root: Path, *, depth: int = 1) -> tuple[bool, str]:
    """Run git submodule update --init --remote for vendor/cbdb_sqlite."""
    repo_root = project_root.resolve()
    gitmodules = repo_root / ".gitmodules"
    if not gitmodules.is_file():
        return False, f"未找到 .gitmodules：{repo_root}（可選子模塊 vendor/cbdb_sqlite）"

    init = ["git", "submodule", "update", "--init", f"--depth={depth}", "vendor/cbdb_sqlite"]
    try:
        subprocess.run(init, cwd=repo_root, check=True, capture_output=True, text=True)
        remote = subprocess.run(
            ["git", "submodule", "update", "--remote", "vendor/cbdb_sqlite"],
            cwd=repo_root,
            check=True,
            capture_output=True,
            text=True,
        )
        msg = (remote.stdout or "").strip() or "子模塊已同步到上游最新提交"
        return True, msg
    except subprocess.CalledProcessError as exc:
        detail = (exc.stderr or exc.stdout or str(exc)).strip()
        return False, detail or "git submodule 失敗"
