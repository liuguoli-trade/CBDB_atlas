from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel

from cbdb_atlas.config import AppConfig, load_config
from cbdb_atlas.queries import QueryRegistry
from cbdb_atlas.source import (
    UPDATE_JOB,
    dismiss_update,
    ensure_cbdb_views,
    fetch_remote_release,
    migrate_legacy_database,
    resolve_local_database,
    run_update_async,
    source_status,
)
from cbdb_atlas.source_release import has_required_views
from cbdb_atlas.async_util import run_blocking
from cbdb_atlas.export_render import (
    build_basic_display,
    build_export_payload,
    build_table_display,
)
from cbdb_atlas.person_export import build_person_workbook
from cbdb_atlas.search_index import (
    default_search_index_path,
    run_search_build_async,
    search_index_status,
)
from cbdb_atlas.store import (
    CbdbStore,
    ENTITY_PERSON_TYPES,
    MODULE_VIEWS,
    SEARCH_TYPES,
)
from cbdb_atlas.visual import (
    GraphService,
    circle_graph,
    default_index_path,
    explore_graph,
    family_graph,
    index_status,
    is_index_ready,
    run_build_async,
)

WEB_DIR = Path(__file__).resolve().parents[1] / "web"

MODULE_IDS = [
    ("basic", "基本資料", None),
    ("entry", "入仕", "entry"),
    ("status", "社會身份", "status"),
    ("posting", "任官", "posting"),
    ("biog_address", "傳記地址", "biog_address"),
    ("relations", "人物關係", None),
    ("text_role", "著述", "text_role"),
    ("biog_source", "資料出處", "biog_source"),
    ("institution", "社會機構", "institution"),
    ("event", "生平事件", "event"),
    ("possessions", "財產", "possessions"),
]

SEARCH_TYPE_LABELS = [
    ("person", "人物"),
    ("place", "地名"),
    ("office", "官職"),
    ("text", "文獻"),
    ("institution", "機構"),
    ("event", "事件"),
    ("kinship", "親屬關係"),
    ("assoc", "社會關係"),
    ("entry", "入仕途徑"),
    ("status", "社會身份"),
    ("choronym", "郡望"),
    ("nianhao", "年號"),
]

ENTITY_TYPE_LABELS = [
    ("office", "官職"),
    ("place", "地名"),
    ("text", "文獻"),
    ("institution", "機構"),
    ("event", "事件"),
]

QUERY_TEMPLATES = [
    {
        "id": "person_name",
        "label": "人物姓名／別名",
        "description": "按中文名、拼音、別名或人物編號檢索",
        "action": "search",
        "search_type": "person",
    },
    {
        "id": "person_posting",
        "label": "按任官查人",
        "description": "輸入官職關鍵詞，可限定起迄年與朝代",
        "action": "advanced_posting",
    },
    {
        "id": "person_event",
        "label": "按事件查人",
        "description": "輸入事件名稱，可限定事件年份區間",
        "action": "advanced_event",
    },
    {
        "id": "entity_office",
        "label": "官職 → 相關人物",
        "description": "先搜官職編碼，再點「相關人物」",
        "action": "search",
        "search_type": "office",
    },
    {
        "id": "entity_place",
        "label": "地名 → 相關人物",
        "description": "先搜地名，再點「相關人物」",
        "action": "search",
        "search_type": "place",
    },
    {
        "id": "browse_office",
        "label": "官職類型樹",
        "description": "按 OFFICE_TYPE_TREE 瀏覽官制分類",
        "action": "browse_office",
    },
    {
        "id": "browse_address",
        "label": "地址層級",
        "description": "按 ADDR_BELONGS_DATA 瀏覽下級區劃",
        "action": "browse_address",
    },
]


class DismissBody(BaseModel):
    remote_sha256: str | None = None


class ExploreBody(BaseModel):
    person_ids: list[int]
    strategy: str = "pairwise_shortest"
    edge_types: list[str] | None = None
    max_depth: int = 6


