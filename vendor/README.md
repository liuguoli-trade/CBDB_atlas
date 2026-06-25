# vendor/cbdb_sqlite（可選）

可選 Git 子模塊，指向 [cbdb-project/cbdb_sqlite](https://github.com/cbdb-project/cbdb_sqlite)。

初始化：

```bash
git submodule update --init --depth 1 vendor/cbdb_sqlite
```

未初始化時，CBDB Atlas 使用本倉庫自帶的 `scripts/create_views.sh`，並從 GitHub 讀取 `latest.json` 檢查數據更新。
