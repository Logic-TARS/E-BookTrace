# 笔记管理工作台 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有 `#/creation` 创作页改造成支持全书库查询、离线回退、编辑、批量标签、跨设备回收站和 Markdown 下载的笔记管理工作台。

**Architecture:** 在线列表由新的服务端笔记查询 API 提供，IndexedDB 继续承担本地优先写入、离线回退和待同步视图；单条修改复用现有持久同步队列，在线批量操作使用持久幂等 API。SQLite `highlights.deleted_at` 表示回收站状态，新同步协议明确区分移入回收站、恢复和永久删除，同时兼容旧客户端的永久删除语义。

**Tech Stack:** Python 3.11/3.12、FastAPI、Pydantic 2、aiosqlite、SQLite FTS5、原生 JavaScript IIFE、IndexedDB v6、Service Worker、pytest、Playwright。

**Spec:** `docs/superpowers/specs/2026-09-20-notes-management-design.md`

## Global Constraints

- 保持内部路由 `#/`、`#/reader`、`#/creation`；`creation` 继续作为兼容路由，但界面名称改为“笔记管理”。
- 不新增前端框架、打包器或运行时依赖；前端继续使用原生 HTML、CSS、JavaScript、epub.js 和 JSZip。
- 数据库升级只能增列、增表、增索引或增触发器；不得重建、清空或覆盖用户现有表和数据。
- 历史稿件接口、drafts 表、Obsidian 接口、JSON 导出接口、历史索引和文件全部保留；只移除稿件相关前端入口。
- 不删除 IndexedDB 的 `deleted_highlights` 仓库；IndexedDB 版本由 5 升至 6。
- 新管理页仅提供 Markdown 下载，不显示 JSON 或 Obsidian 导出入口。
- `/book-chat/` 的共享书库和进度同步行为必须保持不变。
- 应用壳继续网络优先，EPUB 使用独立稳定缓存；升级应用壳不得清除 EPUB 缓存。
- 所有自动测试使用隔离 SQLite、隔离书籍目录和生成/固定 EPUB，不连接用户真实书库或生产服务。
- Python 使用 4 空格、snake_case 和 async 数据访问；前端使用严格模式 IIFE、2 空格和 camelCase。
- 每个任务都遵循红—绿—重构：先提交失败测试，确认失败原因，再写最小实现并运行相关回归。

---

## File Structure

### 新增文件

- `backend/notes.py`：标签规范化和 Markdown 渲染纯函数，不访问数据库。
- `backend/tests/test_notes.py`：`backend/notes.py` 的纯函数测试。
- `backend/tests/test_notes_database.py`：schema 升级、查询、facets、批量事务与幂等测试。
- `backend/tests/test_notes_api.py`：笔记查询、批量 API、同步协议和 Markdown 下载测试。
- `frontend/tests/helpers/notes-management.mjs`：统一 IndexedDB v6 seed/read 和 notes API mock。
- `frontend/tests/notes-management.spec.js`：笔记管理桌面端和通用 Playwright 测试。

### 修改文件

- `backend/database.py`：schema 升级、FTS/LIKE 搜索、分页 facets、批量标签、回收站和导出查询。
- `backend/models.py`：批量请求/响应模型、`HighlightCreate.book_id`、`BookSyncRequest.protocol_version`。
- `backend/library.py`：协议 v2 的 `highlight.trash/restore/delete` 和快照行为。
- `backend/main.py`：`/api/notes`、批量接口、Markdown 下载和同步协议传递。
- `backend/tests/test_database.py`、`backend/tests/test_models.py`、`backend/tests/test_api.py`：旧契约回归。
- `frontend/index.html`：笔记管理 shell、详情、批量工具、回收站和确认对话框。
- `frontend/app.js`：路由、IndexedDB v6、在线/离线查询、草稿保护、批量操作、回收站和导出。
- `frontend/style.css`：桌面双栏、移动全屏详情、筛选、批量栏和无障碍状态。
- `frontend/sw.js`：拆分应用壳和稳定 EPUB 缓存。
- `frontend/tests/mobile-layout.spec.js`、`frontend/tests/ai-qa.spec.js`：复用 IndexedDB v6 helper，并更新 creation 断言。
- `frontend/tests/server-sync.spec.js`：协议 v2 与跨设备回收站 mock/断言。
- `frontend/index.html`、`frontend/sw.js`：同步更新资源查询版本与应用壳缓存版本。
- `README.md`、`PRODUCT.md`、`DESIGN.md`、`AGENTS.md`：更新笔记管理产品范围、操作和测试说明。

---

### Task 1: 安全 schema 升级与请求模型

**Files:**
- Create: `backend/tests/test_notes_database.py`
- Modify: `backend/database.py:20-79`
- Modify: `backend/models.py:10-58`
- Modify: `backend/tests/test_models.py:14-86`

**Interfaces:**
- Consumes: 现有 `database.init_db()`、`database._ensure_column()` 和 Pydantic 2 模型。
- Produces: `highlights.deleted_at`、`note_batch_operations`、活动/回收站索引、`NoteBatchTagsRequest`、`NoteBatchIdsRequest`、`NoteBatchItem`、`NoteBatchResult`、`BookSyncRequest.protocol_version`。

- [ ] **Step 1: 写旧数据库原地升级的失败测试**

在 `backend/tests/test_notes_database.py` 创建隔离旧 schema，保留一条 highlight、一条 draft 和自定义历史索引，再调用 `init_db()`：

```python
import asyncio
import sqlite3

import pytest

import database


def run(coro):
    return asyncio.run(coro)


@pytest.fixture
def legacy_notes_db(tmp_path, monkeypatch):
    path = tmp_path / "legacy.db"
    connection = sqlite3.connect(path)
    connection.executescript(
        """
        CREATE TABLE highlights (
            id TEXT PRIMARY KEY,
            client_id TEXT,
            book_id TEXT,
            book_title TEXT NOT NULL,
            book_author TEXT DEFAULT '',
            chapter TEXT DEFAULT '',
            cfi_range TEXT,
            highlight_text TEXT NOT NULL,
            note TEXT DEFAULT '',
            tags TEXT DEFAULT '[]',
            color TEXT DEFAULT 'yellow',
            created_at TEXT,
            received_at TEXT,
            updated_at TEXT,
            progress_percent REAL DEFAULT 0,
            status TEXT DEFAULT 'raw',
            knowledge_base_id TEXT
        );
        CREATE TABLE drafts (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            platform TEXT NOT NULL,
            source_highlights TEXT DEFAULT '[]',
            created_at TEXT,
            updated_at TEXT,
            exported_to_obsidian INTEGER DEFAULT 0
        );
        CREATE INDEX legacy_highlight_title ON highlights(book_title);
        INSERT INTO highlights (
            id, client_id, book_id, book_title, highlight_text, tags,
            created_at, received_at, updated_at
        ) VALUES (
            'note-1', 'client-1', 'book-1', '旧书', '旧划线', '["旧标签"]',
            '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z',
            '2026-01-01T00:00:00Z'
        );
        INSERT INTO drafts (id, title, content, platform)
        VALUES ('draft-1', '历史稿件', '必须保留', 'wechat');
        """
    )
    connection.commit()
    connection.close()
    monkeypatch.setattr(database, "DB_PATH", path)
    return path


def test_init_db_upgrades_legacy_notes_without_data_loss(legacy_notes_db):
    run(database.init_db())
    run(database.init_db())

    connection = sqlite3.connect(legacy_notes_db)
    columns = {
        row[1] for row in connection.execute("PRAGMA table_info(highlights)")
    }
    indexes = {
        row[1] for row in connection.execute("PRAGMA index_list(highlights)")
    }
    note = connection.execute(
        "SELECT book_title, highlight_text, deleted_at FROM highlights"
    ).fetchone()
    draft = connection.execute(
        "SELECT title, content FROM drafts WHERE id = 'draft-1'"
    ).fetchone()
    operations_table = connection.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' "
        "AND name = 'note_batch_operations'"
    ).fetchone()
    connection.close()

    assert "deleted_at" in columns
    assert "legacy_highlight_title" in indexes
    assert "idx_highlights_view_updated" in indexes
    assert "idx_highlights_view_book" in indexes
    assert "idx_highlights_view_position" in indexes
    assert note == ("旧书", "旧划线", None)
    assert draft == ("历史稿件", "必须保留")
    assert operations_table == ("note_batch_operations",)
```

- [ ] **Step 2: 运行迁移测试并确认按预期失败**

Run:

```bash
./.venv/Scripts/python.exe -m pytest backend/tests/test_notes_database.py::test_init_db_upgrades_legacy_notes_without_data_loss -q
```

Expected: FAIL，原因是 `deleted_at`、新索引或 `note_batch_operations` 尚不存在，而不是测试数据库路径或 import 错误。

- [ ] **Step 3: 写请求模型验证的失败测试**

在 `backend/tests/test_models.py` 增加：

