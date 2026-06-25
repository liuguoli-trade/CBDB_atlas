from __future__ import annotations

import argparse
import json
import os
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def ensure_dependencies() -> None:
    try:
        import fastapi  # noqa: F401
        import openpyxl  # noqa: F401
        import uvicorn  # noqa: F401
        import yaml  # noqa: F401
    except ImportError:
        print("[cbdb-atlas] 正在安裝依賴…")
        subprocess.check_call([sys.executable, "-m", "pip", "install", "-e", str(ROOT), "-q"])


def ensure_source(*, check_remote: bool = False) -> None:
    from cbdb_atlas.config import load_config
    from cbdb_atlas.source import ensure_cbdb_views, migrate_legacy_database, source_status

    cfg = load_config(project_root=ROOT)
    target = cfg.cbdb_database
    target.parent.mkdir(parents=True, exist_ok=True)

    if not target.is_file():
        if migrate_legacy_database(target):
            print(f"[cbdb-atlas] 已使用 data/source/ 內已有數據庫 → {target.name}")
        else:
            print("[cbdb-atlas] 請將 CBDB SQLite 放入 data/source/cbdb.sqlite3，或在網頁下載")

    if target.is_file():
        try:
            ensure_cbdb_views(target, cfg.project_root)
        except RuntimeError as exc:
            print(f"[cbdb-atlas] 警告：{exc}")

    if not check_remote:
        return

    status = source_status(cfg.source_dir, target, cfg.latest_json_url, cfg.project_root)
    if status.get("up_to_date"):
        print("[cbdb-atlas] CBDB 源庫已是最新")
    elif status.get("update_available"):
        print("[cbdb-atlas] 檢測到官方新版本，啟動後網頁將提示更新")


def server_url(host: str, port: int) -> str:
    return f"http://{host}:{port}/"


def probe_server(host: str, port: int, timeout: float = 2.0) -> dict | None:
    """Return JSON if CBDB Atlas is already listening."""
    for path in ("/api/ping", "/api/health"):
        url = f"http://{host}:{port}{path}"
        try:
            with urllib.request.urlopen(url, timeout=timeout) as resp:
                if resp.status == 200:
                    return json.loads(resp.read().decode())
        except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError):
            continue
    return None


def wait_for_probe(host: str, port: int, retries: int = 6, delay: float = 0.5) -> dict | None:
    for _ in range(retries):
        health = probe_server(host, port)
        if health is not None:
            return health
        time.sleep(delay)
    return None


def find_listening_pid(port: int, host: str = "127.0.0.1") -> int | None:
    needle = f"{host}:{port}"
    try:
        if sys.platform == "win32":
            out = subprocess.check_output(
                ["netstat", "-ano"],
                text=True,
                encoding="utf-8",
                errors="replace",
            )
            for line in out.splitlines():
                if needle in line and "LISTENING" in line.upper():
                    pid = int(line.split()[-1])
                    return pid if pid > 0 else None
        else:
            out = subprocess.check_output(["ss", "-ltnp"], text=True, errors="replace")
            import re

            for line in out.splitlines():
                if f":{port}" in line:
                    match = re.search(r"pid=(\d+)", line)
                    if match:
                        return int(match.group(1))
    except (subprocess.CalledProcessError, ValueError, OSError, IndexError):
        return None
    return None


def process_name(pid: int) -> str | None:
    try:
        if sys.platform == "win32":
            out = subprocess.check_output(
                ["tasklist", "/FI", f"PID eq {pid}", "/FO", "CSV", "/NH"],
                text=True,
                encoding="utf-8",
                errors="replace",
            )
            line = out.strip()
            if not line or "No tasks" in line:
                return None
            return line.split(",")[0].strip('"')
        else:
            return Path(f"/proc/{pid}/comm").read_text(encoding="utf-8").strip()
    except (subprocess.CalledProcessError, OSError):
        return None


def terminate_pid(pid: int) -> bool:
    try:
        if sys.platform == "win32":
            result = subprocess.run(
                ["taskkill", "/PID", str(pid), "/F"],
                capture_output=True,
                text=True,
            )
            return result.returncode == 0
        subprocess.run(["kill", "-9", str(pid)], check=True, capture_output=True)
        return True
    except (subprocess.CalledProcessError, OSError):
        return False


