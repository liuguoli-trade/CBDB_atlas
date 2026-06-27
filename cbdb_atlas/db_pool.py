"""Small pool of read-only SQLite connections for concurrent API handlers."""

from __future__ import annotations

import queue
import sqlite3
import threading
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

DEFAULT_POOL_SIZE = 4
MMAP_BYTES = 268_435_456  # 256 MiB


def apply_read_pragmas(conn: sqlite3.Connection) -> None:
    conn.execute("PRAGMA query_only=ON")
    conn.execute("PRAGMA cache_size=-64000")
    conn.execute("PRAGMA temp_store=MEMORY")
    conn.execute(f"PRAGMA mmap_size={MMAP_BYTES}")


def open_readonly_connection(db_path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(
        f"file:{db_path}?mode=ro",
        uri=True,
        timeout=30.0,
        check_same_thread=False,
    )
    conn.row_factory = sqlite3.Row
    apply_read_pragmas(conn)
    return conn


class ReadOnlyPool:
    def __init__(self, db_path: Path, *, size: int = DEFAULT_POOL_SIZE) -> None:
        self.db_path = db_path
        self._size = max(1, size)
        self._queue: queue.Queue[sqlite3.Connection] = queue.Queue()
        self._lock = threading.Lock()
        self._closed = False
        for _ in range(self._size):
            self._queue.put(open_readonly_connection(db_path))

    @contextmanager
    def borrow(self) -> Iterator[sqlite3.Connection]:
        if self._closed:
            raise RuntimeError("Connection pool is closed")
        conn = self._queue.get()
        try:
            yield conn
        finally:
            if not self._closed:
                self._queue.put(conn)

    def close(self) -> None:
        with self._lock:
            if self._closed:
                return
            self._closed = True
            while not self._queue.empty():
                try:
                    self._queue.get_nowait().close()
                except queue.Empty:
                    break

    def reload(self, db_path: Path) -> None:
        self.close()
        self.db_path = db_path
        self._closed = False
        self._queue = queue.Queue()
        for _ in range(self._size):
            self._queue.put(open_readonly_connection(db_path))