```python
import pytest
from pydantic import ValidationError

from models import (
    BookSyncRequest,
    NoteBatchIdsRequest,
    NoteBatchTagsRequest,
)


def test_book_sync_request_keeps_legacy_default_and_accepts_v2():
    assert BookSyncRequest(operations=[]).protocol_version is None
    assert BookSyncRequest(protocol_version=2, operations=[]).protocol_version == 2


def test_note_batch_tags_normalizes_ids_and_tags():
    request = NoteBatchTagsRequest(
        operation_id=" operation-1 ",
        ids=[" note-1 ", "note-1", "note-2"],
        action="add",
        tags=[" 哲学 ", "", "哲学", "阅读"],
    )
    assert request.operation_id == "operation-1"
    assert request.ids == ["note-1", "note-2"]
    assert request.tags == ["哲学", "阅读"]


@pytest.mark.parametrize(
    "payload",
    [
        {"operation_id": " ", "ids": ["note-1"]},
        {"operation_id": "operation-1", "ids": []},
        {"operation_id": "operation-1", "ids": [" "]},
        {
            "operation_id": "operation-1",
            "ids": [f"note-{index}" for index in range(101)],
        },
    ],
)
def test_note_batch_ids_rejects_invalid_payload(payload):
    with pytest.raises(ValidationError):
        NoteBatchIdsRequest(**payload)
```

- [ ] **Step 4: 运行模型测试并确认失败**

Run:

```bash
./.venv/Scripts/python.exe -m pytest backend/tests/test_models.py -k "batch or protocol" -q
```

Expected: FAIL with import errors for the new request classes or missing `protocol_version`.

- [ ] **Step 5: 实现最小 schema 和模型契约**

在 `backend/database.py:init_db()` 使用现有 `_ensure_column()` 添加字段，并创建：

```sql
CREATE INDEX IF NOT EXISTS idx_highlights_view_updated
ON highlights(deleted_at, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_highlights_view_book
ON highlights(deleted_at, book_id);

CREATE INDEX IF NOT EXISTS idx_highlights_view_position
ON highlights(deleted_at, book_title, progress_percent);

CREATE TABLE IF NOT EXISTS note_batch_operations (
    operation_id TEXT PRIMARY KEY,
    operation_type TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    result_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);
```

在 `backend/models.py` 增加严格模型和 `model_validator(mode="after")`，规范化字符串、ID 和标签；`ids` 上限固定为 100，`tags` 上限固定为 50：

```python
class NoteBatchTagsRequest(BaseModel):
    operation_id: str = Field(min_length=1, max_length=128)
    ids: list[str] = Field(min_length=1, max_length=100)
    action: Literal["add", "remove"]
    tags: list[str] = Field(min_length=1, max_length=50)


class NoteBatchIdsRequest(BaseModel):
    operation_id: str = Field(min_length=1, max_length=128)
    ids: list[str] = Field(min_length=1, max_length=100)


class NoteBatchItem(BaseModel):
    id: str
    client_id: str = ""
    book_id: Optional[str] = None
    tags: list[str] = Field(default_factory=list)
    deleted_at: Optional[str] = None


class NoteBatchResult(BaseModel):
    operation_id: str
    affected: int
    unchanged: int
    items: list[NoteBatchItem] = Field(default_factory=list)
```

同时为 `HighlightCreate` 增加 `book_id: Optional[str] = None`，为 `BookSyncRequest` 增加 `protocol_version: Optional[int] = None`。不要让通用 highlight upsert 直接接受 `deleted_at`。

- [ ] **Step 6: 运行迁移、模型和旧数据库回归**

Run:

```bash
./.venv/Scripts/python.exe -m pytest backend/tests/test_notes_database.py -k "schema or migration" -q
./.venv/Scripts/python.exe -m pytest backend/tests/test_models.py -q
./.venv/Scripts/python.exe -m pytest backend/tests/test_database.py -q
```

Expected: all PASS；旧 highlight、draft 和 JSON export 测试不变。

- [ ] **Step 7: 提交 schema 与模型**

```bash
git add backend/database.py backend/models.py backend/tests/test_models.py backend/tests/test_notes_database.py
git commit -m "Add notes management schema"
```

---

### Task 2: 笔记查询数据库层

**Files:**
- Modify: `backend/database.py:20-376`
- Modify: `backend/tests/test_notes_database.py`
- Modify: `backend/tests/test_database.py:59-114`

**Interfaces:**
- Consumes: Task 1 的 `deleted_at` 与索引。
- Produces: `list_notes(...) -> dict[str, Any]`、`list_notes_for_export(...) -> list[dict[str, Any]]`、自排除 facets、可选 FTS5 trigram 与参数化 LIKE 回退。

- [ ] **Step 1: 写查询、筛选、分页和 facets 的失败测试**

在 `backend/tests/test_notes_database.py` 建立 `notes_db` fixture 和固定记录，至少覆盖两本书、两个作者、三个章节、四种颜色、有/无感悟、多标签和一条回收站记录。测试核心断言：

```python
def test_list_notes_combines_filters_and_returns_self_excluding_facets(notes_db):
    result = run(
        database.list_notes(
            q="思想",
            book_id="book-a",
            tags=["哲学", "重读"],
            note_kind="reflected",
            color="yellow",
            view="active",
            sort="updated_desc",
            limit=1,
            offset=0,
        )
    )

    assert [item["id"] for item in result["items"]] == ["note-a-new"]
    assert result["total"] == 2
    assert result["limit"] == 1
    assert result["offset"] == 0
    assert result["has_more"] is True
    assert {book["id"] for book in result["facets"]["books"]} == {
        "book-a",
        "book-b",
    }
    assert {tag["name"] for tag in result["facets"]["tags"]} >= {
        "哲学",
        "重读",
    }


def test_list_notes_separates_active_and_trash(notes_db):
    active = run(database.list_notes(view="active"))
    trash = run(database.list_notes(view="trash"))

    assert all(item["deleted_at"] is None for item in active["items"])
    assert [item["id"] for item in trash["items"]] == ["note-trash"]


def test_list_notes_uses_like_for_two_character_chinese_query(notes_db):
    result = run(database.list_notes(q="思想"))
    assert {item["id"] for item in result["items"]} == {
        "note-a-new",
        "note-a-old",
        "note-b",
    }


def test_list_notes_multi_tag_filter_uses_and_semantics(notes_db):
    result = run(database.list_notes(tags=["哲学", "重读"]))
    assert {item["id"] for item in result["items"]} == {
        "note-a-new",
        "note-a-old",
    }
```

为 `note_kind`、四种 sort、稳定次级键和 FTS 不可用回退分别写参数化测试；对旧 `get_all_highlights()`、`get_materials()` 增加“默认不返回 deleted_at 非空记录”的回归断言。

- [ ] **Step 2: 运行查询测试并确认失败**

Run:

```bash
./.venv/Scripts/python.exe -m pytest backend/tests/test_notes_database.py -k "search or filter or sort or pagination or facet or view" -q
```

Expected: FAIL with `AttributeError: module 'database' has no attribute 'list_notes'`。

- [ ] **Step 3: 实现参数化查询构造器与可降级搜索索引**

在 `backend/database.py` 增加三个固定接口：

- `_build_notes_where(*, q: str | None, book_id: str | None, tags: list[str], note_kind: str, color: str | None, view: str, ignore_book_filter: bool = False, ignore_tag_filter: bool = False, use_fts: bool = False) -> tuple[str, list[Any]]`
- `list_notes(*, q: str | None = None, book_id: str | None = None, tags: list[str] | None = None, note_kind: str = "all", color: str | None = None, view: str = "active", sort: str = "updated_desc", limit: int = 50, offset: int = 0) -> dict[str, Any]`
- `list_notes_for_export(*, q: str | None = None, book_id: str | None = None, tags: list[str] | None = None, note_kind: str = "all", color: str | None = None) -> list[dict[str, Any]]`

查询构造器从以下固定片段组合条件和参数，不接收任意 SQL：

```python
clauses = [
    "highlights.deleted_at IS NULL"
    if view == "active"
    else "highlights.deleted_at IS NOT NULL"
]
params: list[Any] = []

if book_id and not ignore_book_filter:
    clauses.append("highlights.book_id = ?")
    params.append(book_id)

for tag in ([] if ignore_tag_filter else tags):
    clauses.append(
        "EXISTS (SELECT 1 FROM json_each(highlights.tags) "
        "WHERE json_each.value = ?)"
    )
    params.append(tag)
```

实现要求：

- 所有值都进入 `?` 参数；sort 仅从固定映射选择 SQL 片段。
- 多标签使用每个标签一个 `EXISTS (SELECT 1 FROM json_each(highlights.tags) ...)`，形成 AND。
- `reflected` 使用 `TRIM(COALESCE(note, '')) <> ''`；`highlight_only` 使用相反条件。
- `updated_desc`、`created_desc`、`position`、`book` 都追加稳定的 `id` 次级键。
- facets 在完整匹配集上计算；book facet 忽略当前 book filter，tag facet 忽略当前 tag filter。
- 尝试创建 `highlights_notes_fts` 和 insert/update/delete triggers；trigram 或 FTS5 不可用时捕获 `sqlite3.OperationalError` 并使用 LIKE。
- `list_notes_for_export()` 不通过超大 limit 模拟无限分页，直接查询全部活动结果并按书名、进度、创建时间、id 排序。
- `get_all_highlights()`、`get_materials()` 和 `get_highlights_by_ids()` 对面向用户的读取默认排除回收站，但不改变返回字段形状。

- [ ] **Step 4: 运行查询测试并修到通过**

Run:

```bash
./.venv/Scripts/python.exe -m pytest backend/tests/test_notes_database.py -k "search or filter or sort or pagination or facet or view" -q
./.venv/Scripts/python.exe -m pytest backend/tests/test_database.py -q
```

