# Scripts

本目录随 **CBDB Atlas** 一并分发。

## create_views.sh

在 CBDB SQLite 库中创建 18 个便利视图（`View_PeopleData`、`View_AssociationData` 等）。

来源：[cbdb-project/cbdb_sqlite](https://github.com/cbdb-project/cbdb_sqlite) 官方脚本（MIT）。若已初始化 `vendor/cbdb_sqlite` 子模块，应用会优先使用上游脚本。

```bash
bash scripts/create_views.sh data/source/cbdb.sqlite3
```

Windows：

```bat
scripts\create_views.bat data\source\cbdb.sqlite3
```

需要已安装 `sqlite3` 命令行工具。

## generate_field_labels.py

从数据库 schema 生成 `web/field-labels.js`（维护字段中文标签时使用）。