def clear_stale_port(host: str, port: int) -> bool:
    """Stop a hung listener on our port so we can start fresh."""
    if not port_in_use(host, port):
        return False
    if wait_for_probe(host, port, retries=8, delay=0.5) is not None:
        return False

    pid = find_listening_pid(port, host)
    if pid is None:
        return False

    name = (process_name(pid) or "").lower()
    if name and "python" not in name:
        print(f"[cbdb-atlas] 端口 {port} 被 {name} (PID {pid}) 佔用，無法自動清理。")
        return False

    print(f"[cbdb-atlas] 檢測到端口 {port} 上的進程無響應 (PID {pid})，正在清理…")
    if not terminate_pid(pid):
        return False
    time.sleep(0.6)
    return not port_in_use(host, port)


def port_in_use(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.5)
        return sock.connect_ex((host, port)) == 0


def wait_for_server(host: str, port: int, timeout: float = 60.0) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if probe_server(host, port) is not None:
            return True
        time.sleep(0.4)
    return False


def serve(host: str | None = None, port: int | None = None, open_browser: bool = False) -> None:
    import uvicorn

    from cbdb_atlas.api import create_app
    from cbdb_atlas.config import load_config

    cfg = load_config(project_root=ROOT)
    h = host or cfg.host
    p = port or cfg.port
    app = create_app(cfg)

    if open_browser:
        def _open() -> None:
            if wait_for_server(h, p):
                open_browser_tab(h, p)

        threading.Thread(target=_open, daemon=True).start()

    uvicorn.run(app, host=h, port=p, log_level="info")


def open_browser_tab(host: str, port: int) -> None:
    url = server_url(host, port)
    print(f"[cbdb-atlas] 正在打開瀏覽器 → {url}")
    if sys.platform == "win32":
        os.startfile(url)  # type: ignore[attr-defined]
    else:
        webbrowser.open(url)


def main() -> int:
    parser = argparse.ArgumentParser(description="CBDB Atlas — 直查 CBDB 視圖")
    parser.add_argument("--host", default=None)
    parser.add_argument("--port", type=int, default=None)
    parser.add_argument("--no-browser", action="store_true", help="啟動服務但不打開瀏覽器")
    parser.add_argument(
        "--open-only",
        action="store_true",
        help="僅打開瀏覽器（要求服務已在運行）",
    )
    parser.add_argument(
        "--sync-upstream",
        action="store_true",
        help="同步 vendor/cbdb_sqlite 子模塊（官方上游倉庫）",
    )
    args = parser.parse_args()

    print("=" * 48)
    print("  CBDB Atlas · 外置 SQL 查詢")
    print("=" * 48, flush=True)

    try:
        ensure_dependencies()

        from cbdb_atlas.config import load_config

        cfg = load_config(project_root=ROOT)
        h = args.host or cfg.host
        p = args.port or cfg.port
        url = server_url(h, p)

        if args.sync_upstream:
            from cbdb_atlas.upstream import sync_upstream_submodule

            ok, message = sync_upstream_submodule(cfg.project_root)
            if ok:
                print(f"[cbdb-atlas] {message}", flush=True)
                return 0
            print(f"[cbdb-atlas] 同步失敗：{message}", flush=True)
            return 1

        if args.open_only:
            if wait_for_probe(h, p, retries=2, delay=0.3) is None:
                print(f"[cbdb-atlas] 服務未運行：{url}")
                print("[cbdb-atlas] 請雙擊「啟動CBDB_atlas.bat」，或運行 python run.py")
                return 1
            print(f"[cbdb-atlas] 已連接現有服務 → {url}")
            open_browser_tab(h, p)
            return 0

        health = wait_for_probe(h, p, retries=3, delay=0.3)
        if health is not None:
            print(f"[cbdb-atlas] 服務已在運行 → {url}")
            if not args.no_browser:
                open_browser_tab(h, p)
            print("[cbdb-atlas] 關閉運行服務的窗口才會停止服務。")
            return 0

        if port_in_use(h, p):
            if clear_stale_port(h, p):
                print("[cbdb-atlas] 已清理無響應進程。")
            else:
                pid = find_listening_pid(p, h)
                print(f"[cbdb-atlas] 端口 {p} 已被佔用（PID {pid or '未知'}），無法啟動。")
                print("[cbdb-atlas] 請關閉佔用該端口的程序，或修改 config/default.yaml 中的 server.port。")
                return 1

        ensure_source()
        print(f"[cbdb-atlas] 正在啟動服務 → {url}")
        print("[cbdb-atlas] 關閉本窗口即停止服務；可將「啟動CBDB_atlas.bat」固定到任務欄。")
        serve(host=h, port=p, open_browser=not args.no_browser)
    except KeyboardInterrupt:
        print("\n已停止。")
        return 0
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