Expected: all PASS；在支持和不支持 trigram 的测试分支中都能查询。

- [ ] **Step 5: 提交查询层**

```bash
git add backend/database.py backend/tests/test_notes_database.py backend/tests/test_database.py
git commit -m "Add notes query database layer"
```

---

### Task 3: `GET /api/notes` 查询接口

**Files:**
- Create: `backend/tests/test_notes_api.py`
- Modify: `backend/main.py:20-50,98-107,144-178`
- Modify: `backend/tests/test_api.py:74-189`

**Interfaces:**
- Consumes: Task 2 `database.list_notes()`。
- Produces: `GET /api/notes`，参数 `q/book_id/tag/note_kind/color/view/sort/limit/offset`，返回 `items/total/limit/offset/has_more/facets`。

- [ ] **Step 1: 写 API 参数和响应契约的失败测试**

在 `backend/tests/test_notes_api.py` 复用隔离 TestClient 模式，添加：

```python
def test_list_notes_endpoint_validates_query_and_returns_facets(client, seeded_notes):
    response = client.get(
        "/api/notes",
        params=[
            ("q", " 思想 "),
            ("book_id", "book-a"),
            ("tag", "哲学"),
            ("tag", "重读"),
            ("note_kind", "reflected"),
            ("color", "yellow"),
            ("sort", "updated_desc"),
            ("limit", "20"),
            ("offset", "0"),
        ],
    )

    assert response.status_code == 200
    payload = response.json()
    assert set(payload) == {
        "items",
        "total",
        "limit",
        "offset",
        "has_more",
        "facets",
    }
    assert {
        "id",
        "client_id",
        "book_id",
        "book_title",
        "book_author",
        "chapter",
        "cfi_range",
        "progress_percent",
        "highlight_text",
        "note",
        "tags",
        "color",
        "status",
        "created_at",
        "received_at",
        "updated_at",
        "deleted_at",
    } <= set(payload["items"][0])
    assert response.headers["cache-control"] == "private, no-store"


@pytest.mark.parametrize("query", ["字", " 字 "])
def test_list_notes_endpoint_rejects_one_character_search(client, query):
    response = client.get("/api/notes", params={"q": query})
    assert response.status_code == 422


@pytest.mark.parametrize(
    "params",
    [
        {"note_kind": "invalid"},
        {"view": "invalid"},
        {"sort": "invalid"},
        {"color": "purple"},
        {"limit": 0},
        {"limit": 101},
        {"offset": -1},
    ],
)
def test_list_notes_endpoint_rejects_invalid_parameters(client, params):
    assert client.get("/api/notes", params=params).status_code == 422
```

- [ ] **Step 2: 运行 API 测试并确认 404/422 预期失败**

Run:

```bash
./.venv/Scripts/python.exe -m pytest backend/tests/test_notes_api.py -k "list_notes" -q
```

Expected: FAIL，主成功用例得到 404；参数测试不能因 fixture 错误失败。

- [ ] **Step 3: 实现 FastAPI 路由**

在静态挂载之前注册：

```python
@app.get("/api/notes")
async def list_notes_endpoint(
    q: Optional[str] = None,
    book_id: Optional[str] = None,
    tag: list[str] = Query(default=[]),
    note_kind: Literal["all", "reflected", "highlight_only"] = "all",
    color: Optional[Literal["yellow", "green", "blue", "pink"]] = None,
    view: Literal["active", "trash"] = "active",
    sort: Literal["updated_desc", "created_desc", "position", "book"] = "updated_desc",
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> dict:
    normalized_query = q.strip() if q else None
    if normalized_query and len(normalized_query) < 2:
        raise HTTPException(status_code=422, detail="搜索关键词至少需要 2 个字符")
    return await list_notes(
        q=normalized_query,
        book_id=book_id,
        tags=tag,
        note_kind=note_kind,
        color=color,
        view=view,
        sort=sort,
        limit=limit,
        offset=offset,
    )
```

确保路由经过现有 API no-store middleware，且不修改旧 `/api/highlights` 和 `/api/materials` 响应。

- [ ] **Step 4: 运行新接口和旧接口回归**

Run:

```bash
./.venv/Scripts/python.exe -m pytest backend/tests/test_notes_api.py -k "list_notes" -q
./.venv/Scripts/python.exe -m pytest backend/tests/test_api.py -k "cache_headers or highlights or materials" -q
```

Expected: all PASS。

- [ ] **Step 5: 提交查询 API**

```bash
git add backend/main.py backend/tests/test_notes_api.py backend/tests/test_api.py
git commit -m "Expose notes management query API"
```

---

### Task 4: 事务化批量标签与回收站 API

**Files:**
- Create: `backend/notes.py`
- Create: `backend/tests/test_notes.py`
- Modify: `backend/database.py:286-376`
- Modify: `backend/main.py:20-50,190-216,564-589`
- Modify: `backend/tests/test_notes_database.py`
- Modify: `backend/tests/test_notes_api.py`

**Interfaces:**
- Consumes: Task 1 的 batch 模型和 `note_batch_operations`。
- Produces: `normalize_note_tags()`、`batch_update_note_tags()`、`batch_trash_notes()`、`batch_restore_notes()`、`batch_delete_notes()` 及四个 `/api/notes/batch/*` 路由。

- [ ] **Step 1: 写标签规范化纯函数的失败测试**

```python
from notes import normalize_note_tags


def test_normalize_note_tags_preserves_first_occurrence():
    assert normalize_note_tags([" 哲学 ", "", "哲学", "阅读", " 阅读 "]) == [
        "哲学",
        "阅读",
    ]
```

Run:

```bash
./.venv/Scripts/python.exe -m pytest backend/tests/test_notes.py::test_normalize_note_tags_preserves_first_occurrence -q
```

Expected: FAIL with `ModuleNotFoundError: No module named 'notes'`。

- [ ] **Step 2: 实现 `normalize_note_tags()` 并运行通过**

```python
def normalize_note_tags(tags: list[str]) -> list[str]:
    normalized = []
    seen = set()
    for tag in tags:
        value = tag.strip()
        if not value or value in seen:
            continue
        seen.add(value)
        normalized.append(value)
    return normalized
```

Run:

```bash
./.venv/Scripts/python.exe -m pytest backend/tests/test_notes.py -q
```

Expected: PASS。

- [ ] **Step 3: 写批量事务和幂等的失败测试**

在数据库测试中明确覆盖追加、移除、冲突、回滚和永久删除约束：

```python
def test_batch_tags_is_atomic_and_idempotent(notes_db):
    first = run(
        database.batch_update_note_tags(
            operation_id="tags-1",
            ids=["note-a-new", "note-a-old"],
            action="add",
            tags=[" 新标签 ", "新标签"],
        )
    )
    replay = run(
        database.batch_update_note_tags(
            operation_id="tags-1",
            ids=["note-a-new", "note-a-old"],
            action="add",
            tags=["新标签"],
        )
    )
    assert first == replay
    assert first["affected"] == 2
    assert all(item["tags"].count("新标签") == 1 for item in first["items"])


def test_batch_operation_id_collision_rejects_different_request(notes_db):
    run(
        database.batch_trash_notes(
            operation_id="trash-1",
            ids=["note-a-new"],
        )
    )
    with pytest.raises(database.NoteBatchConflict):
        run(
            database.batch_trash_notes(
                operation_id="trash-1",
                ids=["note-a-old"],
            )
        )


def test_batch_delete_rejects_active_note_without_partial_delete(notes_db):
    with pytest.raises(database.NoteBatchConflict):
        run(
            database.batch_delete_notes(
                operation_id="delete-1",
                ids=["note-trash", "note-a-new"],
            )
        )
    active = run(database.get_highlight("note-a-new"))
    trashed = run(database.get_highlight("note-trash"))
    assert active is not None
    assert trashed is not None
```

API 测试断言响应统一为 `operation_id/affected/unchanged/items`，同 operation ID 不同请求返回 409，超过 100 IDs 返回 422。

- [ ] **Step 4: 运行 batch 测试并确认缺少函数/路由**

Run:

```bash
./.venv/Scripts/python.exe -m pytest backend/tests/test_notes_database.py -k "batch" -q
./.venv/Scripts/python.exe -m pytest backend/tests/test_notes_api.py -k "batch" -q
```

Expected: FAIL with missing database functions and 404 endpoints。

- [ ] **Step 5: 实现同事务幂等与批量数据库函数**

新增 `NoteBatchConflict`，规范化请求后用排序 JSON 的 SHA-256 作为 `request_hash`。在单一 `BEGIN IMMEDIATE` 事务中执行：读取历史结果、验证所有记录状态、修改数据、保存 `result_json`、commit。核心签名固定为：

- `batch_update_note_tags(*, operation_id: str, ids: list[str], action: str, tags: list[str]) -> dict[str, Any]`
- `batch_trash_notes(*, operation_id: str, ids: list[str]) -> dict[str, Any]`
- `batch_restore_notes(*, operation_id: str, ids: list[str]) -> dict[str, Any]`
- `batch_delete_notes(*, operation_id: str, ids: list[str]) -> dict[str, Any]`

四个函数统一返回：

```python
{
    "operation_id": operation_id,
    "affected": affected_count,
    "unchanged": unchanged_count,
    "items": changed_or_deleted_identity_rows,
}
```

