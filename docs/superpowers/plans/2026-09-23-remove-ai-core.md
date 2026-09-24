# Remove AI Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 删除 Marginalia 的 AI/LLM/Embedding/知识索引运行路径，同时完整保留服务器 EPUB 书库、protocol v2 阅读同步、规则脚本、Obsidian 与草稿 GET/PATCH/DELETE，并把 `/book-chat/` 明确呈现为“GPT 风格阅读器”。

**Architecture:** 先把 `backend/knowledge.py` 中仍被服务器书库需要的 EPUB 归档校验与元数据读取迁到独立的 `backend/epub_utils.py`，再按路由、生命周期、模型、配置和依赖边界删除 AI 核心。主前端只移除知识索引状态与删除 AI 数据分支；`/api/books/*`、IndexedDB v6、protocol v2、`/book-chat/` URL、`marginalia.chatReader.*` localStorage 键和内部 `chat-reader-progress-*` 兼容键保持不变。

**Tech Stack:** Python 3.11、FastAPI、Pydantic v2、aiosqlite、EbookLib、pytest、httpx TestClient；原生 HTML/CSS/JavaScript、epub.js、IndexedDB、Service Worker、Playwright。

**Spec:** `docs/superpowers/specs/2026-09-23-local-zerotier-no-ai-design.md`

## Global Constraints

- 三份计划必须按 `remove-ai-core → zerotier-runtime → local-operations-cleanup` 顺序执行；本计划完成并全绿后才能执行 `2026-09-23-zerotier-runtime.md`。
- 当前已知基线是后端 `178 passed, 1 failed`，唯一失败是 `backend/tests/test_api.py::TestHealth::test_untrusted_host_is_rejected` 受真实环境 `ALLOWED_HOSTS` 干扰；Task 1 固化测试环境后必须为 `179 passed`。
- 当前前端聚焦基线是 `27 passed`：`book-chat.spec.js` 19、`server-sync.spec.js` 4、`import-ux.spec.js` 3、`app-shell-versions.spec.js` 1。
- 所有 pytest 命令必须显式设置 `ALLOWED_HOSTS=localhost,127.0.0.1,testserver` 与 `CORS_ORIGINS=http://testserver`，使项目根 `.env` 中的真实值不能污染测试。
- 不读取、打印、修改、删除或提交 `.env` 与 `.env.production`；不自动创建或提交用户真实 `.env`。
- 保留 `POST /api/generate-script`、`backend/agent.py`、`POST /api/obsidian/export`、`GET /api/drafts`、`GET/PATCH/DELETE /api/drafts/{draft_id}`；只删除 `POST /api/drafts/generate`。
- 保留 `GET /api/books`、`POST /api/books/upload`、`GET /api/books/{book_id}/file`、`GET/POST /api/books/{book_id}/sync`、`DELETE /api/books/{book_id}`、legacy `GET /api/books/{filename:path}` 与 protocol v2 的 trash/restore/delete 语义。
- 历史 `qa_books`、`qa_chunks`、`qa_chunks_fts`、`qa_conversations`、`qa_messages` 表和 `highlights.knowledge_book_id`、`library_books.knowledge_book_id` 列不自动 `DROP`、不重建数据库、不删除 `backend/data/knowledge/` 历史文件。
- 本轮不创建 AI 数据清理脚本；历史 AI 数据只保留，不提供自动或可选删除路径。
- `frontend/book-chat/` 路径、`marginalia.chatReader.selectedBookId`、`marginalia.chatReader.position.*`、`marginalia.chatReader.theme`、`chat-reader-progress-*`、`dataset.chatReaderKeys` 不重命名；只改用户可见文案。
- 不重构 `frontend/app.js` 的单文件结构，不升级 IndexedDB 版本 6，不改变 API 同源策略。
- `frontend/index.html` 的顶层 `app.js?v=N`、`style.css?v=N` 与 `frontend/sw.js` `APP_SHELL` 必须逐字一致；修改任何预缓存资源后递增 `APP_SHELL_CACHE_NAME`。
- 每个任务使用严格 TDD：先写/改测试并观察指定失败，再做最小实现，再运行通过，再单独提交；不得把多个任务压成一个提交。
- 本计划中的 `git commit` 是未来执行步骤；编写计划时不执行任何提交。

---

### Task 1: 固化测试环境隔离与基线

**Files:**
- Modify: `backend/tests/conftest.py:1-14`
- Test: `backend/tests/test_api.py::TestHealth::test_untrusted_host_is_rejected`
- Test: `frontend/tests/book-chat.spec.js`
- Test: `frontend/tests/server-sync.spec.js`
- Test: `frontend/tests/import-ux.spec.js`
- Test: `frontend/tests/app-shell-versions.spec.js`

**Interfaces:**
- Consumes: pytest 在导入测试模块前加载 `backend/tests/conftest.py` 的行为。
- Produces: 测试进程固定的 `ALLOWED_HOSTS=localhost,127.0.0.1,testserver` 与 `CORS_ORIGINS=http://testserver`；后续 pytest 不受项目根真实 `.env` 影响。

- [ ] **Step 1: 记录工作树并复现准确的红色基线**

Run:

```bash
git status --short
git rev-parse --abbrev-ref HEAD
git rev-parse --short HEAD
.venv/Scripts/python.exe -m pytest backend/tests -q
```

Expected: pytest reports `178 passed, 1 failed`，唯一失败为 `backend/tests/test_api.py::TestHealth::test_untrusted_host_is_rejected`；不得清理、stash 或覆盖已有改动。

- [ ] **Step 2: 在 conftest 导入应用前固定测试环境**

Insert immediately after the standard-library imports in `backend/tests/conftest.py`:

```python
os.environ["ALLOWED_HOSTS"] = "localhost,127.0.0.1,testserver"
os.environ["CORS_ORIGINS"] = "http://testserver"
```

Keep these assignments before any backend application module can be imported。

- [ ] **Step 3: 运行完整后端测试并确认绿色基线**

Run:

```bash
.venv/Scripts/python.exe -m pytest backend/tests -q
```

Expected: `179 passed`；`TestHealth::test_untrusted_host_is_rejected` PASS。

- [ ] **Step 4: 运行 27 条前端聚焦基线**

Run:

```bash
cd frontend && npx playwright test tests/book-chat.spec.js tests/server-sync.spec.js tests/import-ux.spec.js tests/app-shell-versions.spec.js
```

Expected: `27 passed`。

- [ ] **Step 5: Commit**

```bash
git add backend/tests/conftest.py
git commit -m "Isolate backend tests from local host settings"
```

---

### Task 2: 把 EPUB 校验与元数据能力迁出 knowledge.py

**Files:**
- Create: `backend/epub_utils.py`
- Create: `backend/tests/test_epub_utils.py`
- Modify: `backend/library.py:110-185`
- Modify: `backend/tests/test_api.py:416-465`

**Interfaces:**
- Consumes: `settings.max_epub_upload_mb`、EbookLib `epub.read_epub`、fixture `frontend/tests/fixtures/multichapter.epub`。
- Produces: `EpubValidationError(message: str, status_code: int = 415, code: str = "invalid_epub")`、`validate_epub_archive(path: Path) -> None`、`read_epub_metadata(path: Path) -> tuple[str, str]`；`upload_library_book(content: bytes, filename: str, title: str = "", author: str = "") -> tuple[dict, bool]` 继续返回 `(public_book, created)`。

- [ ] **Step 1: 写 EPUB 工具的失败测试**

Create `backend/tests/test_epub_utils.py`:

```python
from pathlib import Path

import pytest

from epub_utils import EpubValidationError, read_epub_metadata, validate_epub_archive


FIXTURE = Path(__file__).parents[2] / "frontend" / "tests" / "fixtures" / "multichapter.epub"


def test_valid_epub_returns_fixture_metadata():
    validate_epub_archive(FIXTURE)
    title, author = read_epub_metadata(FIXTURE)
    assert title == "Multichapter Test Fixture"
    assert author == "Test Fixture Generator"


def test_invalid_zip_has_stable_http_error(tmp_path):
    candidate = tmp_path / "broken.epub"
    candidate.write_bytes(b"not a zip")
    with pytest.raises(EpubValidationError) as exc:
        validate_epub_archive(candidate)
    assert exc.value.status_code == 415
    assert exc.value.code == "invalid_epub"


def test_archive_without_container_is_rejected(tmp_path):
    from zipfile import ZipFile

    candidate = tmp_path / "missing-container.epub"
    with ZipFile(candidate, "w") as archive:
        archive.writestr("mimetype", "application/epub+zip")
    with pytest.raises(EpubValidationError, match="有效的 EPUB"):
        validate_epub_archive(candidate)
```

- [ ] **Step 2: 运行测试并确认模块尚不存在**

Run:

```bash
ALLOWED_HOSTS="localhost,127.0.0.1,testserver" CORS_ORIGINS="http://testserver" .venv/Scripts/python.exe -m pytest backend/tests/test_epub_utils.py -q
```

Expected: collection FAIL with `ModuleNotFoundError: No module named 'epub_utils'`。

- [ ] **Step 3: 创建最小 EPUB 工具实现**

Create `backend/epub_utils.py`:

```python
from pathlib import Path
from zipfile import BadZipFile, ZipFile

from ebooklib import epub

MAX_UNCOMPRESSED_BYTES = 500 * 1024 * 1024
MAX_ZIP_ENTRIES = 10_000


class EpubValidationError(RuntimeError):
    def __init__(self, message: str, status_code: int = 415, code: str = "invalid_epub"):
        super().__init__(message)
        self.status_code = status_code
        self.code = code


def validate_epub_archive(path: Path) -> None:
    try:
        with ZipFile(path) as archive:
            entries = archive.infolist()
            if len(entries) > MAX_ZIP_ENTRIES:
                raise EpubValidationError("EPUB 内文件数量过多", 413, "epub_too_many_entries")
            if sum(entry.file_size for entry in entries) > MAX_UNCOMPRESSED_BYTES:
                raise EpubValidationError("EPUB 解压后体积超过 500MB", 413, "epub_too_large")
            if "META-INF/container.xml" not in archive.namelist():
                raise EpubValidationError("文件不是有效的 EPUB")
    except BadZipFile as exc:
        raise EpubValidationError("文件不是有效的 EPUB") from exc


def read_epub_metadata(path: Path) -> tuple[str, str]:
    book = epub.read_epub(str(path), options={"ignore_ncx": True})
    titles = book.get_metadata("DC", "title")
    creators = book.get_metadata("DC", "creator")
    return (
        str(titles[0][0]).strip() if titles else "",
        str(creators[0][0]).strip() if creators else "",
    )
```

- [ ] **Step 4: 让 library 只消费 epub_utils**

In `backend/library.py`, add:

```python
from epub_utils import EpubValidationError, read_epub_metadata, validate_epub_archive
```

In `_register_existing_file`, delete `from knowledge import _read_epub_metadata, _validate_epub_archive`, replace `_validate_epub_archive(path)` with `validate_epub_archive(path)`, and replace `_read_epub_metadata(path)` with `read_epub_metadata(path)`. The resulting first ten executable lines of the function must be:

```python
async def _register_existing_file(path: Path, original_filename: str) -> dict:
    validate_epub_archive(path)
    content_hash = hashlib.sha256(path.read_bytes()).hexdigest()
    existing = await get_library_book_by_hash(content_hash)
    if existing:
        return existing
    title, author = read_epub_metadata(path)
    book_id = str(uuid.uuid4())
    now = _now()
    db = await _connect()
```

Replace the upload validation block with:

```python
    try:
        validate_epub_archive(temp_path)
        parsed_title, parsed_author = read_epub_metadata(temp_path)
        os.replace(temp_path, final_path)
    except EpubValidationError as exc:
        temp_path.unlink(missing_ok=True)
        raise HTTPException(
            status_code=exc.status_code,
            detail={"code": exc.code, "message": str(exc)},
        ) from exc
```

Do not remove `ensure_library_knowledge` in this task；Task 3 removes that coupling under its own tests。

- [ ] **Step 5: 运行工具与上传测试**

Run:

```bash
ALLOWED_HOSTS="localhost,127.0.0.1,testserver" CORS_ORIGINS="http://testserver" .venv/Scripts/python.exe -m pytest backend/tests/test_epub_utils.py backend/tests/test_api.py::TestServerLibraryAPI::test_upload_is_server_visible_and_deduplicated -q
```

Expected: `4 passed`。

- [ ] **Step 6: 确认 library 的 EPUB 能力不再从 knowledge 导入**

Run:

```bash
python -c "from pathlib import Path; text=Path('backend/library.py').read_text(encoding='utf-8'); assert 'from knowledge import _read_epub_metadata' not in text; assert 'from knowledge import KnowledgeError, _read_epub_metadata' not in text"
```

Expected: exit 0。

- [ ] **Step 7: Commit**

```bash
git add backend/epub_utils.py backend/library.py backend/tests/test_epub_utils.py backend/tests/test_api.py
git commit -m "Extract EPUB validation from AI knowledge code"
```

---

### Task 3: 解开服务器书库与 AI 表/索引的耦合

**Files:**
- Modify: `backend/library.py:34-88,91-146,149-342,395-565,642-672`
- Modify: `backend/tests/test_api.py:13-67,416-618`
- Create: `backend/tests/test_library_compat.py`

**Interfaces:**
- Consumes: Task 2 的 `validate_epub_archive` 与 `read_epub_metadata`。
- Produces: `init_library_db()`、`reconcile_legacy_books()`、`upload_library_book()`、`get_library_book()`、`list_library_books()`、`sync_book_state()`、`delete_library_book()` 均不导入 `knowledge`、不查询 `qa_*`；公开 book dict 只含 `id,title,author,filename,original_filename,content_hash,file_size,state_revision,created_at,updated_at`。

- [ ] **Step 1: 写“历史 AI 表与列保留、公开书籍不含 AI 状态”的失败测试**

Create `backend/tests/test_library_compat.py`:

```python
import asyncio

import aiosqlite

import books_api
import database
import library


def test_existing_ai_tables_and_legacy_columns_survive_library_initialization(tmp_path, monkeypatch):
    db_path = tmp_path / "compat.db"
    monkeypatch.setattr(database, "DB_PATH", db_path)
    monkeypatch.setattr(books_api, "BOOKS_DIR", tmp_path / "books")
    monkeypatch.setattr(library, "BOOKS_DIR", tmp_path / "books")

    async def exercise():
        async with aiosqlite.connect(db_path) as db:
            await db.executescript("""
                CREATE TABLE qa_books(id TEXT PRIMARY KEY, marker TEXT);
                INSERT INTO qa_books VALUES ('historic-ai', 'keep');
                CREATE TABLE library_books(
                    id TEXT PRIMARY KEY, content_hash TEXT UNIQUE, title TEXT,
                    author TEXT, original_filename TEXT, storage_filename TEXT UNIQUE,
                    file_size INTEGER, knowledge_book_id TEXT, state_revision INTEGER,
                    created_at TEXT, updated_at TEXT
                );
            """)
            await db.commit()
        await database.init_db()
        await library.init_library_db()
        async with aiosqlite.connect(db_path) as db:
            ai_row = await (await db.execute("SELECT marker FROM qa_books WHERE id='historic-ai'" )).fetchone()
            columns = {row[1] for row in await db.execute_fetchall("PRAGMA table_info(library_books)")}
        return ai_row, columns

    ai_row, columns = asyncio.run(exercise())
    assert ai_row == ("keep",)
    assert "knowledge_book_id" in columns


def test_fresh_library_schema_does_not_add_legacy_ai_column(tmp_path, monkeypatch):
    db_path = tmp_path / "fresh.db"
    monkeypatch.setattr(database, "DB_PATH", db_path)
    monkeypatch.setattr(books_api, "BOOKS_DIR", tmp_path / "books")
    monkeypatch.setattr(library, "BOOKS_DIR", tmp_path / "books")

    async def exercise():
        await database.init_db()
        await library.init_library_db()
        async with aiosqlite.connect(db_path) as db:
            return {row[1] for row in await db.execute_fetchall("PRAGMA table_info(library_books)")}

    assert "knowledge_book_id" not in asyncio.run(exercise())


def test_public_book_shape_has_no_ai_index_fields():
    public = library._public_book({
        "id": "book-1", "title": "Book", "author": "Author",
        "storage_filename": "book-1.epub", "original_filename": "book.epub",
        "content_hash": "hash", "file_size": 12, "state_revision": 2,
        "knowledge_book_id": "historic-ai", "created_at": "now", "updated_at": "now",
    })
    assert "knowledge_book_id" not in public
    assert "knowledge_status" not in public
    assert "knowledge_error" not in public
```

- [ ] **Step 2: 运行兼容测试并确认公开 shape 失败**

Run:

```bash
ALLOWED_HOSTS="localhost,127.0.0.1,testserver" CORS_ORIGINS="http://testserver" .venv/Scripts/python.exe -m pytest backend/tests/test_library_compat.py -q
```

Expected: historical-table test PASS；fresh-schema test FAIL because `CREATE TABLE library_books` still adds `knowledge_book_id`；public-shape test FAIL because `_public_book` still exposes `knowledge_book_id` / `knowledge_status` / `knowledge_error`。

- [ ] **Step 3: 删除书库注册、查询、同步和删除中的 AI 调用**

Apply these exact behavioral edits in `backend/library.py`:

```python
# _register_existing_file: delete this line
# await ensure_library_knowledge(book_id)

# upload_library_book duplicate path: return directly
if existing:
    return existing, False

# upload_library_book successful path
return (await get_library_book(book_id) or {}), True

# get_library_book no longer has include_knowledge
async def get_library_book(book_id: str) -> dict | None:
    db = await _connect()
    try:
        cursor = await db.execute("SELECT * FROM library_books WHERE id = ?", (book_id,))
        row = await cursor.fetchone()
        return _public_book(dict(row)) if row else None
    finally:
        await db.close()

# list_library_books no join
rows = await db.execute_fetchall(
    "SELECT * FROM library_books ORDER BY created_at DESC"
)
```

Delete the entire `ensure_library_knowledge` function. Change `serve_library_book` and `delete_library_book` to call `get_library_book(book_id)` without `include_knowledge`. In `sync_book_state`, select only `id,title,author`; in `_upsert_synced_highlight`, remove `book.get("knowledge_book_id")` from values and remove `knowledge_book_id=?` / insert column from SQL. After deleting the canonical book row, only unlink the staged EPUB; do not import or call `delete_knowledge_book`.

Remove `knowledge_book_id TEXT` from the `CREATE TABLE IF NOT EXISTS library_books` definition so a fresh database does not acquire a new AI compatibility column. Do **not** execute a column-dropping `ALTER TABLE`, rebuild `library_books`, or otherwise remove an existing `library_books.knowledge_book_id`; SQLite leaves that historical column and its values untouched when opening an old database.

- [ ] **Step 4: 移除 API tests 对 knowledge 初始化和索引 mock 的依赖**

In `backend/tests/test_api.py`, remove `import knowledge as knowledge_module`, the `KNOWLEDGE_DIR` patch, `await knowledge_module.init_knowledge_db()`, every `patch("library.ensure_library_knowledge", no_index)` wrapper, `TestBookQA`, `TestKnowledgeAPI`, `test_conversation_crud`, and `test_stream_route_uses_sse`.

Replace the upload-size test with server-library-only coverage:

```python
def test_epub_upload_limit_applies_to_server_library(self, client):
    old_limit = config_module.settings.max_epub_upload_mb
    config_module.settings.max_epub_upload_mb = 0
    try:
        response = client.post(
            "/api/books/upload",
            files={"file": ("book.epub", b"x", "application/epub+zip")},
        )
    finally:
        config_module.settings.max_epub_upload_mb = old_limit
    assert response.status_code == 413
```

- [ ] **Step 5: 运行书库兼容与 API 保留测试**

Run:

```bash
ALLOWED_HOSTS="localhost,127.0.0.1,testserver" CORS_ORIGINS="http://testserver" .venv/Scripts/python.exe -m pytest backend/tests/test_library_compat.py backend/tests/test_api.py::TestServerLibraryAPI -q
```

Expected: all selected tests PASS；上传、file、sync、delete 均仍工作。

- [ ] **Step 6: 静态证明 library 不再接触 AI 模块或表**

Run:

```bash
python -c "from pathlib import Path; t=Path('backend/library.py').read_text(encoding='utf-8'); forbidden=['from knowledge','qa_books','knowledge_status','knowledge_error','ensure_library_knowledge','delete_knowledge_book']; assert not [x for x in forbidden if x in t]"
```

Expected: exit 0；`knowledge_book_id TEXT` 和数据库兼容列仍允许存在，因此不加入 forbidden 列表。

- [ ] **Step 7: Commit**

```bash
git add backend/library.py backend/tests/test_api.py backend/tests/test_library_compat.py
git commit -m "Decouple the server library from AI indexing"
```

---

### Task 4: 删除 AI 路由、模型、模块与新库 AI 列，同时保留历史列

**Files:**
- Modify: `backend/main.py:5-17,20-64,70-87,300-449,481-553`
- Modify: `backend/models.py:10-26,107-119,132-193`
- Modify: `backend/database.py:43-72,203-278,686-715`
- Modify: `backend/tests/test_api.py`
- Modify: `backend/tests/test_models.py`
- Modify: `backend/tests/test_database.py`
- Delete: `backend/knowledge.py`
- Delete: `backend/llm.py`
- Delete: `backend/tests/test_knowledge.py`

**Interfaces:**
- Consumes: Task 3 中不再访问 AI 表的 `library`。
- Produces: removed endpoints return `404`；fresh `highlights` 表不含 `knowledge_book_id`；已有 `highlights.knowledge_book_id` 列和值原样保留；草稿 GET/PATCH/DELETE、规则脚本与 Obsidian 路由签名不变。

- [ ] **Step 1: 写路由、模型和数据库兼容失败测试**

Add the following complete tests before changing implementation:

```python
# backend/tests/test_api.py
class TestRemovedAiRoutes:
    @pytest.mark.parametrize(
        ("method", "path", "kwargs"),
        [
            ("post", "/api/books/ask", {"json": {"question": "x"}}),
            ("post", "/api/knowledge/books/upload", {"files": {"file": ("x.epub", b"x")}}),
            ("post", "/api/knowledge/books/from-server", {"json": {"filename": "x.epub"}}),
            ("get", "/api/knowledge/books/missing", {}),
            ("post", "/api/knowledge/books/missing/reindex", {}),
            ("delete", "/api/knowledge/books/missing", {}),
            ("get", "/api/knowledge/books/missing/conversations", {}),
            ("post", "/api/knowledge/books/missing/conversations", {"json": {"title": ""}}),
            ("delete", "/api/knowledge/conversations/missing", {}),
            ("get", "/api/knowledge/conversations/missing/messages", {}),
            ("post", "/api/knowledge/conversations/missing/messages/stream", {"json": {"content": "x"}}),
            ("post", "/api/drafts/generate", {"json": {"target": "video", "highlight_ids": ["x"]}}),
        ],
    )
    def test_removed_route_returns_404(self, client, method, path, kwargs):
        assert getattr(client, method)(path, **kwargs).status_code == 404


class TestPreservedDraftRoutes:
    def test_list_get_patch_delete_remain_available(self, client):
        draft = asyncio.get_event_loop().run_until_complete(db_module.create_draft(
            target="article", title="初稿", content="正文",
            source_highlight_ids=[], metadata={},
        ))
        assert client.get("/api/drafts").status_code == 200
        assert client.get(f"/api/drafts/{draft['id']}").status_code == 200
        patched = client.patch(f"/api/drafts/{draft['id']}", json={"title": "保留"})
        assert patched.status_code == 200
        assert patched.json()["title"] == "保留"
        assert client.delete(f"/api/drafts/{draft['id']}").status_code == 200


# backend/tests/test_models.py
def test_ai_request_models_and_highlight_ai_fields_are_absent():
    import models

    for name in (
        "DraftGenerateRequest", "BookQAHighlight", "BookQARequest",
        "BookQAResponse", "ReaderLocation", "QAStreamRequest", "ConversationCreate",
    ):
        assert not hasattr(models, name)
    assert "knowledge_book_id" not in HighlightCreate.model_fields
    assert "knowledge_book_id" not in HighlightUpdate.model_fields


# backend/tests/test_database.py
def test_fresh_highlights_schema_has_no_knowledge_column(tmp_path, monkeypatch):
    path = tmp_path / "fresh.db"
    monkeypatch.setattr(database, "DB_PATH", path)
    asyncio.run(database.init_db())
    with sqlite3.connect(path) as connection:
        columns = {row[1] for row in connection.execute("PRAGMA table_info(highlights)")}
    assert "knowledge_book_id" not in columns


def test_legacy_highlight_knowledge_column_and_value_survive_init(tmp_path, monkeypatch):
    path = tmp_path / "legacy.db"
    with sqlite3.connect(path) as connection:
        connection.execute("""
            CREATE TABLE highlights(
                id TEXT PRIMARY KEY, book_title TEXT NOT NULL,
                highlight_text TEXT NOT NULL, knowledge_book_id TEXT
            )
        """)
        connection.execute(
            "INSERT INTO highlights(id, book_title, highlight_text, knowledge_book_id) VALUES (?, ?, ?, ?)",
            ("legacy-1", "Book", "Quote", "historic-ai"),
        )
        connection.commit()
    monkeypatch.setattr(database, "DB_PATH", path)
    asyncio.run(database.init_db())
    with sqlite3.connect(path) as connection:
        row = connection.execute(
            "SELECT knowledge_book_id FROM highlights WHERE id = ?", ("legacy-1",)
        ).fetchone()
    assert row == ("historic-ai",)
```

Ensure `backend/tests/test_database.py` imports `asyncio`, `sqlite3`, and `database` once at module scope if not already present。

- [ ] **Step 2: 运行新增测试并确认红色原因**

Run:

```bash
.venv/Scripts/python.exe -m pytest backend/tests/test_api.py::TestRemovedAiRoutes backend/tests/test_api.py::TestPreservedDraftRoutes backend/tests/test_models.py::test_ai_request_models_and_highlight_ai_fields_are_absent backend/tests/test_database.py::test_fresh_highlights_schema_has_no_knowledge_column backend/tests/test_database.py::test_legacy_highlight_knowledge_column_and_value_survive_init -q
```

Expected: removed-route cases、model-field test 和 fresh-schema test FAIL；legacy preservation 与 retained draft test PASS。

- [ ] **Step 3: 删除 AI 路由、生命周期和 imports**

Replace `lifespan` with:

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    from library import init_library_db, reconcile_legacy_books

    await init_library_db()
    await reconcile_legacy_books()
    logger.info("Database initialized; Python executable: %s", sys.executable)
    yield
