# CBDB Atlas

在浏览器中直查 [CBDB（中國歷代人物傳記資料庫）](https://cbdb.hsites.harvard.edu/) SQLite 视图。查询逻辑外置在 `queries/*.sql`，**无需构建知识图谱**。

官方数据发布：[cbdb-project/cbdb_sqlite](https://github.com/cbdb-project/cbdb_sqlite)

## 特性

- 直查 `View_PeopleData` 等 CBDB 便利视图
- 所有检索 SQL 位于 `queries/`，可在网页「查询 SQL」页查看源码
- 人物检索 + 传记模块（别名、任官、亲属、入仕、著述等）
- 内置 `scripts/create_views.sh`，可离线创建 18 个便利视图
- 启动时检查 CBDB 官方版本，支持网页一键下载更新
- 人物详情导出 Excel（多 sheet）

## 快速开始

```bash
git clone https://github.com/YOUR_USER/CBDB_atlas.git
cd CBDB_atlas
pip install -e .
python run.py
```

Windows 推荐双击 **`啟動CBDB_atlas.bat`**（自动启动本地服务并打开浏览器）。

访问地址：http://127.0.0.1:8770

### 准备 CBDB 数据

**方式 A（推荐）**：启动后在网页点击「更新数据」，从官方源下载并校验 SHA-256。

**方式 B**：手动将 CBDB SQLite 放到 `data/source/cbdb.sqlite3`，然后创建视图：

```bash
bash scripts/create_views.sh data/source/cbdb.sqlite3
```

Windows 可运行 `scripts\create_views.bat`（需 Git Bash 或 WSL，以及 `sqlite3` 命令行）。

### 可选：上游 cbdb_sqlite 子模块

用于同步官方 `latest.json` 与 `create_views.sh`：

```bash
git submodule update --init --depth 1 vendor/cbdb_sqlite
python run.py --sync-upstream
```

未初始化子模块时，使用本仓库自带的 `scripts/create_views.sh` 与配置中的 GitHub URL。

## 架构

```
queries/*.sql     ← 可编辑的外置查询
       ↓
cbdb_atlas/store.py
       ↓
data/source/cbdb.sqlite3
       ↓
FastAPI + Web UI
```

## 项目结构

```
CBDB_atlas/
├── cbdb_atlas/          # Python 包
├── queries/             # 外置 SQL + manifest.yaml
├── scripts/             # create_views.sh、字段标签生成等
├── web/                 # 前端静态资源
├── config/default.yaml
├── data/source/         # CBDB 源库（不提交 Git）
├── vendor/cbdb_sqlite/  # 可选子模块
├── run.py
└── 啟動CBDB_atlas.bat
```

## 扩展查询

1. 在 `queries/` 添加 `.sql`
2. 在 `queries/manifest.yaml` 登记
3. 在 `cbdb_atlas/store.py` / `api.py` 增加端点（如需要）

## 推送到 GitHub

```bash
cd CBDB_atlas
git init
git add .
git commit -m "Initial commit: CBDB Atlas"
git branch -M main
git remote add origin https://github.com/YOUR_USER/CBDB_atlas.git
git push -u origin main
```

**请勿提交**：`data/source/*.sqlite3`、`data/local/` 运行时文件（见 `.gitignore`）。

## 许可

| 内容 | 许可 |
|------|------|
| 本仓库代码 | [MIT](LICENSE) |
| CBDB 数据 | [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) |

详见 [ATTRIBUTION.md](ATTRIBUTION.md)、[DATA_LICENSE.md](DATA_LICENSE.md)。