状态规则：

- tags 仅允许活动记录；任一不存在/已删除记录使整批回滚。
- trash 对活动记录设置同一 UTC `deleted_at`，已在回收站计入 unchanged，不存在 ID 计入 unchanged。
- restore 清空回收站记录的 `deleted_at`，活动/不存在计入 unchanged。
- delete 仅删除回收站记录；活动记录导致 409 和整批回滚；不存在 ID 计入 unchanged。
- 每次 tags/trash/restore 成功后刷新旧 JSON export；delete 后也刷新。

- [ ] **Step 6: 暴露批量 API 并映射冲突状态**

在 `backend/main.py` 添加四个 `POST` 路由。`NoteBatchConflict` 映射为 HTTP 409；其他验证由 Pydantic 返回 422：

```python
@app.post("/api/notes/batch/tags", response_model=NoteBatchResult)
async def batch_note_tags_endpoint(request: NoteBatchTagsRequest) -> NoteBatchResult:
    try:
        result = await batch_update_note_tags(**request.model_dump())
    except NoteBatchConflict as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    await _export_notes()
    return NoteBatchResult(**result)
```

对 trash、restore、delete 使用对应函数和相同错误映射。

- [ ] **Step 7: 运行 batch 与旧 CRUD/JSON 回归**

Run:

```bash
./.venv/Scripts/python.exe -m pytest backend/tests/test_notes_database.py -k "batch" -q
./.venv/Scripts/python.exe -m pytest backend/tests/test_notes_api.py -k "batch" -q
./.venv/Scripts/python.exe -m pytest backend/tests/test_api.py -k "HighlightCrud or NotesExport" -q
```

Expected: all PASS；旧 `DELETE /api/highlights/{id}` 仍永久删除。

- [ ] **Step 8: 提交批量 API**

```bash
git add backend/notes.py backend/database.py backend/main.py backend/tests/test_notes.py backend/tests/test_notes_database.py backend/tests/test_notes_api.py
git commit -m "Add batch notes management operations"
```

---

### Task 5: 跨设备回收站同步协议 v2

**Files:**
- Modify: `backend/library.py:359-561`
- Modify: `backend/main.py:533-546`
- Modify: `backend/models.py:46-58`
- Modify: `backend/tests/test_notes_api.py`
- Modify: `backend/tests/test_api.py:466-565`

**Interfaces:**
- Consumes: `BookSyncRequest.protocol_version` 和 `highlights.deleted_at`。
- Produces: `sync_book_state(book_id, operations, protocol_version=None)`；协议 v2 操作 `highlight.trash`、`highlight.restore`、受限 `highlight.delete`。

- [ ] **Step 1: 写旧协议兼容和 v2 状态机的失败测试**

```python
def test_sync_protocol_v2_trash_restore_and_delete(client, uploaded_book, synced_note):
    book_id = uploaded_book["id"]

    trashed = client.post(
        f"/api/books/{book_id}/sync",
        json={
            "protocol_version": 2,
            "operations": [
                {
                    "op_id": "trash-op",
                    "type": "highlight.trash",
                    "entity_id": synced_note["client_id"],
                    "payload": {},
                }
            ],
        },
    )
    assert trashed.status_code == 200
    trashed_note = next(
        item for item in trashed.json()["highlights"]
        if item["client_id"] == synced_note["client_id"]
    )
    assert trashed_note["deleted_at"] is not None

    restored = client.post(
        f"/api/books/{book_id}/sync",
        json={
            "protocol_version": 2,
            "operations": [
                {
                    "op_id": "restore-op",
                    "type": "highlight.restore",
                    "entity_id": synced_note["client_id"],
                    "payload": {},
                }
            ],
        },
    )
    assert restored.status_code == 200
    assert next(
        item for item in restored.json()["highlights"]
        if item["client_id"] == synced_note["client_id"]
    )["deleted_at"] is None


def test_sync_protocol_v2_rejects_permanent_delete_of_active_note(client, uploaded_book, synced_note):
    response = client.post(
        f"/api/books/{uploaded_book['id']}/sync",
        json={
            "protocol_version": 2,
            "operations": [
                {
                    "op_id": "delete-active-op",
                    "type": "highlight.delete",
                    "entity_id": synced_note["client_id"],
                    "payload": {},
                }
            ],
        },
    )
    assert response.status_code == 409


def test_legacy_sync_delete_remains_permanent(client, uploaded_book, synced_note):
    response = client.post(
        f"/api/books/{uploaded_book['id']}/sync",
        json={
            "operations": [
                {
                    "op_id": "legacy-delete-op",
                    "type": "highlight.delete",
                    "entity_id": synced_note["client_id"],
                    "payload": {},
                }
            ]
        },
    )
    assert response.status_code == 200
    assert response.json()["highlights"] == []
```

再断言相同 op_id 重放不增加 revision，upsert 不隐式清除 deleted_at，整书删除仍永久清理。

- [ ] **Step 2: 运行同步协议测试并确认新操作被拒绝**

Run:

```bash
./.venv/Scripts/python.exe -m pytest backend/tests/test_notes_api.py -k "sync_protocol or legacy_sync" -q
```

Expected: FAIL，v2 操作返回 400/422 或无 `deleted_at`。

- [ ] **Step 3: 实现版本化同步状态机**

将签名固定为 `sync_book_state(book_id: str, operations: list[dict], protocol_version: int | None = None) -> dict`。保留现有事务、op_id 去重和 revision 返回结构，只在操作分派处加入版本化分支。

允许操作：

```text
progress.set
bookmark.upsert
bookmark.delete
highlight.upsert
highlight.trash
highlight.restore
highlight.delete
```

新增 `_trash_synced_highlight()`、`_restore_synced_highlight()`、`_delete_trashed_synced_highlight()`。规则：

- 无 `protocol_version` 的 `highlight.delete` 保持旧版无条件永久删除。
- `protocol_version >= 2` 的 `highlight.delete` 只能删除 `deleted_at IS NOT NULL`；活动记录触发领域冲突并回滚整个请求。
- trash/restore/delete 找不到记录均作为幂等 no-op，但首次 op_id 仍按现有规则记账。
- `_upsert_synced_highlight()` 的 UPDATE 不修改 `deleted_at`，INSERT 明确为 NULL。
- `get_book_state()` 返回活动与回收站记录和 `deleted_at`。

在 `backend/main.py` 传递：

```python
return await sync_book_state(
    book_id,
    [operation.model_dump() for operation in request.operations],
    protocol_version=request.protocol_version,
)
```

- [ ] **Step 4: 运行协议与整书删除回归**

Run:

```bash
./.venv/Scripts/python.exe -m pytest backend/tests/test_notes_api.py -k "sync_protocol or legacy_sync or cross_device" -q
./.venv/Scripts/python.exe -m pytest backend/tests/test_api.py -k "cross_device_state_sync_is_idempotent or delete_removes_file_and_reader_state" -q
```

Expected: all PASS；旧无协议请求 revision 规则不变。

- [ ] **Step 5: 提交同步协议**

```bash
git add backend/library.py backend/main.py backend/models.py backend/tests/test_notes_api.py backend/tests/test_api.py
git commit -m "Add recoverable highlight sync operations"
```

---

### Task 6: 服务端 Markdown 下载

**Files:**
- Modify: `backend/notes.py`
- Modify: `backend/main.py:564-589`
- Modify: `backend/tests/test_notes.py`
- Modify: `backend/tests/test_notes_api.py`
- Modify: `backend/tests/test_api.py:807-837`

**Interfaces:**
- Consumes: Task 2 `list_notes_for_export()`。
- Produces: `escape_markdown_inline()`、`markdown_blockquote()`、`render_notes_markdown()`、`notes_markdown_filename()`、`GET /api/notes/export.md`。

- [ ] **Step 1: 写 Markdown 分组、排序和转义的失败测试**

```python
from datetime import date

from notes import (
    markdown_blockquote,
    notes_markdown_filename,
    render_notes_markdown,
)


def test_markdown_blockquote_handles_multiline_text():
    assert markdown_blockquote("第一行\n第二行") == "> 第一行\n> 第二行"


def test_render_notes_markdown_groups_books_and_sorts_by_position():
    markdown = render_notes_markdown(
        [
            {
                "id": "later",
                "book_title": "书甲",
                "book_author": "作者甲",
                "chapter": "第二章",
                "progress_percent": 70,
                "highlight_text": "后面的划线",
                "note": "后面的感悟",
                "tags": ["重读"],
                "created_at": "2026-01-02T00:00:00Z",
                "updated_at": "2026-01-03T00:00:00Z",
            },
            {
                "id": "earlier",
                "book_title": "书甲",
                "book_author": "作者甲",
                "chapter": "第一章",
                "progress_percent": 20,
                "highlight_text": "前面的划线",
                "note": "",
                "tags": [],
                "created_at": "2026-01-01T00:00:00Z",
                "updated_at": "2026-01-01T00:00:00Z",
            },
        ]
    )
    assert markdown.index("前面的划线") < markdown.index("后面的划线")
    assert markdown.count("## 《书甲》") == 1
    assert "**感悟**" in markdown
    assert "**标签**：重读" in markdown


def test_notes_markdown_filename_uses_supplied_date():
    assert notes_markdown_filename(date(2026, 9, 20)) == "Marginalia-笔记-2026-09-20.md"
```