```

Keep `File` and `Form` because `/api/books/upload` uses them。Delete `StreamingResponse`; delete model imports `BookQARequest`, `BookQAResponse`, `ConversationCreate`, `DraftGenerateRequest`, `QAStreamRequest`; delete database import `create_draft`。Delete complete function blocks for `ask_book_question`, every `/api/knowledge/*` route, and `generate_draft`。Do not alter function bodies for draft list/get/patch/delete、`generate_script`、`export_to_obsidian` or `/api/books/*`。

- [ ] **Step 4: 删除 AI 模型和 fresh-schema AI 列写入**

Delete the seven AI-only request/response classes named in Step 1 and remove `knowledge_book_id` fields from `HighlightCreate` and `HighlightUpdate`。

In `database.init_db()`, remove `knowledge_book_id TEXT` from the fresh `CREATE TABLE highlights` SQL and delete this call:

```python
await _ensure_column(db, "knowledge_book_id", "TEXT")
```

In `upsert_highlights`, replace the UPDATE tail:

```sql
updated_at = ?, status = ?
WHERE id = ?
```

and remove `h.get("knowledge_book_id")` from its parameter tuple。Replace the INSERT column/value tails with:

```sql
created_at, progress_percent, received_at, updated_at, status)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
```

and remove `h.get("knowledge_book_id")` from that tuple。In `update_highlight()`, remove `"knowledge_book_id"` from `allowed`。Do not execute `DROP COLUMN` or rebuild an existing table。

- [ ] **Step 5: 删除 AI-only files**

Run:

```bash
git rm backend/knowledge.py backend/llm.py backend/tests/test_knowledge.py
```

Expected: exactly those three files are staged for deletion。

- [ ] **Step 6: 运行 Task 4 全部测试并确认绿色**

Run:

```bash
.venv/Scripts/python.exe -m pytest backend/tests/test_api.py backend/tests/test_models.py backend/tests/test_database.py backend/tests/test_agent.py -q
```

Expected: all selected tests PASS；fresh schema has no AI column，legacy value remains，removed endpoints are 404，retained draft/rules/Obsidian tests pass。

- [ ] **Step 7: 静态检查已删除模块引用**

Run:

```bash
python -c "from pathlib import Path; files=list(Path('backend').glob('*.py'))+list(Path('backend/tests').glob('*.py')); hits=[str(p) for p in files if any(x in p.read_text(encoding='utf-8') for x in ('import knowledge','from knowledge','import llm','from llm'))]; assert not hits, hits"
```

Expected: exit 0。

- [ ] **Step 8: Commit**

```bash
git add backend/main.py backend/models.py backend/database.py backend/tests/test_api.py backend/tests/test_models.py backend/tests/test_database.py
git commit -m "Remove AI routes and LLM runtime modules"
```

---

### Task 5: 删除 AI 配置与依赖，锁定历史表不被初始化或删除

**Files:**
- Modify: `backend/config.py:13-54`
- Modify: `backend/requirements.txt`
- Replace: `backend/tests/test_config.py`
- Modify: `backend/tests/test_database.py`
- Modify: `start.bat:49-50`
- Modify: `start.sh:41`
- Modify: `.env.example:4-22`

**Interfaces:**
- Consumes: retained `settings.database_url`, `settings.cors_origins`, `settings.allowed_hosts`, `settings.max_epub_upload_mb`, `settings.obsidian_vault_path`。
- Produces: `Settings` 不再暴露任何 `llm_*`/`embedding_*` 字段；`.env.example` 不含 AI 环境变量；requirements 保留 EbookLib 和 httpx，删除只有 `knowledge.py` 使用的 `beautifulsoup4`；Windows/POSIX 启动依赖检查不再导入 `bs4`。

- [ ] **Step 1: 重写 config 失败测试以断言 AI 字段消失**

Replace AI-specific tests in `backend/tests/test_config.py` with:

```python
def test_ai_settings_are_not_part_of_runtime(monkeypatch):
    settings = _load_settings(monkeypatch, {
        "LLM_BASE_URL": "https://ignored.example/v1",
        "EMBEDDING_MODEL": "ignored-model",
    })
    for name in (
        "llm_base_url", "llm_api_key", "llm_model", "llm_embedding_model",
        "embedding_base_url", "embedding_api_key", "embedding_model",
    ):
        assert not hasattr(settings, name)


def test_local_security_and_storage_settings_are_parsed(monkeypatch):
    settings = _load_settings(monkeypatch, {
        "CORS_ORIGINS": "http://172.23.44.5:8720",
        "ALLOWED_HOSTS": "172.23.44.5,localhost,127.0.0.1",
        "MAX_EPUB_UPLOAD_MB": "90",
    })
    assert settings.cors_origin_list == ["http://172.23.44.5:8720"]
    assert settings.allowed_host_list == ["172.23.44.5", "localhost", "127.0.0.1"]
    assert settings.max_epub_upload_mb == 90
```

Update `_load_settings.names` to include every AI variable only so tests delete inherited process values before module import；this helper hygiene does not make them supported settings。

- [ ] **Step 2: 运行 config 测试并确认 AI 属性仍存在**

Run:

```bash
ALLOWED_HOSTS="localhost,127.0.0.1,testserver" CORS_ORIGINS="http://testserver" .venv/Scripts/python.exe -m pytest backend/tests/test_config.py -q
```

Expected: `test_ai_settings_are_not_part_of_runtime` FAIL on `settings.llm_base_url`。

- [ ] **Step 3: 最小化 Settings**

Remove `_env_token` and all LLM/Embedding fields from `backend/config.py`。Keep:

```python
class Settings:
    database_url: str = os.getenv(
        "DATABASE_URL",
        f"sqlite+aiosqlite:///{Path(__file__).parent / 'data' / 'marginalia.db'}",
    )
    cors_origins: str = os.getenv("CORS_ORIGINS", "*")
    allowed_hosts: str = os.getenv(
        "ALLOWED_HOSTS", "localhost,127.0.0.1,testserver"
    )
    max_epub_upload_mb: int = int(os.getenv("MAX_EPUB_UPLOAD_MB", "90"))
    obsidian_vault_path: str = os.getenv("OBSIDIAN_VAULT_PATH", "")
```

Keep both dotenv load locations for this task；runtime unification is handled by the next plan。

- [ ] **Step 4: 写依赖引用扫描并确认 BeautifulSoup 已无运行引用**

Run:

```bash
python - <<'PY'
from pathlib import Path
runtime_files = [path for path in Path('backend').glob('*.py') if path.name != 'knowledge.py']
hits = [str(path) for path in runtime_files if 'BeautifulSoup' in path.read_text(encoding='utf-8') or 'from bs4' in path.read_text(encoding='utf-8')]
assert hits == [], hits
assert 'from ebooklib import epub' in Path('backend/epub_utils.py').read_text(encoding='utf-8')
assert 'from fastapi.testclient import TestClient' in Path('backend/tests/test_api.py').read_text(encoding='utf-8')
PY
```

Expected: exit 0；EbookLib 和 httpx 仍有明确消费者，BeautifulSoup/bs4 已无非删除文件消费者。

- [ ] **Step 5: 清理示例配置与 requirements**

Rewrite `.env.example` AI section so it contains only:

```env
# Browser origins and HTTP Host values are finalized by the ZeroTier runtime plan.
# CORS_ORIGINS=http://172.23.44.5:8720
# ALLOWED_HOSTS=172.23.44.5,localhost,127.0.0.1

# Maximum EPUB size accepted by the server library (MB)
MAX_EPUB_UPLOAD_MB=90

# Obsidian export vault path (optional)
# OBSIDIAN_VAULT_PATH=C:\Users\Family\Documents\ObsidianVault
```

Delete only this line from `backend/requirements.txt`:

```text
beautifulsoup4>=4.12.0
```

Keep `EbookLib>=0.18` for `epub_utils.py` and `httpx>=0.28.0` for FastAPI `TestClient`。In both startup scripts, replace the dependency-check import list exactly:

```text
start.bat: import fastapi, ebooklib, bs4, multipart, pytest
→ start.bat: import fastapi, ebooklib, multipart, pytest

start.sh: import fastapi, ebooklib, bs4, multipart, pytest
→ start.sh: import fastapi, ebooklib, multipart, pytest
```

Do not create `.env`。

- [ ] **Step 6: 加历史 AI 表保留回归测试**

Add to `backend/tests/test_database.py`:

```python
def test_init_db_does_not_drop_historic_ai_tables(tmp_path, monkeypatch):
    import asyncio
    import sqlite3
    import database

    path = tmp_path / "historic.db"
    with sqlite3.connect(path) as connection:
        connection.execute("CREATE TABLE qa_books(id TEXT PRIMARY KEY, marker TEXT)")
        connection.execute("INSERT INTO qa_books VALUES ('old', 'preserve')")
        connection.commit()
    monkeypatch.setattr(database, "DB_PATH", path)
    asyncio.run(database.init_db())
    with sqlite3.connect(path) as connection:
        assert connection.execute(
            "SELECT marker FROM qa_books WHERE id='old'"
        ).fetchone() == ("preserve",)
```

- [ ] **Step 7: 运行配置、数据库和全后端测试**

Run:

```bash
ALLOWED_HOSTS="localhost,127.0.0.1,testserver" CORS_ORIGINS="http://testserver" .venv/Scripts/python.exe -m pytest backend/tests/test_config.py backend/tests/test_database.py backend/tests/test_library_compat.py -q
ALLOWED_HOSTS="localhost,127.0.0.1,testserver" CORS_ORIGINS="http://testserver" .venv/Scripts/python.exe -m pytest backend/tests -q
```

Expected: both commands PASS；总数会因删除 `test_knowledge.py` 与 AI API tests 而低于 179，但不得有失败。

- [ ] **Step 8: 扫描后端 AI 运行符号与 requirements**

Run:

```bash
python - <<'PY'
from pathlib import Path
terms = ('LLM_BASE_URL', 'LLM_API_KEY', 'LLM_MODEL', 'LLM_EMBEDDING_MODEL',
         'EMBEDDING_BASE_URL', 'EMBEDDING_API_KEY', 'EMBEDDING_MODEL',
         '/api/books/ask', '/api/knowledge/', '/api/drafts/generate')
paths = [*Path('backend').glob('*.py'), Path('.env.example')]
hits = {}
for path in paths:
    text = path.read_text(encoding='utf-8')
    found = [term for term in terms if term in text]
    if found:
        hits[str(path)] = found
requirements = Path('backend/requirements.txt').read_text(encoding='utf-8')
start_bat = Path('start.bat').read_text(encoding='utf-8')
start_sh = Path('start.sh').read_text(encoding='utf-8')
assert 'beautifulsoup4' not in requirements.casefold()
assert 'EbookLib>=0.18' in requirements
assert 'httpx>=0.28.0' in requirements
assert 'bs4' not in start_bat
assert 'bs4' not in start_sh
assert not hits, hits
PY
```

Expected: exit 0。

- [ ] **Step 9: Commit**

```bash
git add backend/config.py backend/requirements.txt backend/tests/test_config.py backend/tests/test_database.py start.bat start.sh .env.example
git commit -m "Remove AI configuration from the backend"
```

---

### Task 6: 删除主前端的知识索引状态与 AI 删除分支

**Files:**
- Modify: `frontend/app.js:84-87,1114-1372,1518-1964,2026-2042`
- Modify: `frontend/index.html:51-57,403-416,423`
- Modify: `frontend/tests/import-ux.spec.js`
- Modify: `frontend/tests/server-sync.spec.js:28-151`

**Interfaces:**
- Consumes: retained `/api/books` list/upload/file/sync/delete APIs and IndexedDB stores `books`, `highlights`, `bookmarks`, `sync_queue` at DB version 6。
- Produces: import still calls `uploadBookToServer`；book records keep server identifiers and file blobs but no new `knowledge_*` client behavior；deletion offers local removal or canonical server deletion, not a separate AI-data request。

- [ ] **Step 1: 先把 import 测试改成“只调用 /api/books”**

In `frontend/tests/import-ux.spec.js`, delete lines 18-20 (`knowledge_book_id`, `knowledge_status`, `knowledge_error`) from `makeServerBook`。Delete the route branches at lines 56-69 for `/api/knowledge/books/` and `/conversations`。In the test `opens the first page before a slow server upload finishes`, insert this immediately after `const serverBook = makeServerBook();`:

```js
const requestedPaths = [];
page.on('request', request => requestedPaths.push(new URL(request.url()).pathname));
```

Then insert these assertions immediately after the existing `await expect.poll(() => uploadStarted).toBe(true);`:

```js
await expect.poll(
  () => requestedPaths.filter(pathname => pathname === '/api/books/upload').length
).toBe(1);
expect(requestedPaths.filter(pathname => pathname.startsWith('/api/knowledge/'))).toEqual([]);
await expect(page.locator('#operation-status-detail')).not.toContainText(/AI|索引/);
```

In `frontend/tests/server-sync.spec.js`, delete `knowledge_book_id`, `knowledge_status`, and `knowledge_error` from `serverBook`。Delete the complete route branches at lines 113-120 that handle `/api/knowledge/books/knowledge-1` and conversation URLs。

- [ ] **Step 2: 运行聚焦测试并确认 AI 文案或请求断言失败**

Run:

```bash
cd frontend && npx playwright test tests/import-ux.spec.js tests/server-sync.spec.js
```

Expected: at least one assertion FAIL because current import flow calls `/api/knowledge/*` or displays `AI 索引` text。

- [ ] **Step 3: 删除知识状态变量、函数和记录字段**

In `frontend/app.js`, delete:

- `aiIndexPollTimer` and `knowledgeUploadsInFlight`；
- `formatKnowledgeStatus`；
- `recoverMissingKnowledgeBook`、`ensureKnowledgeBook`、`pollKnowledgeStatus`；
- every call to those functions；
- `knowledge_book_id`、`knowledge_status`、`knowledge_error` assignments in server record merge/import/rekey paths；
- `.book-card` 模板中调用 `formatKnowledgeStatus(book.knowledge_status)` 的 metadata span。

Keep `uploadBookToServer`, `uploadLocalBookInBackground`, `rekeyBookToServer`, `fetchServerBooks`, `syncBookState`, queue migration, protocol v2 and local EPUB fallback intact。

- [ ] **Step 4: 将上传状态文案改为纯书库语义**

Use these exact replacements in `uploadLocalBookInBackground`:

```js
setOperationStatus({
  state: 'uploading',
  message: `正在上传《${book.book_title || '未命名书籍'}》`,
  detail: '正文已经可以阅读，服务器保存会在后台继续',
  progress: 0,
});
```

At 100% use `文件已发送，正在保存到服务器书库`。After `rekeyBookToServer`, use:

```js
setOperationStatus({
  state: 'success',
  message: `《${merged.book_title}》已保存到服务器书库`,
  detail: '其他设备可以从书库打开并同步阅读进度',
  progress: 100,
  autoHideMs: 3500,
});
```

- [ ] **Step 5: 简化删除确认但保留两种数据边界**

Change `openBookDeleteModal` / `confirmBookDelete` so canonical server books call `DELETE /api/books/{serverBookId}` exactly once and local-only books only call `deleteBook(book.id)`。Remove the boolean `deleteAiData` branch and all `/api/knowledge/books/` requests。

Apply these exact text-node replacements in `frontend/index.html` without replacing surrounding tags or IDs:

```text
删除后端 AI 数据会同时清理上传的 EPUB、索引和全部问答会话。
→ 从所有设备删除会移除服务器 EPUB、阅读进度、书签、划线和笔记；仅移出本机不会删除服务器数据。

同时删除 AI 数据
→ 从所有设备删除
```

Keep `id="btn-delete-local-book"` and `id="btn-delete-all-book-data"` unchanged as internal compatibility keys。

- [ ] **Step 6: 主入口文案改为正式名称**

Apply this single text-node replacement in `frontend/index.html`:

```text
GPT 风格阅读
→ GPT 风格阅读器
```

Do not change resource query versions in this task；Task 8 changes HTML、Service Worker manifest and registration URL atomically under one red-green cycle。

- [ ] **Step 7: 运行 import/server-sync 测试**

Run:

```bash
cd frontend && npx playwright test tests/import-ux.spec.js tests/server-sync.spec.js
```

Expected: `7 passed`；captured requests contain no `/api/knowledge/` paths and protocol v2 assertion remains green。

- [ ] **Step 8: 静态扫描主前端残留**

Run:

```bash
python - <<'PY'
from pathlib import Path
for path in (Path('frontend/app.js'), Path('frontend/index.html')):
    text = path.read_text(encoding='utf-8')
    forbidden = ('/api/knowledge/', 'ensureKnowledgeBook', 'pollKnowledgeStatus',
                 'recoverMissingKnowledgeBook', 'AI 索引', 'AI 数据', 'knowledge_status')
    hits = [term for term in forbidden if term in text]
    assert not hits, (str(path), hits)
PY
```

Expected: exit 0。Do not include `knowledge_book_id` in a database-wide migration or delete it from existing IndexedDB rows；new code simply ignores historical properties。

- [ ] **Step 9: Commit**

```bash
git add frontend/app.js frontend/index.html frontend/tests/import-ux.spec.js frontend/tests/server-sync.spec.js
git commit -m "Remove AI indexing from the primary reader"
```

---

### Task 7: 把 book-chat 用户文案统一为 GPT 风格阅读器

**Files:**
- Modify: `frontend/book-chat/index.html:17-113`
- Modify: `frontend/book-chat/app.js:308-325,575-591,607-703,946-966`
- Modify: `frontend/tests/book-chat.spec.js`

**Interfaces:**
- Consumes: existing `/book-chat/` layout, `/api/books/*`, local EPUB full-text search, theme/sidebar/progress behavior。
- Produces: user-visible title/description/brand `GPT 风格阅读器`；tabs/empty states/import/search use book semantics；storage and internal compatibility identifiers are byte-for-byte unchanged。

- [ ] **Step 1: 先改 Playwright 文案断言并增加禁词断言**

Update relevant tests in `frontend/tests/book-chat.spec.js` with:

```js
await expect(page).toHaveTitle('GPT 风格阅读器');
await expect(page.locator('meta[name="description"]')).toHaveAttribute(
  'content',
  '采用 GPT 风格布局的 EPUB 阅读器'
);
await expect(page.locator('.brand')).toContainText('GPT 风格阅读器');
await expect(page.getByRole('tab', { name: '书库' })).toHaveAttribute('aria-selected', 'true');
await expect(page.getByRole('tabpanel', { name: '书库' })).toBeVisible();
await expect(page.locator('#search-input')).toHaveAttribute('placeholder', '搜索本书内容');
```

Add a dedicated test:

```js
test('uses reader language without implying AI chat', async ({ page }) => {
  await mockReaderApi(page, { empty: true });
  await page.goto('/book-chat/');
  const visibleText = await page.locator('body').innerText();
  for (const forbidden of ['新聊天', '聊天历史', '选择对话', '询问任何问题', '回答']) {
    expect(visibleText).not.toContain(forbidden);
  }
  await expect(page.locator('#import-button')).toContainText('导入书籍');
  await expect(page.locator('#library-count')).toHaveAttribute('aria-label', '书籍数量');
});
```

- [ ] **Step 2: 运行 book-chat 测试并确认旧文案失败**

Run:

```bash
cd frontend && npx playwright test tests/book-chat.spec.js
```

Expected: failures mention current `ChatGPT`、`聊天`、`询问任何问题` strings；reader behavior tests remain runnable。

- [ ] **Step 3: 按精确清单替换 HTML 属性值和文本节点**

Apply these exact replacements in `frontend/book-chat/index.html`; do not replace surrounding elements:

```text
<meta name="description" content="ChatGPT">
→ <meta name="description" content="采用 GPT 风格布局的 EPUB 阅读器">

<title>ChatGPT</title>
→ <title>GPT 风格阅读器</title>

aria-label="ChatGPT 首页"
→ aria-label="GPT 风格阅读器首页"

<strong>ChatGPT</strong>
→ <strong>GPT 风格阅读器</strong>

>聊天</button>
→ >书库</button>

<span>新聊天</span>
→ <span>导入书籍</span>

<h2>聊天历史</h2>
→ <h2>书籍</h2>

aria-label="对话数量"
→ aria-label="书籍数量"

<strong id="toc-book-title">ChatGPT</strong>
→ <strong id="toc-book-title">GPT 风格阅读器</strong>

选择对话后显示大纲。
→ 选择书籍后显示大纲。

<h1 id="chapter-title" aria-live="polite">ChatGPT</h1>
→ <h1 id="chapter-title" aria-live="polite">GPT 风格阅读器</h1>

aria-label="对话内容"
→ aria-label="阅读内容"

<h2 id="state-title">有什么可以帮忙的？</h2>
→ <h2 id="state-title">选择一本书开始阅读</h2>

<p id="state-description">从左侧选择对话继续，或开始一个新对话。</p>
→ <p id="state-description">从左侧选择书籍，或导入一本 EPUB。</p>

<button class="state-action" id="state-action" type="button">新聊天</button>
→ <button class="state-action" id="state-action" type="button">导入书籍</button>

placeholder="询问任何问题"
→ placeholder="搜索本书内容"
```

Do not change `/book-chat/`, any element ID, CSS class, or `style.css?v=3` query。

- [ ] **Step 4: 修改动态文案**

In `frontend/book-chat/app.js`, use:

```js
book.title || book.original_filename || book.filename || '未命名书籍'
```

and these empty states:

```js
if (!books.length) dom.libraryEmpty.textContent = '还没有书籍，点击上方按钮导入。';
// loadBooks empty
setReaderState('empty', '选择一本书开始阅读', '导入的书籍会出现在左侧书库中。', '导入书籍');
// loadBooks idle
setReaderState('idle', '选择一本书开始阅读', '从左侧书库选择一本书。');
```

In `uploadBook`, apply these exact string replacements:

```text
正在创建… → 正在导入…
正在创建 → 正在导入
创建失败 → 导入失败
已经存在同样的内容 → 书库中已存在同一本书
已创建 → 书籍已导入
新聊天 → 导入书籍
```

- [ ] **Step 5: 递增 book-chat app query 并明确兼容键不变**

Replace only this script tag in `frontend/book-chat/index.html`:

```html
<script src="app.js?v=4"></script>
```

with:

```html
<script src="app.js?v=5"></script>
```

Keep `style.css?v=3` unchanged。Then run:

Run:

```bash
python - <<'PY'
from pathlib import Path
text = Path('frontend/book-chat/app.js').read_text(encoding='utf-8')
required = (
  "marginalia.chatReader.selectedBookId",
  "marginalia.chatReader.position.",
  "marginalia.chatReader.theme",
  "chat-reader-progress-",
  "chatReaderKeys",
)
assert all(value in text for value in required)
PY
```

Expected: exit 0。

- [ ] **Step 6: 运行完整 book-chat 行为测试**

Run:

```bash
cd frontend && npx playwright test tests/book-chat.spec.js
```

Expected: `20 passed`（原 19 加新文案用例）；书库加载、打开、目录、搜索、主题、侧栏和进度测试全绿，`forbiddenRequests` 仍为空。

- [ ] **Step 7: Commit**

```bash
git add frontend/book-chat/index.html frontend/book-chat/app.js frontend/tests/book-chat.spec.js
git commit -m "Rename book chat copy to GPT-style reader"
```

---

### Task 8: 原子同步 HTML、Service Worker manifest 与注册版本

**Files:**
- Modify: `frontend/index.html:10,423`
- Modify: `frontend/app.js:5261`
- Modify: `frontend/sw.js:6-20`
- Modify: `frontend/tests/app-shell-versions.spec.js`

**Interfaces:**
- Consumes: Task 7 的 `book-chat/app.js?v=5` 与未修改的 `book-chat/style.css?v=3`。
- Produces: main `app.js?v=37`、main `style.css?v=36`、book-chat app v5、book-chat style v3、`sw.js?v=26`、cache `marginalia-shell-v39` 的精确一致契约。

- [ ] **Step 1: 强化 app-shell 失败测试覆盖全部固定版本**

Append inside the existing test in `frontend/tests/app-shell-versions.spec.js`:

```js
const appJs = readFileSync(join(FRONTEND_DIR, 'app.js'), 'utf8');
const bookChatHtml = readFileSync(join(FRONTEND_DIR, 'book-chat', 'index.html'), 'utf8');

expect(indexHtml).toContain('style.css?v=36');
expect(indexHtml).toContain('app.js?v=37');
expect(bookChatHtml).toContain('style.css?v=3');
expect(bookChatHtml).toContain('app.js?v=5');
expect(swJs).toContain("'style.css?v=36'");
expect(swJs).toContain("'app.js?v=37'");
expect(swJs).toContain("'book-chat/style.css?v=3'");
expect(swJs).toContain("'book-chat/app.js?v=5'");
expect(swJs).toContain("const APP_SHELL_CACHE_NAME = 'marginalia-shell-v39'");
expect(appJs).toContain("navigator.serviceWorker.register('sw.js?v=26')");
expect(indexHtml).not.toContain('style.css?v=37');
expect(bookChatHtml).not.toContain('style.css?v=4');
```

- [ ] **Step 2: 运行版本测试并确认精确失败项**

Run:

```bash
cd frontend && npx playwright test tests/app-shell-versions.spec.js
```

Expected: FAIL because main app remains v36，SW cache remains v38，book-chat manifest remains app v4，and SW registration remains v25。

- [ ] **Step 3: 同一实现步骤完成全部精确版本替换**

Apply exactly:

```text
frontend/index.html: app.js?v=36 → app.js?v=37
frontend/index.html: style.css?v=36 stays unchanged
frontend/app.js: sw.js?v=25 → sw.js?v=26
frontend/sw.js: marginalia-shell-v38 → marginalia-shell-v39
frontend/sw.js: app.js?v=36 → app.js?v=37
frontend/sw.js: style.css?v=36 stays unchanged
frontend/sw.js: book-chat/app.js?v=4 → book-chat/app.js?v=5
frontend/sw.js: book-chat/style.css?v=3 stays unchanged
```

Do not alter API network-only or EPUB cache-first branches。

- [ ] **Step 4: 运行版本与 28 条更新后聚焦测试**

Run:

```bash
cd frontend && npx playwright test tests/app-shell-versions.spec.js tests/book-chat.spec.js tests/server-sync.spec.js tests/import-ux.spec.js
```

Expected: `28 passed`。

- [ ] **Step 5: 运行隔离后的全量 pytest**

Run:

```bash
ALLOWED_HOSTS="localhost,127.0.0.1,testserver" CORS_ORIGINS="http://testserver" .venv/Scripts/python.exe -m pytest backend/tests -q
```

Expected: all collected tests PASS；测试数低于原 179 是因为 AI 测试被删除，输出中不能有 skip/error/fail。

- [ ] **Step 6: 运行完整 Playwright**

Run:

```bash
cd frontend && npx playwright test
```

Expected: all collected tests PASS。

- [ ] **Step 7: 全仓业务文件扫描 AI 运行路径，排除历史设计文档**

Run:

```bash
python - <<'PY'
from pathlib import Path
roots = [Path('backend'), Path('frontend')]
terms = ('/api/books/ask', '/api/knowledge/', '/api/drafts/generate',
         'LLM_BASE_URL', 'EMBEDDING_MODEL', 'ensureKnowledgeBook', 'pollKnowledgeStatus')
hits = []
for root in roots:
    for path in root.rglob('*'):
        if not path.is_file() or any(part in {'node_modules', '__pycache__', '.pytest_cache', 'data'} for part in path.parts):
            continue
        if path.suffix not in {'.py', '.js', '.html', '.css'}:
            continue
        text = path.read_text(encoding='utf-8')
        found = [term for term in terms if term in text]
        if found:
            hits.append((str(path), found))
assert not hits, hits
PY
```

Expected: exit 0。Historical AI table names are allowed only in compatibility tests that prove preservation；this scan intentionally targets runtime routes/config/client symbols, not `qa_*` names。

- [ ] **Step 8: Commit**

```bash
git add frontend/index.html frontend/app.js frontend/sw.js frontend/tests/app-shell-versions.spec.js
git commit -m "Version the AI-free application shell"
```

---

## Final Verification: 真实保留功能冒烟与阶段交接

**Files:**
- Verify: `backend/main.py`
- Verify: `backend/library.py`
- Verify: `frontend/app.js`
- Verify: `frontend/book-chat/app.js`
- Create during execution: `.git/remove-ai-smoke-launcher.py`（临时 launcher，不提交）

**Interfaces:**
- Consumes: 本计划全部提交。
- Produces: 使用临时 SQLite 与临时 EPUB 目录运行的真实 FastAPI 证据；绝不访问 `backend/data/books`。

- [ ] **Step 1: 创建可直接执行的临时 launcher**

Run from Git Bash:

```bash
TMP_ROOT="$(mktemp -d)"
cat > .git/remove-ai-smoke-launcher.py <<'PY'
import os
import sys
from pathlib import Path

root = Path(os.environ["MARGINALIA_SMOKE_ROOT"]).resolve()
backend = Path.cwd() / "backend"
sys.path.insert(0, str(backend))
os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{root / 'marginalia.db'}"
os.environ["ALLOWED_HOSTS"] = "127.0.0.1,localhost,testserver"
os.environ["CORS_ORIGINS"] = "http://127.0.0.1:8872"

import books_api
import library

books_dir = root / "books"
books_dir.mkdir(parents=True, exist_ok=True)
books_api.BOOKS_DIR = books_dir
library.BOOKS_DIR = books_dir

import main
import uvicorn

uvicorn.run(main.app, host="127.0.0.1", port=8872)
PY
MARGINALIA_SMOKE_ROOT="$TMP_ROOT" .venv/Scripts/python.exe .git/remove-ai-smoke-launcher.py
```

Expected: server starts on `127.0.0.1:8872`; imported `database.DB_PATH` resolves under `$TMP_ROOT` and both book-directory module globals point to `$TMP_ROOT/books` before lifespan reconciliation runs。Keep this foreground process running through Step 4。

- [ ] **Step 2: 验证 health、规则脚本与 removed API**

Run in another terminal:

```bash
curl -sS http://127.0.0.1:8872/health
curl -sS -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:8872/api/books/ask -H 'Content-Type: application/json' -d '{"question":"x"}'
curl -sS -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:8872/api/drafts/generate -H 'Content-Type: application/json' -d '{"target":"video","highlight_ids":["x"]}'
```

Expected: health JSON has `"status":"ok"`; both removed endpoints return `404`。

- [ ] **Step 3: 通过真实 API 上传、列出、读取、同步与删除 fixture EPUB**

Run:

```bash
curl -sS -F "file=@frontend/tests/fixtures/multichapter.epub;type=application/epub+zip" http://127.0.0.1:8872/api/books/upload > "$TMP_ROOT/upload.json"
.venv/Scripts/python.exe - "$TMP_ROOT/upload.json" <<'PY'
import json, sys
payload=json.load(open(sys.argv[1], encoding='utf-8'))
assert payload['created'] is True
book=payload['book']
assert book['id'] and book['title']=='Multichapter Test Fixture'
assert not ({'knowledge_book_id','knowledge_status','knowledge_error'} & set(book))
print(book['id'])
PY
BOOK_ID="$(.venv/Scripts/python.exe -c "import json; print(json.load(open(r'$TMP_ROOT/upload.json'))['book']['id'])")"
curl -sS "http://127.0.0.1:8872/api/books/$BOOK_ID/file" -o "$TMP_ROOT/download.epub"
curl -sS -X POST "http://127.0.0.1:8872/api/books/$BOOK_ID/sync" -H 'Content-Type: application/json' -d '{"protocol_version":2,"operations":[{"op_id":"smoke-progress-1","type":"progress.set","entity_id":"","payload":{"cfi":"epubcfi(/6/2)","progress_percent":12,"last_opened":1}}]}'
curl -sS -X DELETE "http://127.0.0.1:8872/api/books/$BOOK_ID"
```

Expected: downloaded bytes are non-empty；sync response has `revision: 1` and progress 12；delete response JSON has `deleted is True` and its `book_id` equals `$BOOK_ID`。

- [ ] **Step 4: 浏览器验证两个阅读器但不验证 ZeroTier/Service Worker**

Open `http://127.0.0.1:8872/` and `http://127.0.0.1:8872/book-chat/`。Expected: 主界面入口为“GPT 风格阅读器”；book-chat 页面无聊天/询问/回答语义；导入、打开、目录与本书搜索可操作。ZeroTier binding and secure-context acceptance belong to the next plan, not this task。

- [ ] **Step 5: 先停止服务，再清理 launcher 与临时目录**

In the server terminal press `Ctrl+C` and wait for Uvicorn shutdown completion。Then run:

```bash
rm -f .git/remove-ai-smoke-launcher.py
rm -rf "$TMP_ROOT"
test ! -e .git/remove-ai-smoke-launcher.py
test ! -e "$TMP_ROOT"
git status --short
```

Expected: both `test` commands exit 0；no generated database/EPUB appears under `backend/data/` or Git status。

- [ ] **Step 6: 最终阶段 commit 检查**

Run:

```bash
git log --oneline -8
git status --short
```

Expected: Tasks 2-8 each have an independently reviewable commit；没有意外修改 `.env`、`.env.production` 或 `backend/data/`。本计划结束；下一步严格执行 `docs/superpowers/plans/2026-09-23-zerotier-runtime.md`。
