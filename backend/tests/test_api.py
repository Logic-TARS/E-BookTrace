"""Tests for FastAPI endpoints (backend/main.py)."""

from functools import lru_cache
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import database as db_module
import config as config_module
import books_api as books_api_module
import library as library_module
from main import app


@pytest.fixture(autouse=True)
def reset_db(tmp_path, monkeypatch):
    monkeypatch.setattr(db_module, "DB_PATH", tmp_path / "marginalia.db")
    monkeypatch.setattr(db_module, "NOTES_JSON_PATH", tmp_path / "notes.json")
    monkeypatch.setattr(books_api_module, "BOOKS_DIR", tmp_path / "books")
    monkeypatch.setattr(library_module, "BOOKS_DIR", tmp_path / "books")


@pytest.fixture
def client():
    with TestClient(app) as client:
        yield client


class TestHealth:
    def test_health_check(self, client):
        resp = client.get("/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"
        assert data["service"] == "marginalia"

    def test_untrusted_host_is_rejected(self):
        # Isolate from the developer's real .env ALLOWED_HOSTS: the value was
        # baked into the middleware kwargs at import time, so patch them and
        # force the middleware stack to rebuild.
        from starlette.middleware.trustedhost import TrustedHostMiddleware

        saved = []
        for mw in app.user_middleware:
            if mw.cls is TrustedHostMiddleware:
                saved.append(mw.kwargs["allowed_hosts"])
                mw.kwargs["allowed_hosts"] = ["localhost", "127.0.0.1", "testserver"]
        app.middleware_stack = None
        try:
            resp = TestClient(app).get("/health", headers={"host": "attacker.example"})
            assert resp.status_code == 400
        finally:
            for mw in app.user_middleware:
                if mw.cls is TrustedHostMiddleware:
                    mw.kwargs["allowed_hosts"] = saved.pop(0)
            app.middleware_stack = None

    def test_api_responses_are_not_cacheable(self, client):
        resp = client.get("/api/highlights")
        assert resp.status_code == 200
        assert resp.headers["cache-control"] == "private, no-store"
        assert resp.headers["cdn-cache-control"] == "no-store"
        assert resp.headers["cloudflare-cdn-cache-control"] == "no-store"
        assert resp.headers["pragma"] == "no-cache"

    def test_static_assets_keep_pwa_cache_policy(self, client):
        resp = client.get("/manifest.json")
        assert resp.status_code == 200
        assert "cdn-cache-control" not in resp.headers
        assert "cloudflare-cdn-cache-control" not in resp.headers


class TestSyncHighlights:
    def test_sync_success(self, client):
        payload = {
            "highlights": [
                {
                    "book_title": "沉思录",
                    "book_author": "马可",
                    "highlight_text": "宇宙是变化，人生是看法。",
                    "chapter": "卷四",
                    "color": "yellow",
                    "progress_percent": 35,
                }
            ]
        }
        resp = client.post("/api/highlights", json=payload)
        assert resp.status_code == 200
        data = resp.json()
        assert data["received"] == 1
        assert len(data["ids"]) == 1

    def test_sync_multiple_highlights(self, client):
        payload = {
            "highlights": [
                {"book_title": "A", "highlight_text": "1"},
                {"book_title": "A", "highlight_text": "2"},
                {"book_title": "A", "highlight_text": "3"},
            ]
        }
        resp = client.post("/api/highlights", json=payload)
        assert resp.status_code == 200
        assert resp.json()["received"] == 3

    def test_sync_empty_highlights_422(self, client):
        resp = client.post("/api/highlights", json={"highlights": []})
        assert resp.status_code == 422

    def test_sync_missing_field_422(self, client):
        payload = {"highlights": [{"book_title": "X"}]}  # missing highlight_text
        resp = client.post("/api/highlights", json=payload)
        assert resp.status_code == 422


class TestListHighlights:
    def test_list_empty(self, client):
        resp = client.get("/api/highlights")
        assert resp.status_code == 200
        data = resp.json()
        assert data["highlights"] == []
        assert data["count"] == 0

    def test_list_after_sync(self, client):
        # First sync some highlights
        payload = {
            "highlights": [
                {"book_title": "论语", "highlight_text": "学而时习之"},
            ]
        }
        client.post("/api/highlights", json=payload)

        resp = client.get("/api/highlights")
        assert resp.status_code == 200
        data = resp.json()
        assert data["count"] == 1
        assert data["highlights"][0]["book_title"] == "论语"

    def test_list_filter_book_title(self, client):
        # Sync highlights from different books
        client.post("/api/highlights", json={
            "highlights": [
                {"book_title": "论语", "highlight_text": "学而"},
                {"book_title": "孟子", "highlight_text": "仁者"},
            ]
        })
        resp = client.get("/api/highlights", params={"book_title": "论语"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["count"] == 1
        assert data["highlights"][0]["book_title"] == "论语"

    def test_list_pagination(self, client):
        # Add 3 highlights
        highlights = [
            {"book_title": "X", "highlight_text": f"text{i}"} for i in range(3)
        ]
        client.post("/api/highlights", json={"highlights": highlights})

        resp = client.get("/api/highlights", params={"limit": 2, "offset": 0})
        assert resp.json()["count"] == 2


class TestHighlightCrud:
    def test_sync_with_client_id_can_get_single_highlight(self, client):
        payload = {
            "highlights": [
                {
                    "id": "local-1",
                    "book_title": "论语",
                    "highlight_text": "学而时习之",
                    "note": "初始笔记",
                }
            ]
        }
        sync_resp = client.post("/api/highlights", json=payload)
        assert sync_resp.status_code == 200
        sync_data = sync_resp.json()
        assert sync_data["items"][0]["client_id"] == "local-1"

        resp = client.get("/api/highlights/local-1")
        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == sync_data["ids"][0]
        assert data["client_id"] == "local-1"
        assert data["note"] == "初始笔记"

    def test_sync_same_client_id_updates_instead_of_inserting(self, client):
        client.post("/api/highlights", json={
            "highlights": [
                {
                    "id": "local-1",
                    "book_title": "论语",
                    "highlight_text": "学而时习之",
                    "note": "旧笔记",
                }
            ]
        })
        resp = client.post("/api/highlights", json={
            "highlights": [
                {
                    "id": "local-1",
                    "book_title": "论语",
                    "highlight_text": "学而时习之",
                    "note": "新笔记",
                    "tags": ["儒学"],
                }
            ]
        })
        assert resp.status_code == 200
        assert resp.json()["items"][0]["action"] == "updated"

        list_resp = client.get("/api/highlights")
        data = list_resp.json()
        assert data["count"] == 1
        assert data["highlights"][0]["note"] == "新笔记"
        assert data["highlights"][0]["tags"] == ["儒学"]

    def test_patch_highlight_updates_export(self, client):
        sync_resp = client.post("/api/highlights", json={
            "highlights": [
                {"id": "local-2", "book_title": "孟子", "highlight_text": "仁者爱人"}
            ]
        })
        server_id = sync_resp.json()["ids"][0]

        resp = client.patch(
            f"/api/highlights/{server_id}",
            json={"note": "核心观点", "tags": ["儒学"], "color": "blue"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["note"] == "核心观点"
        assert data["tags"] == ["儒学"]
        assert data["color"] == "blue"

        export_resp = client.get("/api/notes/export")
        exported = export_resp.json()
        assert exported[0]["note"] == "核心观点"
        assert exported[0]["tags"] == ["儒学"]

    def test_patch_empty_update_422(self, client):
        client.post("/api/highlights", json={
            "highlights": [
                {"id": "local-3", "book_title": "庄子", "highlight_text": "逍遥游"}
            ]
        })
        resp = client.patch("/api/highlights/local-3", json={})
        assert resp.status_code == 422

    def test_delete_highlight_removes_from_list_and_export(self, client):
        client.post("/api/highlights", json={
            "highlights": [
                {"id": "local-4", "book_title": "大学", "highlight_text": "明明德"}
            ]
        })

        resp = client.request("DELETE", "/api/highlights/local-4", json={"client_id": "local-4"})
        assert resp.status_code == 200
        assert resp.json()["deleted"] is True

        assert client.get("/api/highlights/local-4").status_code == 404
        assert client.get("/api/highlights").json()["count"] == 0
        assert client.get("/api/notes/export").json() == []

    def test_delete_legacy_highlight_by_exact_match(self, client):
        created_at = "2026-07-04T12:00:00Z"
        client.post("/api/highlights", json={
            "highlights": [
                {
                    "book_title": "旧书",
                    "cfi": "epubcfi(/6/2)",
                    "highlight_text": "旧划线",
                    "created_at": created_at,
                }
            ]
        })

        resp = client.request("DELETE", "/api/highlights/local-old", json={
            "book_title": "旧书",
            "cfi": "epubcfi(/6/2)",
            "highlight_text": "旧划线",
            "created_at": created_at,
        })
        assert resp.status_code == 200
        assert client.get("/api/highlights").json()["count"] == 0

    def test_missing_highlight_crud_404(self, client):
        assert client.get("/api/highlights/missing").status_code == 404
        assert client.patch("/api/highlights/missing", json={"note": "x"}).status_code == 404
        assert client.delete("/api/highlights/missing").status_code == 404


class TestRemovedFeatures:
    @pytest.mark.parametrize(("method", "path"), [
        ("POST", "/api/books/ask"),
        ("POST", "/api/knowledge/books/upload"),
        ("POST", "/api/knowledge/books/from-server"),
        ("GET", "/api/knowledge/books/book-1"),
        ("POST", "/api/knowledge/books/book-1/reindex"),
        ("DELETE", "/api/knowledge/books/book-1"),
        ("GET", "/api/knowledge/books/book-1/conversations"),
        ("POST", "/api/knowledge/books/book-1/conversations"),
        ("DELETE", "/api/knowledge/conversations/conversation-1"),
        ("GET", "/api/knowledge/conversations/conversation-1/messages"),
        ("POST", "/api/knowledge/conversations/conversation-1/messages/stream"),
        ("GET", "/api/tts/voices"),
        ("POST", "/api/books/book-1/chapters/chapter.xhtml/tts"),
        ("GET", "/api/tts/tasks/task-1"),
        ("GET", "/api/tts/tasks/task-1/segments/0"),
        ("POST", "/api/generate-script"),
        ("POST", "/api/drafts/generate"),
        ("GET", "/api/drafts"),
        ("GET", "/api/drafts/draft-1"),
        ("PATCH", "/api/drafts/draft-1"),
        ("DELETE", "/api/drafts/draft-1"),
    ])
    def test_routes_are_unavailable(self, client, method, path):
        response = client.request(method, path, json={})
        assert response.status_code in {404, 405}

    def test_removed_features_are_absent_from_openapi(self, client):
        schema = client.get("/openapi.json").json()
        assert not any(
            token in path for path in schema["paths"]
            for token in ("knowledge", "tts", "draft", "generate-script", "/ask")
        )
        assert not any(
            token in name for name in schema["components"]["schemas"]
            for token in ("QA", "Draft", "Script", "TTS", "Conversation")
        )

    def test_draft_export_is_rejected(self, client):
        response = client.post("/api/obsidian/export", json={
            "kind": "draft", "draft_id": "old-draft",
        })
        assert response.status_code == 422


class TestServerLibraryAPI:
    @staticmethod
    @lru_cache(maxsize=1)
    def _epub_bytes():
        import io
        from ebooklib import epub

        book = epub.EpubBook()
        book.set_identifier("reader-test")
        book.set_title("阅读测试")
        book.set_language("zh")
        book.add_author("测试作者")
        chapter = epub.EpubHtml(title="第一章", file_name="chapter.xhtml", lang="zh")
        chapter.content = "<h1>第一章</h1><p>阅读带来新的理解。</p>"
        book.add_item(chapter)
        book.toc = [chapter]
        book.spine = ["nav", chapter]
        book.add_item(epub.EpubNav())
        output = io.BytesIO()
        epub.write_epub(output, book)
        return output.getvalue()

    def test_upload_is_server_visible_and_deduplicated(self, client):
        first = client.post(
            "/api/books/upload",
            files={"file": ("remote.epub", self._epub_bytes(), "application/epub+zip")},
        )
        second = client.post(
            "/api/books/upload",
            files={"file": ("copy.epub", self._epub_bytes(), "application/epub+zip")},
        )

        assert first.status_code == 202
        assert first.json()["created"] is True
        assert second.status_code == 202
        assert second.json()["created"] is False
        book = first.json()["book"]
        assert second.json()["book"]["id"] == book["id"]
        listed = client.get("/api/books").json()["books"]
        assert [item["id"] for item in listed] == [book["id"]]
        served = client.get(f"/api/books/{book['id']}/file")
        assert served.status_code == 200
        assert served.content == self._epub_bytes()

    def test_upload_accepts_uppercase_extension(self, client):
        resp = client.post(
            "/api/books/upload",
            files={"file": ("BOOK.EPUB", self._epub_bytes(), "application/epub+zip")},
        )
        assert resp.status_code == 202

    def test_upload_rejects_wrong_extension(self, client):
        library_resp = client.post(
            "/api/books/upload",
            files={"file": ("book.zip", self._epub_bytes(), "application/epub+zip")},
        )
        assert library_resp.status_code == 415

    def test_upload_rejects_non_zip(self, client):
        resp = client.post(
            "/api/books/upload",
            files={"file": ("fake.epub", b"definitely not a zip", "application/epub+zip")},
        )
        assert resp.status_code == 415

    def test_upload_rejects_zip_without_container(self, client):
        import io
        import zipfile

        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as archive:
            archive.writestr("hello.txt", "hi")
        resp = client.post(
            "/api/books/upload",
            files={"file": ("fake.epub", buf.getvalue(), "application/epub+zip")},
        )
        assert resp.status_code == 415

    @pytest.mark.parametrize("size", [0, 1024 * 1024 + 1], ids=["empty", "oversized"])
    def test_upload_size_limit(self, client, monkeypatch, size):
        content = b"x" * size
        monkeypatch.setattr(config_module.settings, "max_epub_upload_mb", 1)
        response = client.post("/api/books/upload", files={
            "file": ("book.epub", content, "application/epub+zip"),
        })
        assert response.status_code == 413
        assert list(books_api_module.BOOKS_DIR.iterdir()) == []

    @pytest.mark.parametrize(("limit", "code"), [
        ("MAX_ZIP_ENTRIES", "epub_too_many_entries"),
        ("MAX_UNCOMPRESSED_BYTES", "epub_too_large"),
    ])
    def test_archive_safety_limits(self, client, monkeypatch, limit, code):
        monkeypatch.setattr(books_api_module, limit, 1)
        response = client.post("/api/books/upload", files={
            "file": ("book.epub", self._epub_bytes(), "application/epub+zip"),
        })
        assert response.status_code == 413
        assert response.json()["detail"]["code"] == code
        assert list(books_api_module.BOOKS_DIR.iterdir()) == []

    def test_malformed_epub_metadata_is_rejected(self, client):
        import io
        from zipfile import ZipFile

        output = io.BytesIO()
        with ZipFile(output, "w") as archive:
            archive.writestr("META-INF/container.xml", "<broken>")
        response = client.post("/api/books/upload", files={
            "file": ("book.epub", output.getvalue(), "application/epub+zip"),
        })
        assert response.status_code == 415
        assert response.json()["detail"]["code"] == "invalid_epub"
        assert list(books_api_module.BOOKS_DIR.iterdir()) == []

    def test_failed_upload_leaves_no_files_behind(self, client):
        import books_api as books_api_module

        before = set(Path(books_api_module.BOOKS_DIR).glob("*.epub"))
        client.post(
            "/api/books/upload",
            files={"file": ("fake.epub", b"not a zip", "application/epub+zip")},
        )
        after = set(Path(books_api_module.BOOKS_DIR).glob("*.epub"))
        assert before == after

    def test_cross_device_state_sync_is_idempotent(self, client):
        uploaded = client.post(
            "/api/books/upload",
            files={"file": ("sync.epub", self._epub_bytes(), "application/epub+zip")},
        ).json()["book"]

        operations = [
            {
                "op_id": "progress-op-1",
                "type": "progress.set",
                "payload": {
                    "cfi": "epubcfi(/6/4!/4/2)",
                    "progress_percent": 42,
                    "last_opened": 123456,
                },
            },
            {
                "op_id": "bookmark-op-1",
                "type": "bookmark.upsert",
                "entity_id": "bookmark-1",
                "payload": {
                    "chapter": "Chapter Two",
                    "cfi": "epubcfi(/6/4!/4/2)",
                    "progress_percent": 42,
                    "label": "Chapter Two · 42%",
                },
            },
            {
                "op_id": "highlight-op-1",
                "type": "highlight.upsert",
                "entity_id": "highlight-1",
                "payload": {
                    "chapter": "Chapter Two",
                    "cfi": "epubcfi(/6/4!/4/2)",
                    "highlight_text": "cross-device",
                    "note": "server note",
                    "tags": ["sync"],
                    "progress_percent": 42,
                },
            },
        ]
        first = client.post(
            f"/api/books/{uploaded['id']}/sync", json={"operations": operations}
        )
        repeated = client.post(
            f"/api/books/{uploaded['id']}/sync", json={"operations": operations}
        )

        assert first.status_code == 200
        assert repeated.status_code == 200
        state = repeated.json()
        assert state["revision"] == 3
        assert state["progress"]["progress_percent"] == 42
        assert [item["id"] for item in state["bookmarks"]] == ["bookmark-1"]
        assert state["highlights"][0]["client_id"] == "highlight-1"
        assert state["highlights"][0]["note"] == "server note"

    def test_delete_removes_file_and_reader_state(self, client):
        book = client.post(
            "/api/books/upload",
            files={"file": ("delete.epub", self._epub_bytes(), "application/epub+zip")},
        ).json()["book"]

        client.post(
            f"/api/books/{book['id']}/sync",
            json={
                "operations": [
                    {
                        "op_id": "delete-progress",
                        "type": "progress.set",
                        "payload": {"progress_percent": 5},
                    }
                ]
            },
        )
        deleted = client.delete(f"/api/books/{book['id']}")
        assert deleted.status_code == 200
        assert client.get(f"/api/books/{book['id']}/file").status_code == 404
        assert client.get(f"/api/books/{book['id']}/sync").status_code == 404
        assert client.get("/api/books").json()["books"] == []


class TestNotesWorkspace:
    def test_materials_filter_by_book_tag_and_status(self, client):
        client.post("/api/highlights", json={
            "highlights": [
                {
                    "id": "m-1",
                    "book_title": "沉思录",
                    "highlight_text": "宇宙是变化",
                    "note": "有感悟",
                    "tags": ["哲学"],
                },
                {
                    "id": "m-2",
                    "book_title": "论语",
                    "highlight_text": "学而",
                    "tags": ["儒学"],
                },
            ]
        })

        resp = client.get("/api/materials", params={
            "book_title": "沉思录",
            "tag": "哲学",
            "status": "reflected",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["count"] == 1
        assert data["materials"][0]["client_id"] == "m-1"

    def test_obsidian_export_book(self, client, tmp_path):
        import config

        client.post("/api/highlights", json={
            "highlights": [
                {
                    "id": "o-1",
                    "book_title": "沉思录",
                    "book_author": "马可",
                    "highlight_text": "宇宙是变化",
                    "note": "重点",
                }
            ]
        })
        old_path = config.settings.obsidian_vault_path
        config.settings.obsidian_vault_path = str(tmp_path)
        try:
            resp = client.post("/api/obsidian/export", json={
                "kind": "book",
                "book_title": "沉思录",
            })
        finally:
            config.settings.obsidian_vault_path = old_path

        assert resp.status_code == 200
        path = Path(resp.json()["path"])
        assert path.exists()
        assert "宇宙是变化" in path.read_text(encoding="utf-8")


class TestNotesExport:
    def test_export_empty(self, client):
        resp = client.get("/api/notes/export")
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        assert data == []

    def test_export_after_sync(self, client):
        client.post("/api/highlights", json={
            "highlights": [
                {
                    "book_title": "论语",
                    "highlight_text": "学而时习之",
                    "note": "学习与温习",
                    "tags": ["儒学"],
                }
            ]
        })
        # Trigger export
        resp = client.get("/api/notes/export")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) >= 1
        entry = data[0]
        assert "book_title" in entry
        assert "highlight_text" in entry
        assert "note" in entry
        assert "tags" in entry
        assert "created_at" in entry


class TestLibraryIsolation:
    def test_fresh_library_has_no_removed_feature_tables(self, client):
        import sqlite3

        with sqlite3.connect(db_module.DB_PATH) as db:
            names = {row[0] for row in db.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            )}
        assert {"highlights", "library_books", "reader_bookmarks", "reading_states"} <= names
        assert "drafts" not in names
        assert not any(name.startswith(("qa_", "tts_")) for name in names)
        assert client.get("/api/books").json() == {"books": []}

    def test_legacy_epub_registration_needs_no_knowledge_tables(self):
        books_api_module.BOOKS_DIR.mkdir(parents=True)
        source = books_api_module.BOOKS_DIR / "legacy.epub"
        source.write_bytes(TestServerLibraryAPI._epub_bytes())
        with TestClient(app) as client:
            books = client.get("/api/books").json()["books"]
            assert len(books) == 1
            assert books[0]["title"] == "阅读测试"
            assert books[0]["author"] == "测试作者"
            assert not any(key.startswith("knowledge") for key in books[0])
            assert client.get(f"/api/books/{books[0]['id']}/file").content == source.read_bytes()
        with TestClient(app) as client:
            assert len(client.get("/api/books").json()["books"]) == 1

    def test_upload_sync_materials_search_and_exports(self, client, tmp_path, monkeypatch):
        monkeypatch.setattr(config_module.settings, "obsidian_vault_path", str(tmp_path))
        content = TestServerLibraryAPI._epub_bytes()
        response = client.post("/api/books/upload", files={
            "file": ("notes.epub", content, "application/epub+zip"),
        }, data={"title": "阅读测试", "author": "测试作者"})
        assert response.status_code == 202
        book = response.json()["book"]
        assert not any(key.startswith("knowledge") for key in book)
        response = client.post(f"/api/books/{book['id']}/sync", json={
            "operations": [
                {"op_id": "p", "type": "progress.set", "payload": {
                    "cfi": "epubcfi(/6/2)", "progress_percent": 25,
                }},
                {"op_id": "b", "type": "bookmark.upsert", "entity_id": "bookmark", "payload": {
                    "cfi": "epubcfi(/6/2)", "label": "重读", "progress_percent": 25,
                }},
                {"op_id": "h", "type": "highlight.upsert", "entity_id": "highlight", "payload": {
                    "highlight_text": "阅读带来新的理解", "note": "独立思考", "tags": ["阅读"],
                }},
            ],
        })
        assert response.status_code == 200
        state = client.get(f"/api/books/{book['id']}/sync").json()
        assert state["progress"]["progress_percent"] == 25
        assert state["bookmarks"][0]["label"] == "重读"
        materials = client.get("/api/materials", params={"tag": "阅读", "has_note": True}).json()
        assert materials["count"] == 1
        assert materials["materials"][0]["note"] == "独立思考"
        assert client.get("/api/search", params={"q": "独立思考"}).json()["count"] == 1
        exported = client.get("/api/notes/export")
        assert exported.status_code == 200
        assert exported.json()[0]["tags"] == ["阅读"]
        markdown = client.post("/api/obsidian/export", json={"kind": "book", "book_title": book["title"]})
        assert markdown.status_code == 200
        text = Path(markdown.json()["path"]).read_text(encoding="utf-8")
        assert "阅读带来新的理解" in text
        assert "独立思考" in text
        assert "#阅读" in text

    def test_startup_preserves_legacy_tables_indexes_and_files(self, tmp_path):
        import sqlite3

        with sqlite3.connect(db_module.DB_PATH) as db:
            for table in ("qa_books", "qa_chunks", "qa_conversations", "qa_messages", "drafts", "tts_tasks"):
                db.execute(f"CREATE TABLE {table} (id TEXT PRIMARY KEY, content TEXT)")
                db.execute(f"INSERT INTO {table} VALUES ('legacy', 'keep me')")
                db.execute(f"CREATE INDEX idx_legacy_{table} ON {table}(content)")
            db.execute("CREATE VIRTUAL TABLE qa_chunks_fts USING fts5(text)")
            db.execute("INSERT INTO qa_chunks_fts VALUES ('historic index')")
        files = [tmp_path / "knowledge" / "source.epub", tmp_path / "tts" / "audio.mp3", tmp_path / "drafts" / "draft.md"]
        for path in files:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b"historical data")
        with TestClient(app) as client:
            assert client.get("/api/books").json() == {"books": []}
            assert client.get("/health").status_code == 200
            book = client.post("/api/books/upload", files={
                "file": ("legacy.epub", TestServerLibraryAPI._epub_bytes(), "application/epub+zip"),
            }).json()["book"]
            with sqlite3.connect(db_module.DB_PATH) as db:
                db.execute("UPDATE library_books SET knowledge_book_id='legacy' WHERE id=?", (book["id"],))
            operations = {"operations": [{
                "op_id": "legacy-highlight", "type": "highlight.upsert", "entity_id": "legacy-note",
                "payload": {"highlight_text": "legacy highlight", "note": "kept"},
            }]}
            assert client.post(f"/api/books/{book['id']}/sync", json=operations).status_code == 200
            with sqlite3.connect(db_module.DB_PATH) as db:
                assert db.execute("SELECT knowledge_book_id FROM highlights").fetchone() == ("legacy",)
            assert client.delete(f"/api/books/{book['id']}").status_code == 200
        with sqlite3.connect(db_module.DB_PATH) as db:
            for table in ("qa_books", "qa_chunks", "qa_conversations", "qa_messages", "drafts", "tts_tasks"):
                assert db.execute(f"SELECT * FROM {table}").fetchall() == [("legacy", "keep me")]
                assert db.execute("SELECT name FROM sqlite_master WHERE name=?", (f"idx_legacy_{table}",)).fetchone()
            assert db.execute("SELECT text FROM qa_chunks_fts").fetchall() == [("historic index",)]
        assert all(path.read_bytes() == b"historical data" for path in files)