- [ ] **Step 2: 运行纯函数测试并确认失败**

Run:

```bash
./.venv/Scripts/python.exe -m pytest backend/tests/test_notes.py -q
```

Expected: FAIL with missing Markdown functions。

- [ ] **Step 3: 实现 Markdown 纯函数**

输出固定结构：文档标题、按书分组、作者、章节与进度、逐行 blockquote、可选感悟、可选标签、创建和更新时间。标题/内联元数据转义反斜杠、反引号、`*`、`_`、`[`、`]`；用户多行正文不作为标题或同级列表输出。

函数签名固定为：

- `escape_markdown_inline(value: str) -> str`
- `markdown_blockquote(value: str) -> str`
- `render_notes_markdown(notes: list[dict[str, Any]], *, offline: bool = False) -> str`
- `notes_markdown_filename(today: date | None = None) -> str`

`escape_markdown_inline()` 按 `\\`、反引号、`*`、`_`、`[`、`]` 的顺序加反斜杠；`markdown_blockquote()` 对 `splitlines() or [""]` 的每行加 `> `。`render_notes_markdown()` 先按 `(book_title, book_author)` 分组，再按 `(progress_percent, created_at, id)` 排序并用空行连接各段。`notes_markdown_filename()` 使用传入日期或 `date.today()`。`offline=True` 时标题下增加 `> 离线导出，可能不完整。`；服务端始终传 `False`。

- [ ] **Step 4: 写并运行 Markdown API 失败测试**

```python
def test_export_notes_markdown_uses_filters_and_download_headers(client, seeded_notes):
    response = client.get(
        "/api/notes/export.md",
        params=[("book_id", "book-a"), ("tag", "哲学")],
    )
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/markdown")
    disposition = response.headers["content-disposition"]
    assert "Marginalia-" in disposition
    assert ".md" in disposition
    assert "书甲" in response.text
    assert "书乙" not in response.text
    assert "回收站内容" not in response.text


def test_export_notes_markdown_rejects_empty_result(client):
    response = client.get("/api/notes/export.md", params={"book_id": "missing"})
    assert response.status_code == 422
    assert response.json()["detail"] == "当前筛选条件下没有可导出的笔记"
```

Run:

```bash
./.venv/Scripts/python.exe -m pytest backend/tests/test_notes_api.py -k "markdown" -q
```

Expected: FAIL with 404。

- [ ] **Step 5: 实现 `GET /api/notes/export.md`**

接口只接受 `q/book_id/tag/note_kind/color`，不接受分页、回收站和本地同步状态。调用 `list_notes_for_export()`；空结果返回 422；用 `Response` 返回 UTF-8 Markdown 和带 RFC 5987 UTF-8 文件名的下载头。不要写入服务器磁盘或 Obsidian 目录。

- [ ] **Step 6: 运行 Markdown 与旧 JSON export 回归**

Run:

```bash
./.venv/Scripts/python.exe -m pytest backend/tests/test_notes.py -q
./.venv/Scripts/python.exe -m pytest backend/tests/test_notes_api.py -k "markdown" -q
./.venv/Scripts/python.exe -m pytest backend/tests/test_api.py -k "NotesExport" -q
```

Expected: all PASS；`GET /api/notes/export` 仍返回 JSON 数组。

- [ ] **Step 7: 提交 Markdown 下载**

```bash
git add backend/notes.py backend/main.py backend/tests/test_notes.py backend/tests/test_notes_api.py backend/tests/test_api.py
git commit -m "Add filtered notes Markdown export"
```

---

### Task 7: 笔记管理页面 shell、兼容路由与测试 helper

**Files:**
- Create: `frontend/tests/helpers/notes-management.mjs`
- Create: `frontend/tests/notes-management.spec.js`
- Modify: `frontend/index.html:7-345`
- Modify: `frontend/app.js:9-240,490-566,4773-5064`
- Modify: `frontend/style.css:231-374,1632-1816,2049-2724`
- Modify: `frontend/tests/mobile-layout.spec.js:255-307`

**Interfaces:**
- Consumes: 现有三个顶级 view 和 toast/dialog 样式。
- Produces: `INDEXED_DB_VERSION = 6` helper、`#/creation` 管理 shell、`getRouteFromHash()`、`navigateToRoute()`、`applyCurrentRoute()`、兼容 `showCreation()`。

- [ ] **Step 1: 创建统一 IndexedDB v6 和 API mock helper**

`frontend/tests/helpers/notes-management.mjs` 导出：

```javascript
export const INDEXED_DB_NAME = 'marginalia';
export const INDEXED_DB_VERSION = 6;

export function makeNote(overrides = {}) {
  return {
    id: 'note-1',
    client_id: 'client-note-1',
    server_id: 'note-1',
    book_id: 'book-1',
    book_title: '测试书',
    book_author: '测试作者',
    chapter: '第一章',
    cfi_range: 'epubcfi(/6/2!/4/2/2)',
    highlight_text: '测试划线',
    note: '测试感悟',
    tags: ['阅读'],
    color: 'yellow',
    status: 'reflected',
    progress_percent: 25,
    created_at: '2026-09-20T00:00:00Z',
    updated_at: '2026-09-20T00:00:00Z',
    deleted_at: null,
    synced: true,
    ...overrides,
  };
}
```

同时实现 `seedNotesIndexedDb(page, { books, highlights, operations })`、`readNotesIndexedDb(page)`、`readSyncQueue(page)` 和 `installNotesApiRoutes(page, state)`；helper 必须创建/升级 `books/highlights/deleted_highlights/bookmarks/sync_queue`，不可删除旧 store。

- [ ] **Step 2: 写 shell、路由和旧入口移除的失败测试**

```javascript
import { test, expect } from '@playwright/test';
import { installNotesApiRoutes } from './helpers/notes-management.mjs';


test('creation route renders notes management without draft tools', async ({ page }) => {
  await installNotesApiRoutes(page, { notes: [] });
  await page.goto('/#/creation');

  await expect(page.getByRole('heading', { name: '笔记管理' })).toBeVisible();
  await expect(page.getByRole('button', { name: '导出 Markdown' })).toBeVisible();
  await expect(page.getByRole('button', { name: '回收站' })).toBeVisible();
  await expect(page.getByText('公众号稿件')).toHaveCount(0);
  await expect(page.getByText('视频号稿件')).toHaveCount(0);
  await expect(page.getByText('导出到 Obsidian')).toHaveCount(0);
});


test('notes management returns to library and browser history restores route', async ({ page }) => {
  await installNotesApiRoutes(page, { notes: [] });
  await page.goto('/#/');
  await page.getByRole('button', { name: '笔记管理' }).click();
  await expect(page).toHaveURL(/#\/creation$/);
  await page.getByRole('button', { name: '返回主界面' }).click();
  await expect(page).toHaveURL(/#\/$/);
  await page.goBack();
  await expect(page).toHaveURL(/#\/creation$/);
});
```

再断言阅读侧栏说明包含“展开后可定位原文或编辑感悟”，不包含“单击跳回原文，双击编辑感悟”。

- [ ] **Step 3: 运行 shell 测试并确认旧创作页导致失败**

Run:

```bash
cd frontend && npm test -- tests/notes-management.spec.js --grep "creation route|history|reader hint"
```

Expected: FAIL，找不到“笔记管理”标题/回收站或仍存在稿件 DOM。

- [ ] **Step 4: 替换 HTML shell 并保留历史后端能力**

将 `#creation-view` 内容替换为：

- header：返回主界面、标题“笔记管理”、数据状态、导出 Markdown、回收站切换；
- search/filter row：搜索、书籍、标签、内容类型、颜色、排序、待同步视图、清空筛选；
- batch bar：当前页全选、计数、添加标签、移除标签、移入回收站；
- main：列表、分页、详情；
- 回收站 action bar：恢复、永久删除、清空回收站；
- 三选项未保存确认 dialog 和数量确认 dialog；
- `aria-live` 状态区。

彻底移除 draft、稿件生成、稿件编辑、Obsidian/JSON 前端入口，但不修改后端接口。将导航和书库按钮文案改为“笔记管理”。更新阅读侧栏说明。

- [ ] **Step 5: 实现 hash 路由和 IndexedDB v6 最小骨架**

在 `frontend/app.js`：

```javascript
const DB_VERSION = 6;

function getRouteFromHash() {
  const route = window.location.hash.replace(/^#/, '') || '/';
  return ['/', '/reader', '/creation'].includes(route) ? route : '/';
}

async function navigateToRoute(route, { replace = false } = {}) {
  const hash = `#${route}`;
  if (replace) {
    history.replaceState({}, '', hash);
  } else if (window.location.hash !== hash) {
    history.pushState({}, '', hash);
  }
  await applyCurrentRoute();
}