class _Runtime:
    def __init__(self, config: AppConfig) -> None:
        self.config = config
        self.store: CbdbStore | None = None
        self.db_error: str | None = None
        self.reload()

    def reload(self) -> None:
        if self.store is not None:
            self.store.close()
            self.store = None
        db = resolve_local_database(self.config.source_dir, self.config.cbdb_database)
        if not db or not db.is_file():
            self.db_error = f"CBDB database not found: {self.config.cbdb_database}"
            return
        try:
            ensure_cbdb_views(db, self.config.project_root)
        except RuntimeError as exc:
            self.db_error = str(exc)
            return
        try:
            self.store = CbdbStore(
                db,
                self.config.queries_dir,
                search_index_path=default_search_index_path(self.config.project_root),
                graph_index_path=default_index_path(self.config.project_root),
            )
            self.db_error = None
        except Exception as exc:
            self.db_error = str(exc)


def create_app(config: AppConfig | None = None) -> FastAPI:
    cfg = config or load_config()
    runtime = _Runtime(cfg)

    app = FastAPI(title="CBDB Atlas", version="0.1.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    def require_store() -> CbdbStore:
        if runtime.store is None:
            raise HTTPException(
                status_code=503,
                detail=runtime.db_error or "CBDB database is not available",
            )
        return runtime.store

    @app.get("/api/ping")
    def ping() -> dict:
        return {"ok": True}

    @app.get("/api/health")
    def health() -> dict:
        return {
            "ok": True,
            "ready": runtime.store is not None,
            "error": runtime.db_error,
        }

    @app.get("/api/source/status")
    def get_source_status() -> dict:
        return source_status(
            cfg.source_dir, cfg.cbdb_database, cfg.latest_json_url, cfg.project_root
        )

    @app.post("/api/source/dismiss")
    def dismiss_source_update(body: DismissBody) -> dict:
        remote = fetch_remote_release(cfg.latest_json_url, project_root=cfg.project_root)
        sha = (body.remote_sha256 or (remote.sha256 if remote else "")).lower()
        if not sha:
            raise HTTPException(status_code=400, detail="No remote release to dismiss")
        dismiss_update(cfg.source_dir, sha)
        return {"ok": True, "dismissed_sha256": sha}

    @app.post("/api/source/update")
    def start_source_update() -> dict:
        if UPDATE_JOB.in_progress:
            return {"ok": False, "message": "更新已在進行中", "job": UPDATE_JOB.phase}

        def on_ready() -> None:
            runtime.reload()

        started = run_update_async(
            cfg.source_dir,
            cfg.cbdb_database,
            cfg.project_root,
            cfg.latest_json_url,
            on_ready,
        )
        return {"ok": started, "message": "已開始更新" if started else "無法啟動更新"}

    @app.post("/api/source/sync-upstream")
    def sync_upstream_submodule() -> dict:
        from cbdb_atlas.upstream import sync_upstream_submodule as _sync

        ok, message = _sync(cfg.project_root)
        if not ok:
            raise HTTPException(status_code=500, detail=message)
        return {"ok": True, "message": message}

    @app.get("/api/stats")
    def stats() -> dict:
        return require_store().stats()

    @app.get("/api/schema/modules")
    def modules_schema() -> dict:
        return {
            "modules": [
                {"id": mid, "label": label, "query": query}
                for mid, label, query in MODULE_IDS
            ]
        }

    @app.get("/api/schema/queries")
    def queries_schema() -> dict:
        reg = QueryRegistry(cfg.queries_dir)
        return {"queries": reg.list_queries()}

    @app.get("/api/schema/queries/{query_id}/sql")
    def query_sql(query_id: str) -> dict:
        reg = QueryRegistry(cfg.queries_dir)
        try:
            return {"id": query_id, "sql": reg.get_source(query_id)}
        except KeyError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @app.get("/api/schema/search-types")
    def search_types_schema() -> dict:
        return {
            "search_types": [
                {"id": sid, "label": label} for sid, label in SEARCH_TYPE_LABELS
            ],
            "entity_types": [
                {"id": eid, "label": label} for eid, label in ENTITY_TYPE_LABELS
            ],
        }

    @app.get("/api/schema/templates")
    def query_templates_schema() -> dict:
        return {"templates": QUERY_TEMPLATES}

    @app.get("/api/schema/views")
    def views_schema() -> dict:
        return {
            "views": [
                {"module": mid, "view": MODULE_VIEWS[mid]}
                for mid in MODULE_VIEWS
            ]
        }

    @app.get("/api/schema/dynasties")
    def dynasties(limit: int = Query(default=100, le=200)) -> dict:
        return {"dynasties": require_store().list_dynasties(limit)}

    @app.get("/api/search")
    async def search(
        q: str = Query(min_length=1),
        type: str = Query(default="person", alias="type"),
        dynasty_code: int | None = None,
        birth_min: int | None = None,
        birth_max: int | None = None,
        death_min: int | None = None,
        death_max: int | None = None,
        index_min: int | None = None,
        index_max: int | None = None,
        female: int | None = None,
        index_addr: str | None = None,
        firstyear: int | None = None,
        lastyear: int | None = None,
        related_person: str | None = None,
        limit: int = Query(default=30, le=200),
        offset: int = Query(default=0, ge=0),
        defer_count: bool = Query(default=True),
    ) -> dict:
        if type not in SEARCH_TYPES and type != "person":
            raise HTTPException(status_code=400, detail=f"Unknown search type: {type}")
        store = require_store()
        use_defer = defer_count and offset == 0 and type == "person"
        try:
            return await run_blocking(
                store.search,
                q,
                search_type=type,
                dynasty_code=dynasty_code if type in ("person", "place", "text") else None,
                birth_min=birth_min if type == "person" else None,
                birth_max=birth_max if type == "person" else None,
                death_min=death_min if type == "person" else None,
                death_max=death_max if type == "person" else None,
                index_min=index_min if type == "person" else None,
                index_max=index_max if type == "person" else None,
                female=female if type == "person" else None,
                index_addr=index_addr if type == "person" else None,
                firstyear=firstyear if type == "place" else None,
                lastyear=lastyear if type == "place" else None,
                related_person=related_person if type == "text" else None,
                limit=limit,
                offset=offset,
                defer_count=use_defer,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.get("/api/search/persons-by-posting")
    async def search_persons_by_posting(
        q: str = Query(min_length=1),
        year_min: int | None = None,
        year_max: int | None = None,
        dynasty_code: int | None = None,
        limit: int = Query(default=30, le=200),
        offset: int = Query(default=0, ge=0),
    ) -> dict:
        store = require_store()
        return await run_blocking(
            store.search_persons_by_posting,
            q,
            year_min=year_min,
            year_max=year_max,
            dynasty_code=dynasty_code,
            limit=limit,
            offset=offset,
        )

    @app.get("/api/search/persons-by-event")
    async def search_persons_by_event(
        q: str = Query(min_length=1),
        year_min: int | None = None,
        year_max: int | None = None,
        limit: int = Query(default=30, le=200),
        offset: int = Query(default=0, ge=0),
    ) -> dict:
        store = require_store()
        return await run_blocking(
            store.search_persons_by_event,
            q,
            year_min=year_min,
            year_max=year_max,
            limit=limit,
            offset=offset,
        )

    @app.get("/api/entity/{entity_type}/{entity_id}/persons")
    async def entity_persons(
        entity_type: str,
        entity_id: int,
        limit: int = Query(default=30, le=200),
        offset: int = Query(default=0, ge=0),
    ) -> dict:
        if entity_type not in ENTITY_PERSON_TYPES:
            raise HTTPException(status_code=400, detail=f"Unknown entity type: {entity_type}")
        store = require_store()
        try:
            return await run_blocking(
                store.entity_persons,
                entity_type,
                entity_id,
                limit=limit,
                offset=offset,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.get("/api/browse/address/{addr_id}")
    def browse_address(addr_id: int) -> dict:
        store = require_store()
        detail = store.browse_address_detail(addr_id)
        if not detail:
            raise HTTPException(status_code=404, detail="Address not found")
        children = store.browse_address_children(addr_id)
        return {"address": detail, **children}

    @app.get("/api/browse/address/{addr_id}/children")
    def browse_address_children(
        addr_id: int,
        limit: int = Query(default=50, le=200),
        offset: int = Query(default=0, ge=0),
    ) -> dict:
        return require_store().browse_address_children(addr_id, limit=limit, offset=offset)

    @app.get("/api/browse/office-tree")
    def browse_office_tree(
        parent_id: str | None = None,
        limit: int = Query(default=100, le=200),
        offset: int = Query(default=0, ge=0),
    ) -> dict:
        return require_store().browse_office_tree(parent_id, limit=limit, offset=offset)

    @app.get("/api/browse/office-tree/{node_id}/offices")
    def browse_office_tree_offices(
        node_id: str,
        limit: int = Query(default=50, le=200),
        offset: int = Query(default=0, ge=0),
    ) -> dict:
        return require_store().browse_office_tree_offices(node_id, limit=limit, offset=offset)

    @app.get("/api/person/{person_id}")
    def person(
        person_id: int,
        include_counts: bool = Query(default=False),
    ) -> dict:
        store = require_store()
        row = store.get_person(person_id)
        if not row:
            raise HTTPException(status_code=404, detail="Person not found")
        canonical = row.get("_canonical_id") or row["c_personid"]
        payload: dict = {
            "person": row,
            "merged_from": row.get("_merged_from"),
        }
        if include_counts:
            payload["module_counts"] = store.module_counts(canonical)
        return payload

    @app.get("/api/person/{person_id}/module-counts")
    async def person_module_counts(person_id: int) -> dict:
        store = require_store()
        row = store.get_person(person_id)
        if not row:
            raise HTTPException(status_code=404, detail="Person not found")
        canonical = row.get("_canonical_id") or row["c_personid"]
        counts = await run_blocking(store.module_counts, canonical)
        return {"person_id": canonical, "module_counts": counts}

    @app.get("/api/person/{person_id}/module/{module_id}")
    async def person_module(
        person_id: int,
        module_id: str,
        format: str = Query(default="raw", alias="format"),
        limit: int = Query(default=80, le=200),
        offset: int = Query(default=0, ge=0),
    ) -> dict:
        store = require_store()
        if not store.get_person(person_id):
            raise HTTPException(status_code=404, detail="Person not found")

        def _load() -> dict:
            if format == "display":
                if module_id == "basic":
                    return build_basic_display(store, person_id)
                return build_table_display(
                    store, person_id, module_id, limit=limit, offset=offset
                )
            if module_id == "basic":
                person = store.get_person(person_id)
                if not person:
                    raise ValueError("Person not found")
                canonical = person.get("_canonical_id") or person["c_personid"]
                alt = store.module_rows("altname", canonical, limit=200, offset=0)
                return {
                    "module": module_id,
                    "person": person,
                    "altnames": alt["rows"],
                }
            resolved = store.resolve_module_id(module_id)
            data = store.module_rows(module_id, person_id, limit=limit, offset=offset)
            return {"module": resolved, **data}

        try:
            return await run_blocking(_load)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.get("/api/person/{person_id}/relations-graph")
    async def person_relations_graph(
        person_id: int,
        steps: int = Query(default=1, ge=1, le=5),
        kind: str = Query(default="all"),
        degree: int | None = Query(default=None, ge=1, le=5),
    ) -> dict:
        store = require_store()
        if not store.get_person(person_id):
            raise HTTPException(status_code=404, detail="Person not found")
        hop_steps = degree if degree is not None else steps
        try:
            return await run_blocking(
                store.relations_graph,
                person_id,
                steps=hop_steps,
                kind=kind,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.get("/api/search-index/status")
    def get_search_index_status() -> dict:
        index_path = default_search_index_path(cfg.project_root)
        source = resolve_local_database(cfg.source_dir, cfg.cbdb_database)
        return search_index_status(index_path, source)

    @app.post("/api/search-index/build")
    def build_search_index_route() -> dict:
        index_path = default_search_index_path(cfg.project_root)
        source = resolve_local_database(cfg.source_dir, cfg.cbdb_database)
        if not source or not source.is_file():
            raise HTTPException(status_code=503, detail="CBDB database not available")
        started = run_search_build_async(source, index_path)
        if not started:
            return {"ok": False, "message": "檢索索引構建已在進行中"}
        return {"ok": True, "message": "已開始構建人物檢索索引"}

    @app.get("/api/visual/index/status")
    def visual_index_status() -> dict:
        index_path = default_index_path(cfg.project_root)
        source = resolve_local_database(cfg.source_dir, cfg.cbdb_database)
        return index_status(index_path, source)

    @app.post("/api/visual/index/build")
    def visual_index_build() -> dict:
        index_path = default_index_path(cfg.project_root)
        source = resolve_local_database(cfg.source_dir, cfg.cbdb_database)
        if not source or not source.is_file():
            raise HTTPException(status_code=503, detail="CBDB database not available")
        started = run_build_async(source, index_path)
        if not started:
            return {"ok": False, "message": "索引構建已在進行中"}
        return {"ok": True, "message": "已開始構建關係索引"}

    @app.get("/api/visual/single")
    async def visual_single(
        person_id: int,
        steps: int = Query(default=1, ge=1, le=5),
        kind: str = Query(default="all"),
    ) -> dict:
        store = require_store()
        if not store.get_person(person_id):
            raise HTTPException(status_code=404, detail="Person not found")
        try:
            svc = GraphService(store, graph_index_path=store.graph_index_path)
            return await run_blocking(svc.single, person_id, steps=steps, kind=kind)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.get("/api/visual/family")
    async def visual_family(
        person_id: int,
        max_up: int = Query(default=3, ge=0, le=8),
        max_down: int = Query(default=3, ge=0, le=8),
        max_col: int = Query(default=3, ge=0, le=8),
        addr_split: bool = Query(default=True),
        spouse_expand: bool = Query(default=True),
        prune_by_addr: bool = Query(default=False),
    ) -> dict:
        store = require_store()
        if not store.get_person(person_id):
            raise HTTPException(status_code=404, detail="Person not found")
        try:
            return await run_blocking(
                family_graph,
                store,
                person_id,
                max_up=max_up,
                max_down=max_down,
                max_col=max_col,
                addr_split=addr_split,
                spouse_expand=spouse_expand,
                prune_by_addr=prune_by_addr,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.get("/api/visual/circle")
    async def visual_circle(
        person_id: int,
        steps: int = Query(default=2, ge=1, le=5),
    ) -> dict:
        store = require_store()
        if not store.get_person(person_id):
            raise HTTPException(status_code=404, detail="Person not found")
        try:
            return await run_blocking(circle_graph, store, person_id, steps=steps)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.post("/api/visual/explore")
    async def visual_explore(body: ExploreBody) -> dict:
        store = require_store()
        index_path = default_index_path(cfg.project_root)
        if not is_index_ready(index_path):
            raise HTTPException(
                status_code=503,
                detail="關係索引尚未就緒，請先構建索引",
            )
        try:
            return await run_blocking(
                explore_graph,
                store,
                index_path,
                body.person_ids,
                strategy=body.strategy,
                edge_types=body.edge_types,
                max_depth=body.max_depth,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.get("/api/person/{person_id}/export-data")
    async def export_person_data(person_id: int) -> dict:
        store = require_store()
        if not store.get_person(person_id):
            raise HTTPException(status_code=404, detail="Person not found")
        try:
            return await run_blocking(build_export_payload, store, person_id)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.get("/api/person/{person_id}/export")
    async def export_person(person_id: int) -> StreamingResponse:
        store = require_store()
        if not store.get_person(person_id):
            raise HTTPException(status_code=404, detail="Person not found")
        try:
            content, filename = await run_blocking(build_person_workbook, store, person_id)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        from urllib.parse import quote

        encoded = quote(filename)
        return StreamingResponse(
            iter([content]),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={
                "Content-Disposition": f"attachment; filename*=UTF-8''{encoded}",
            },
        )

    @app.get("/")
    def serve_index() -> FileResponse:
        return FileResponse(WEB_DIR / "index.html")

    @app.get("/visual")
    def serve_visual() -> FileResponse:
        return FileResponse(WEB_DIR / "visual.html")

    @app.get("/styles.css")
    def serve_css() -> FileResponse:
        return FileResponse(WEB_DIR / "styles.css", media_type="text/css")

    @app.get("/app.js")
    def serve_js() -> FileResponse:
        return FileResponse(WEB_DIR / "app.js", media_type="application/javascript")

    @app.get("/field-labels.js")
    def serve_field_labels() -> FileResponse:
        return FileResponse(WEB_DIR / "field-labels.js", media_type="application/javascript")

    @app.get("/export-schema.json")
    def serve_export_schema() -> FileResponse:
        return FileResponse(WEB_DIR / "export-schema.json", media_type="application/json")

    @app.get("/cbdb-hanzi.js")
    def serve_cbdb_hanzi_js() -> FileResponse:
        return FileResponse(WEB_DIR / "cbdb-hanzi.js", media_type="application/javascript")

    @app.get("/assets/{asset_path:path}")
    def serve_asset(asset_path: str) -> FileResponse:
        path = (WEB_DIR / "assets" / asset_path).resolve()
        assets_root = (WEB_DIR / "assets").resolve()
        if not str(path).startswith(str(assets_root)) or not path.is_file():
            raise HTTPException(status_code=404, detail="Asset not found")
        media = {
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".png": "image/png",
            ".webp": "image/webp",
            ".svg": "image/svg+xml",
        }.get(path.suffix.lower(), "application/octet-stream")
        return FileResponse(path, media_type=media)

    @app.get("/fonts/{asset_path:path}")
    def serve_font(asset_path: str) -> FileResponse:
        path = (WEB_DIR / "fonts" / asset_path).resolve()
        fonts_root = (WEB_DIR / "fonts").resolve()
        if not str(path).startswith(str(fonts_root)) or not path.is_file():
            raise HTTPException(status_code=404, detail="Font not found")
        suffix = path.suffix.lower()
        media = {
            ".ttf": "font/ttf",
            ".otf": "font/otf",
            ".woff": "font/woff",
            ".woff2": "font/woff2",
        }.get(suffix, "application/octet-stream")
        return FileResponse(path, media_type=media)

    @app.get("/vendor/{asset_path:path}")
    def serve_vendor(asset_path: str) -> FileResponse:
        path = (WEB_DIR / "vendor" / asset_path).resolve()
        vendor_root = (WEB_DIR / "vendor").resolve()
        if not str(path).startswith(str(vendor_root)) or not path.is_file():
            raise HTTPException(status_code=404, detail="Asset not found")
        media = "application/javascript" if path.suffix == ".js" else "application/octet-stream"
        return FileResponse(path, media_type=media)

    @app.get("/loading.js")
    def serve_loading_js() -> FileResponse:
        return FileResponse(WEB_DIR / "loading.js", media_type="application/javascript")

    @app.get("/cbdb-graph.js")
    def serve_cbdb_graph_js() -> FileResponse:
        return FileResponse(
            WEB_DIR / "cbdb-graph.js",
            media_type="application/javascript",
            headers={"Cache-Control": "no-cache"},
        )

    @app.get("/graph-edge-schema.js")
    def serve_graph_edge_schema_js() -> FileResponse:
        return FileResponse(
            WEB_DIR / "graph-edge-schema.js",
            media_type="application/javascript",
        )

    @app.get("/graph-shell.js")
    def serve_graph_shell_js() -> FileResponse:
        return FileResponse(WEB_DIR / "graph-shell.js", media_type="application/javascript")

    @app.get("/graph-layout.js")
    def serve_graph_layout_js() -> FileResponse:
        return FileResponse(WEB_DIR / "graph-layout.js", media_type="application/javascript")

    @app.get("/visual.js")
    def serve_visual_js() -> FileResponse:
        return FileResponse(WEB_DIR / "visual.js", media_type="application/javascript")

    return app
