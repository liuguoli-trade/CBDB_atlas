"""Tests for read-only SQLite connection pool."""

from __future__ import annotations

import sqlite3
import tempfile
from pathlib import Path

from cbdb_atlas.db_pool import ReadOnlyPool, apply_read_pragmas, open_readonly_connection


def test_apply_read_pragmas_sets_mmap() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        db = Path(tmp) / "test.db"
        conn = sqlite3.connect(db)
        conn.execute("CREATE TABLE t(x INTEGER)")
        conn.execute("INSERT INTO t VALUES (1)")
        conn.commit()
        conn.close()

        ro = open_readonly_connection(db)
        apply_read_pragmas(ro)
        mmap = ro.execute("PRAGMA mmap_size").fetchone()[0]
        ro.close()
        assert mmap != 0


def test_readonly_pool_borrow() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        db = Path(tmp) / "test.db"
        conn = sqlite3.connect(db)
        conn.execute("CREATE TABLE t(x INTEGER)")
        conn.execute("INSERT INTO t VALUES (42)")
        conn.commit()
        conn.close()

        pool = ReadOnlyPool(db, size=2)
        with pool.borrow() as c1:
            row = c1.execute("SELECT x FROM t").fetchone()
            assert row[0] == 42
        with pool.borrow() as c2:
            assert c2.execute("SELECT COUNT(*) FROM t").fetchone()[0] == 1
        pool.close()