async function showCreation() {
  await navigateToRoute('/creation');
}
```

`applyCurrentRoute()` 只负责切换 library/reader/creation 顶级 view；监听 `hashchange` 和 `popstate`。本任务只提供空列表/空详情状态，不实现 API 数据加载。`openDB()` 升级时只确保 store 存在，不删除任何 store。

- [ ] **Step 6: 增加笔记管理基础布局样式**

桌面端 `.notes-management-layout` 为列表/详情双栏；移动断点暂时把详情隐藏。复用现有按钮/token，不引入新字体和依赖。所有新 controls 有可见 focus；颜色不得作为唯一文本状态。

- [ ] **Step 7: 运行 shell 和移动结构测试**

Run:

```bash
cd frontend && npm test -- tests/notes-management.spec.js --grep "creation route|history|reader hint"
cd frontend && npm test -- tests/mobile-layout.spec.js --grep "workspace|creation"
```

Expected: all PASS；页面尚未加载真实笔记是本任务允许的状态。

- [ ] **Step 8: 提交页面 shell**

```bash
git add frontend/index.html frontend/app.js frontend/style.css frontend/tests/helpers/notes-management.mjs frontend/tests/notes-management.spec.js frontend/tests/mobile-layout.spec.js
git commit -m "Replace creation shell with notes management"
```

---

### Task 8: 在线查询、离线回退、筛选、分页与待同步视图

**Files:**
- Modify: `frontend/app.js:33-84,90-198,242-449,4356-4472,4475-4743`
- Modify: `frontend/tests/helpers/notes-management.mjs`
- Modify: `frontend/tests/notes-management.spec.js`
- Modify: `frontend/tests/ai-qa.spec.js:22-39,325-348`

**Interfaces:**
- Consumes: Task 3 `/api/notes` 和 Task 7 shell/IDB v6。
- Produces: `createDefaultNotesQuery()`、`buildNotesQueryParams()`、`fetchServerNotes()`、`loadOfflineNotes()`、`loadPendingNotes()`、`mergeServerAndLocalNotes()`、`filterAndSortLocalNotes()`、`loadNotesManagement()`。

- [ ] **Step 1: 写在线、搜索防抖、组合筛选和分页失败测试**

Playwright mock 记录 `/api/notes` 请求：

```javascript
test('online notes query sends filters and paginates', async ({ page }) => {
  const state = { notes: [makeNote()], requests: [] };
  await installNotesApiRoutes(page, state);
  await page.goto('/#/creation');

  await page.getByLabel('搜索笔记').fill('思想');
  await page.getByLabel('内容类型').selectOption('reflected');
  await page.getByLabel('高亮颜色').selectOption('yellow');
  await page.getByLabel('排序').selectOption('position');

  await expect.poll(() => state.requests.length).toBe(1);
  const url = new URL(state.requests[0]);
  expect(url.searchParams.get('q')).toBe('思想');
  expect(url.searchParams.get('note_kind')).toBe('reflected');
  expect(url.searchParams.get('color')).toBe('yellow');
  expect(url.searchParams.get('sort')).toBe('position');
  expect(url.searchParams.get('offset')).toBe('0');
});


test('one character search stays local and shows guidance', async ({ page }) => {
  const state = { notes: [], requests: [] };
  await installNotesApiRoutes(page, state);
  await page.goto('/#/creation');
  state.requests.length = 0;
  await page.getByLabel('搜索笔记').fill('字');
  await page.waitForTimeout(400);
  expect(state.requests).toHaveLength(0);
  await expect(page.getByText('至少输入 2 个字符')).toBeVisible();
});
```

- [ ] **Step 2: 写离线回退、旧列表保留和待同步独立视图失败测试**

```javascript
test('initial API failure falls back to IndexedDB with incomplete warning', async ({ page }) => {
  await seedNotesIndexedDb(page, { highlights: [makeNote({ synced: false })] });
  await page.route('**/api/notes**', route => route.abort('failed'));
  await page.goto('/#/creation');

  await expect(page.getByText('测试划线')).toBeVisible();
  await expect(page.getByText('离线数据，可能不完整')).toBeVisible();
});


test('pending view uses local queue instead of filtering server page', async ({ page }) => {
  const pending = makeNote({ id: 'local-note', server_id: null, synced: false });
  await seedNotesIndexedDb(page, {
    highlights: [pending],
    operations: [{
      key: 'highlight.upsert:book-1:local-note',
      op_id: 'pending-op',
      book_id: 'book-1',
      type: 'highlight.upsert',
      entity_id: 'local-note',
      payload: pending,
    }],
  });
  await installNotesApiRoutes(page, { notes: [makeNote()] });
  await page.goto('/#/creation');
  await page.getByLabel('数据范围').selectOption('pending');

  await expect(page.getByText('测试划线')).toBeVisible();
  await expect(page.getByText('待同步')).toBeVisible();
});
```

- [ ] **Step 3: 运行查询用例并确认空骨架失败**

Run:

```bash
cd frontend && npm test -- tests/notes-management.spec.js --grep "online|offline|search|filter|sort|pagination|pending"
```

Expected: FAIL，列表不加载或控件不触发查询。

- [ ] **Step 4: 实现查询状态和 300ms 防抖**

新增固定状态：

```javascript
function createDefaultNotesQuery() {
  return {
    q: '',
    bookId: '',
    tags: [],
    noteKind: 'all',
    color: '',
    view: 'active',
    sort: 'updated_desc',
    dataScope: 'all',
    limit: 50,
    offset: 0,
  };
}
```

实现：

```javascript
function buildNotesQueryParams(query, { includePaging = true } = {})
async function fetchServerNotes(query)
async function loadOfflineNotes(query)
async function loadPendingNotes()
function getStableNoteKey(note)
function mergeServerAndLocalNotes(serverItems, localItems, queuedOperations)
function filterAndSortLocalNotes(items, query)
async function loadNotesManagement({ preserveDetail = false } = {})
```

规则：

- q trim 后 1 字符不请求；空字符串不发送 q。
- 初次请求失败且本地有数据时自动回退并显示范围提示；后续失败保留已有列表并显示重试。
- stable key 顺序：`server_id`、服务器 `id`、`client_id`、本地 `id`。
- 队列中的 upsert/trash/restore/delete 覆盖同一 identity；不能让服务器快照闪回旧状态。
- `pending` 只读取本机 highlights + sync_queue，不对服务器分页结果二次过滤。
- 筛选变化把 offset 归零并清空选择。
- 在线 facets 填充书籍和标签控件；离线从本地完整匹配集计算。

- [ ] **Step 5: 修复服务器快照合并，保护本地 pending**

将 `applyServerBookState()` 的“先删本书全部 highlights”替换为：

```javascript
async function reconcileServerHighlights(bookId, serverHighlights, queuedOperations) {
  // 建立 server/local/queued identity map；保留 queued upsert/trash/restore/delete，
  // 仅删除服务器权威集合中缺失且没有本地 pending 的已同步记录。
}
```

发送 book sync 时加入 `protocol_version: 2`，并让回收站记录写入 `deleted_at`。正常 reader notes 和视觉 highlights 只读取 `deleted_at == null`。

- [ ] **Step 6: 将旧硬编码 IDB v5 测试切换到共享 helper**

更新 `frontend/tests/ai-qa.spec.js` 和 `frontend/tests/mobile-layout.spec.js` 使用 `INDEXED_DB_VERSION`、`seedNotesIndexedDb()` 和读取 helper，确保 v6 升级后旧 store 与数据仍存在。

- [ ] **Step 7: 运行查询与导入/同步回归**

Run:

```bash
cd frontend && npm test -- tests/notes-management.spec.js --grep "online|offline|search|filter|sort|pagination|pending"
cd frontend && npm test -- tests/ai-qa.spec.js
cd frontend && npm test -- tests/server-sync.spec.js
```

Expected: all PASS；重新导入 EPUB 仍保留本地划线/感悟/书签。

- [ ] **Step 8: 提交数据加载层**

```bash
git add frontend/app.js frontend/tests/helpers/notes-management.mjs frontend/tests/notes-management.spec.js frontend/tests/ai-qa.spec.js frontend/tests/mobile-layout.spec.js
git commit -m "Load notes with offline fallback"
```

---

### Task 9: 详情编辑、标签规范化、脏草稿保护与删除感悟撤销

**Files:**
- Modify: `frontend/app.js:3586-3715,4475-4743,4954-4990`
- Modify: `frontend/index.html:214-342`
- Modify: `frontend/style.css:1393-1816,1918-2025`
- Modify: `frontend/tests/notes-management.spec.js`

**Interfaces:**
- Consumes: Task 8 当前列表和 existing `queueReaderSync()`。
- Produces: `normalizeTagsInput()`、`openManagedNote()`、`createManagedNoteDraft()`、`isManagedNoteDraftDirty()`、`saveManagedNoteDraft()`、`deleteManagedNoteReflection()`、受控导航确认。

- [ ] **Step 1: 写详情编辑和标签规范化失败测试**

```javascript
test('detail edits note tags and color while metadata stays read only', async ({ page }) => {
  const note = makeNote();
  await seedNotesIndexedDb(page, { highlights: [note] });
  await installNotesApiRoutes(page, { notes: [note] });
  await page.goto('/#/creation');
  await page.getByText('测试划线').click();

  await expect(page.getByLabel('划线原文')).toHaveAttribute('readonly', '');
  await page.getByLabel('感悟').fill('新的感悟');
  await page.getByLabel('标签').fill(' 哲学，阅读, 哲学 ');
  await page.getByLabel('高亮颜色').selectOption('green');
  await page.getByRole('button', { name: '保存笔记' }).click();

  const rows = await readNotesIndexedDb(page);
  expect(rows.find(item => item.id === note.id)).toMatchObject({
    note: '新的感悟',
    tags: ['哲学', '阅读'],
    color: 'green',
    synced: false,
  });
  const queue = await readSyncQueue(page);
  expect(queue.some(item => item.type === 'highlight.upsert')).toBe(true);
});
```

- [ ] **Step 2: 写未保存保护、刷新竞争和删除感悟撤销失败测试**

```javascript
test('switching notes protects an unsaved draft', async ({ page }) => {
  const first = makeNote({ id: 'note-1', highlight_text: '第一条' });
  const second = makeNote({ id: 'note-2', highlight_text: '第二条' });
  await installNotesApiRoutes(page, { notes: [first, second] });
  await page.goto('/#/creation');
  await page.getByText('第一条').click();
  await page.getByLabel('感悟').fill('尚未保存');
  await page.getByText('第二条').click();

  await expect(page.getByRole('dialog', { name: '未保存的修改' })).toBeVisible();
  await page.getByRole('button', { name: '取消' }).click();
  await expect(page.getByLabel('感悟')).toHaveValue('尚未保存');
});


test('deleting reflection keeps highlight and can be undone', async ({ page }) => {
  const note = makeNote({ note: '原感悟' });
  await seedNotesIndexedDb(page, { highlights: [note] });
  await installNotesApiRoutes(page, { notes: [note] });
  await page.goto('/#/creation');
  await page.getByText('测试划线').click();
  await page.getByRole('button', { name: '删除感悟' }).click();

  await expect(page.getByText('感悟已删除')).toBeVisible();
  await page.getByRole('button', { name: '撤销' }).click();
  await expect(page.getByLabel('感悟')).toHaveValue('原感悟');
});
```

- [ ] **Step 3: 运行详情测试并确认缺少交互**

Run:

```bash
cd frontend && npm test -- tests/notes-management.spec.js --grep "detail|normalize|unsaved|draft|reflection|undo"
```

Expected: FAIL，详情不可编辑或无确认/撤销。

- [ ] **Step 4: 实现详情草稿与保存顺序**

新增：

```javascript
function normalizeTagsInput(value) {
  const seen = new Set();
  return value
    .split(/[,，]/)
    .map(tag => tag.trim())
    .filter(tag => tag && !seen.has(tag) && seen.add(tag));
}

function createManagedNoteDraft(note)
function isManagedNoteDraftDirty()
async function openManagedNote(note)
async function saveManagedNoteDraft()
```

保存必须先 `dbPut('highlights', updatedNote)` 成功，再 `queueReaderSync('highlight.upsert', ...)`；IndexedDB 写失败时保持 draft dirty 并显示错误。只允许修改 note/tags/color；书名、作者、章节、原文、进度、创建时间只读。

- [ ] **Step 5: 实现三选项未保存保护与异步刷新隔离**

所有站内导航调用 `requestNotesNavigation(action)`；对话框提供“保存并继续／放弃修改／取消”。覆盖：切换列表项、关闭移动详情、返回主界面、切换 active/trash、hash/back 导航。`beforeunload` 使用浏览器原生提示。`loadNotesManagement({ preserveDetail: true })` 更新列表但不替换 dirty draft。

- [ ] **Step 6: 实现删除感悟与撤销**

`deleteManagedNoteReflection()` 保存删除前 note，写空 note、状态 `raw`、`synced=false` 并排入 upsert。toast 撤销按钮在限定时间内恢复旧 note，再写 IDB 和队列。它不得删除划线、标签、颜色或定位。

- [ ] **Step 7: 运行详情、路由和同步回归**

Run:

```bash
cd frontend && npm test -- tests/notes-management.spec.js --grep "detail|normalize|unsaved|draft|reflection|undo"
cd frontend && npm test -- tests/server-sync.spec.js
```

Expected: all PASS。

- [ ] **Step 8: 提交详情编辑**

```bash
git add frontend/app.js frontend/index.html frontend/style.css frontend/tests/notes-management.spec.js
git commit -m "Add safe notes detail editing"
```

---

### Task 10: 单条/批量标签与回收站完整流程

**Files:**
- Modify: `frontend/app.js:426-449,3586-3948,4319-4743`
- Modify: `frontend/index.html:214-342`
- Modify: `frontend/style.css:1393-1816,1918-2025`
- Modify: `frontend/tests/helpers/notes-management.mjs`
- Modify: `frontend/tests/notes-management.spec.js`
- Modify: `frontend/tests/server-sync.spec.js:14-123`

**Interfaces:**
- Consumes: Task 4 batch APIs、Task 5 sync protocol v2、Task 9 draft guard。
- Produces: `applyLocalNoteOperation()`、当前页选择、在线/离线批量标签、trash/restore/delete、清空回收站和跨设备状态。

- [ ] **Step 1: 写当前页全选和批量标签失败测试**

```javascript
test('select all affects only the current page and batch adds tags', async ({ page }) => {
  const notes = Array.from({ length: 55 }, (_, index) => makeNote({
    id: `note-${index}`,
    client_id: `client-${index}`,
    highlight_text: `划线 ${index}`,
  }));
  const state = { notes, batchRequests: [] };
  await installNotesApiRoutes(page, state);
  await page.goto('/#/creation');
  await page.getByLabel('全选当前页').check();
  await expect(page.getByText('已选择 50 条')).toBeVisible();
  await page.getByRole('button', { name: '添加标签' }).click();
  await page.getByLabel('批量标签').fill('整理，重读');
  await page.getByRole('button', { name: '确认添加' }).click();

  expect(state.batchRequests[0].ids).toHaveLength(50);
  expect(state.batchRequests[0].tags).toEqual(['整理', '重读']);
});
```

- [ ] **Step 2: 写回收站、撤销、恢复和永久删除失败测试**

```javascript
test('trash undo restore and permanent delete stay distinct', async ({ page }) => {
  const state = { notes: [makeNote()], trash: [], batchRequests: [] };
  await installNotesApiRoutes(page, state);
  await page.goto('/#/creation');
  await page.getByLabel('选择 测试划线').check();
  await page.getByRole('button', { name: '移入回收站' }).click();
  await expect(page.getByText('将 1 条笔记移入回收站')).toBeVisible();
  await page.getByRole('button', { name: '确认移入' }).click();
  await page.getByRole('button', { name: '撤销' }).click();
  expect(state.batchRequests.at(-1).type).toBe('restore');

  await page.getByRole('button', { name: '回收站' }).click();
  await page.getByLabel('选择 测试划线').check();
  await page.getByRole('button', { name: '永久删除' }).click();
  await expect(page.getByText('永久删除 1 条笔记')).toBeVisible();
  await page.getByRole('button', { name: '确认永久删除' }).click();
  expect(state.batchRequests.at(-1).type).toBe('delete');
});
```

增加离线批量拆队列、清空回收站超过 100 条分批、第二批失败后停止并重查、reader notes/visual highlights 排除 `deleted_at` 的测试。

- [ ] **Step 3: 运行 batch/trash 测试并确认缺少行为**

Run:

```bash
cd frontend && npm test -- tests/notes-management.spec.js --grep "batch|select all|trash|restore|permanent|empty trash"
```

Expected: FAIL，无批量请求或回收站视图。

- [ ] **Step 4: 实现选择和在线批量 API 客户端**

维护 `selectedManagedNoteKeys`；翻页可保留当前页选择，任何筛选/视图变化清空。在线请求生成一次 `operation_id`，失败重试复用同一 ID；成功后更新本机已有缓存，但不为纯服务器记录下载 EPUB blob。

- [ ] **Step 5: 实现离线逐条队列操作**

```javascript
async function applyLocalNoteOperation(note, type, payload = {}) {
  const updated = { ...note };
  if (type === 'highlight.trash') updated.deleted_at = payload.deletedAt;
  if (type === 'highlight.restore') updated.deleted_at = null;
  if (type === 'highlight.delete') {
    await dbDelete('highlights', note.id);
  } else {
    updated.synced = false;
    await dbPut('highlights', updated);
  }
  await queueReaderSync(note.book_id, type, note.client_id || note.id, payload);
}
```

离线批量按每条记录 `book_id` 分拆；缺少 `book_id` 的 legacy 记录显示“该历史记录需联网后操作”，不得伪装同步成功。

- [ ] **Step 6: 实现回收站确认、撤销和清空分批**

- 移入回收站前显示数量；成功后 toast 撤销调用 restore。
- 回收站不允许编辑详情和 Markdown。
- 永久删除/清空必须二次确认。
- 清空先分页取得所有 trash IDs，每批最多 100；任一批失败立即停止，保留成功批次，再重新查询真实状态。
- 失败前不乐观移除；成功后才更新列表。

- [ ] **Step 7: 扩展 server-sync mock 和跨设备测试**

`frontend/tests/server-sync.spec.js` mock 支持 `protocol_version: 2`、trash、restore、delete 和 `deleted_at`；两个 browser context 验证设备 A trash 后设备 B 同步看到回收站，设备 B restore 后设备 A 同步恢复。

- [ ] **Step 8: 运行回收站、reader 和跨设备回归**

Run:

```bash
cd frontend && npm test -- tests/notes-management.spec.js --grep "batch|select all|trash|restore|permanent|empty trash"
cd frontend && npm test -- tests/server-sync.spec.js
cd frontend && npm test -- tests/mobile-layout.spec.js --grep "notes|highlight"
```

Expected: all PASS；阅读侧栏不显示回收站记录，当前 EPUB 不渲染其高亮。

- [ ] **Step 9: 提交批量与回收站 UI**

```bash
git add frontend/app.js frontend/index.html frontend/style.css frontend/tests/helpers/notes-management.mjs frontend/tests/notes-management.spec.js frontend/tests/server-sync.spec.js
git commit -m "Add notes trash and batch workflows"
```

---

### Task 11: Markdown 前端、响应式、Service Worker、文档与完整验收

**Files:**
- Modify: `frontend/app.js:322-335,4475-4743,4954-5064`
- Modify: `frontend/index.html:7-10,214-345`
- Modify: `frontend/style.css:1632-1816,2049-2724`
- Modify: `frontend/sw.js:5-114`
- Modify: `frontend/tests/notes-management.spec.js`
- Modify: `frontend/tests/mobile-layout.spec.js`
- Modify: `README.md:3-121`
- Modify: `PRODUCT.md:13-53`
- Modify: `DESIGN.md:110-265`
- Modify: `AGENTS.md`

**Interfaces:**
- Consumes: Task 6 在线 Markdown、Task 8 离线筛选结果、Task 9/10 页面状态。
- Produces: 在线/离线 Markdown 下载、稳定 EPUB cache、完整响应式/无障碍交互和更新后的项目文档。

- [ ] **Step 1: 写在线、离线和 pending Markdown 前端失败测试**

```javascript
test('online Markdown export downloads the server response', async ({ page }) => {
  await installNotesApiRoutes(page, {
    notes: [makeNote()],
    markdown: '# Marginalia 笔记\n\n## 《测试书》\n',
  });
  await page.goto('/#/creation');

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 Markdown' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^Marginalia-笔记-\d{4}-\d{2}-\d{2}\.md$/);
});


test('offline Markdown marks the export as incomplete', async ({ page }) => {
  await seedNotesIndexedDb(page, { highlights: [makeNote()] });
  await page.route('**/api/notes**', route => route.abort('failed'));
  await page.goto('/#/creation');

  const contentPromise = page.evaluate(() => {
    const original = URL.createObjectURL;
    return new Promise(resolve => {
      URL.createObjectURL = blob => {
        blob.text().then(resolve);
        return original(blob);
      };
    });
  });
  await page.getByRole('button', { name: '导出 Markdown' }).click();
  expect(await contentPromise).toContain('离线导出，可能不完整');
});


test('pending view disables Markdown export', async ({ page }) => {
  await installNotesApiRoutes(page, { notes: [] });
  await page.goto('/#/creation');
  await page.getByLabel('数据范围').selectOption('pending');
  await expect(page.getByRole('button', { name: '导出 Markdown' })).toBeDisabled();
});
```

- [ ] **Step 2: 写移动全屏详情、焦点和无横向溢出失败测试**

在 mobile project 可执行的 `mobile-layout.spec.js` 中 seed 一条笔记并断言：点击卡片后详情占满视口；Escape 在无 dirty draft 时关闭；dirty 时打开保护对话框；Tab 焦点不逃出对话框；`document.documentElement.scrollWidth <= window.innerWidth`。

- [ ] **Step 3: 运行 Markdown 和移动测试并确认失败**

Run:

```bash
cd frontend && npm test -- tests/notes-management.spec.js --grep "Markdown"
cd frontend && npm test -- tests/mobile-layout.spec.js --project=mobile-chromium
```

Expected: FAIL，下载、离线标记或移动详情行为未实现。

- [ ] **Step 4: 实现在线/离线 Markdown 下载**

在线时用当前 `q/book_id/tag/note_kind/color` 构造 `/api/notes/export.md`，检查 `response.ok`，从 `Content-Disposition` 获取文件名并创建 blob download。离线时对当前离线完整筛选结果调用前端 `renderOfflineNotesMarkdown(items)`，首部固定写入：

```markdown
# Marginalia 笔记

> 离线导出，可能不完整。
```

pending 和 trash 视图禁用按钮并给出原因；不得导出当前分页之外不完整的在线列表拼接结果。

- [ ] **Step 5: 完成桌面双栏、移动全屏详情和无障碍**

- 桌面列表/详情双栏，列表和详情各自滚动。
- `max-width: 900px` 时详情使用 fixed 全屏层，不缩放 reader 正文。
- 批量栏可换行，标签和长中文使用 `overflow-wrap: anywhere`。
- 所有 controls 有 label/focus-visible；颜色同时显示中文名称。
- 对话框实现 focus trap、初始焦点、关闭后焦点恢复和 Escape；dirty Escape 进入三选项保护。
- aria-live 播报加载、保存、批量结果和错误。

- [ ] **Step 6: 拆分 Service Worker 缓存并写回归断言**

将单一缓存改为：

```javascript
const APP_SHELL_CACHE_NAME = 'marginalia-shell-v25';
const EPUB_CACHE_NAME = 'marginalia-epubs-v1';
```

activate 只删除旧 shell caches，保留 `EPUB_CACHE_NAME` 和可识别的旧 EPUB cache；EPUB 请求始终使用稳定 cache。应用 HTML/JS/CSS 网络优先，其他 API 不缓存。更新 `index.html` 的 `style.css?v=25`、`app.js?v=25` 和 `APP_SHELL`。

在现有 SW 测试或 `notes-management.spec.js` 中断言源文件包含两个 cache 名，并且 activate 不无条件删除 EPUB cache。

- [ ] **Step 7: 更新产品、设计和代理说明**

精确更新：

- `README.md`：三视图中的“创作”改“笔记管理”；说明搜索、筛选、回收站和 Markdown；移除运行中稿件生成/Obsidian UI 描述，但注明历史接口未清理。
- `PRODUCT.md`：产品链路改为阅读 → 划线/感悟/标签 → 笔记管理 → Markdown；明确没有稿件生成服务。
- `DESIGN.md`：用笔记列表/详情双栏和移动全屏详情替换创作三栏描述；记录回收站危险操作、批量栏、颜色文本双重提示。
- `AGENTS.md`：更新 IndexedDB v6、新 notes API、协议 v2 操作和 Markdown 下载契约；保留历史接口与数据保护说明。

- [ ] **Step 8: 运行聚焦前端测试**

Run:

```bash
cd frontend && npm test -- tests/notes-management.spec.js
cd frontend && npm test -- tests/mobile-layout.spec.js --project=mobile-chromium
cd frontend && npm test -- tests/server-sync.spec.js
```

Expected: all PASS。

- [ ] **Step 9: 运行后端和前端全套测试**

Run:

```bash
./.venv/Scripts/python.exe -m pytest backend/tests
cd frontend && npm test
```

Expected: both commands exit 0；不得把已知失败标记为完成。

- [ ] **Step 10: 执行隔离数据的真实同源验收**

创建临时目录并只通过环境/monkeypatch 支持的测试入口启动后端，确认 `database.DB_PATH`、`database.NOTES_JSON_PATH`、`books_api.BOOKS_DIR`、`library.BOOKS_DIR` 全部指向临时路径，绝不使用默认 `backend/data`。使用两个隔离浏览器 context 完成：

1. 上传生成的测试 EPUB；
2. context A 创建划线、感悟和标签；
3. 打开 `#/creation` 搜索并编辑感悟/颜色；
4. 移入回收站；
5. context B 同步并从回收站恢复；
6. context A 同步确认恢复；
7. 再次移入回收站并永久删除；
8. 下载 Markdown，核对书名、章节、划线、感悟、标签和回收站排除；
9. 关闭服务并删除临时数据。

保存验收命令输出；任何一步失败都回到对应任务修复并重跑全套。

- [ ] **Step 11: 检查差异、旧文案和敏感文件**

Run:

```bash
git diff --check
git status --short
git diff --name-only
```

确认没有 `.env`、`.env.production`、SQLite、EPUB、Obsidian 内容、Tunnel token、`.codegraph` 或真实用户数据；搜索并移除运行界面中的旧“创作/稿件生成/导出到 Obsidian”文案，但不要删除历史后端代码。

- [ ] **Step 12: 提交最终前端、缓存和文档**

```bash
git add frontend/app.js frontend/index.html frontend/style.css frontend/sw.js frontend/tests/notes-management.spec.js frontend/tests/mobile-layout.spec.js README.md PRODUCT.md DESIGN.md AGENTS.md
git commit -m "Complete notes management workspace"
```

---

## Final Review Checklist

- [ ] `GET /api/notes` 的搜索、筛选、facets、排序和分页都由参数化 SQL 实现，2 字符中文和无 trigram 环境可回退。
- [ ] 正常列表、回收站和永久删除语义严格分离；旧客户端 `highlight.delete` 兼容。
- [ ] 在线批量操作持久幂等且事务化；离线批量按书拆入持久队列。
- [ ] 本地 pending 不会被服务器快照覆盖；dirty detail 不会被后台刷新覆盖。
- [ ] 删除感悟只清空感悟；移入回收站保留整条记录；永久删除仅在回收站发生。
- [ ] Markdown 在线导出完整筛选结果，离线导出有不完整标记，pending/trash 不导出。
- [ ] 页面没有稿件生成、稿件编辑、JSON 或 Obsidian 导出入口；后端历史接口和数据仍存在。
- [ ] `#/creation`、返回主界面和浏览器历史兼容。
- [ ] IndexedDB v6 保留所有旧 stores；Service Worker 升级不清除 EPUB 缓存。
- [ ] 后端全套、前端全套和隔离同源真实链路全部通过。
