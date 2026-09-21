import asyncio
import json
import sqlite3

import pytest
from fastapi.testclient import TestClient

import database
from main import app


@pytest.fixture
def notes_db(tmp_path, monkeypatch):
    path = tmp_path / "notes-api.db"
    monkeypatch.setattr(database, "DB_PATH", path)
    asyncio.run(database.init_db())
    return path


@pytest.fixture
def client(notes_db):
    return TestClient(app)


@pytest.fixture
def seeded_notes(notes_db):
    rows = [
        (
            "note-match",
            "client-match",
            "book-a",
            "庄子",
            "庄周",
            "齐物论",
            "epubcfi(/6/2)",
            20,
            "思想自由",
            "思想需要反复体会",
            '["哲学", "重读"]',
            "yellow",
            "reflected",
            "2026-01-03T00:00:00Z",
            "2026-01-03T00:00:00Z",
            "2026-02-03T00:00:00Z",
            None,
        ),
        (
            "note-one-tag",
            "client-one-tag",
            "book-a",
            "庄子",
            "庄周",
            "逍遥游",
            "epubcfi(/6/4)",
            30,
            "思想之旅",
            "只有一个标签",
            '["哲学"]',
            "yellow",
            "reflected",
            "2026-01-02T00:00:00Z",
            "2026-01-02T00:00:00Z",
            "2026-02-02T00:00:00Z",
            None,
        ),
    ]
    connection = sqlite3.connect(notes_db)
    connection.executemany(
        """
        INSERT INTO highlights (
            id, client_id, book_id, book_title, book_author, chapter, cfi,
            progress_percent, highlight_text, note, tags, color, status,
            created_at, received_at, updated_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        rows,
    )
    connection.commit()
    connection.close()
    return rows


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
    assert [item["id"] for item in payload["items"]] == ["note-match"]
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


def test_list_notes_endpoint_preserves_legacy_cfi_range(tmp_path, monkeypatch):
    path = tmp_path / "legacy-notes-api.db"
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
            knowledge_base_id TEXT,
            deleted_at TEXT
        );
        INSERT INTO highlights (
            id, book_id, book_title, cfi_range, highlight_text,
            created_at, received_at, updated_at
        ) VALUES (
            'legacy-note', 'legacy-book', '旧书', 'epubcfi(/6/8)', '旧划线',
            '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z',
            '2026-01-01T00:00:00Z'
        );
        """
    )
    connection.close()
    monkeypatch.setattr(database, "DB_PATH", path)

    response = TestClient(app).get("/api/notes")

    assert response.status_code == 200
    assert response.json()["items"][0]["cfi_range"] == "epubcfi(/6/8)"


@pytest.mark.parametrize("query", ["字", " 字 "])
def test_list_notes_endpoint_rejects_one_character_search(client, query):
    response = client.get("/api/notes", params={"q": query})

    assert response.status_code == 422
    assert response.json()["detail"] == "搜索关键词至少需要 2 个字符"


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


def test_batch_tags_endpoint_returns_uniform_result(client, seeded_notes):
    response = client.post(
        "/api/notes/batch/tags",
        json={
            "operation_id": "api-tags-1",
            "ids": ["note-match", "note-one-tag"],
            "action": "add",
            "tags": [" 新标签 ", "新标签"],
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert set(payload) == {
        "operation_id",
        "affected",
        "unchanged",
        "items",
    }
    assert payload["operation_id"] == "api-tags-1"
    assert payload["affected"] == 2
    assert payload["unchanged"] == 0
    assert [item["id"] for item in payload["items"]] == [
        "note-match",
        "note-one-tag",
    ]
    assert all(item["tags"][-1] == "新标签" for item in payload["items"])


def test_batch_endpoints_support_trash_restore_and_delete(client, seeded_notes):
    trashed = client.post(
        "/api/notes/batch/trash",
        json={"operation_id": "api-trash-1", "ids": ["note-match"]},
    )
    restored = client.post(
        "/api/notes/batch/restore",
        json={"operation_id": "api-restore-1", "ids": ["note-match"]},
    )
    client.post(
        "/api/notes/batch/trash",
        json={"operation_id": "api-trash-2", "ids": ["note-match"]},
    )
    deleted = client.post(
        "/api/notes/batch/delete",
        json={"operation_id": "api-delete-1", "ids": ["note-match"]},
    )

    assert trashed.status_code == 200
    assert trashed.json()["affected"] == 1
    assert restored.status_code == 200
    assert restored.json()["items"][0]["deleted_at"] is None
    assert deleted.status_code == 200
    assert deleted.json()["affected"] == 1
    assert client.get("/api/highlights/note-match").status_code == 404


def test_batch_endpoint_maps_operation_id_collision_to_409(client, seeded_notes):
    first = client.post(
        "/api/notes/batch/trash",
        json={"operation_id": "api-collision-1", "ids": ["note-match"]},
    )
    collision = client.post(
        "/api/notes/batch/trash",
        json={"operation_id": "api-collision-1", "ids": ["note-one-tag"]},
    )

    assert first.status_code == 200
    assert collision.status_code == 409


def test_batch_endpoint_rejects_more_than_100_ids(client):
    response = client.post(
        "/api/notes/batch/trash",
        json={
            "operation_id": "api-too-many-ids",
            "ids": [f"note-{index}" for index in range(101)],
        },
    )

    assert response.status_code == 422


def test_batch_endpoint_refreshes_legacy_json_export(client, seeded_notes, tmp_path, monkeypatch):
    export_path = tmp_path / "notes.json"
    monkeypatch.setattr(database, "NOTES_JSON_PATH", export_path)

    response = client.post(
        "/api/notes/batch/tags",
        json={
            "operation_id": "api-export-1",
            "ids": ["note-match"],
            "action": "add",
            "tags": ["已导出"],
        },
    )

    assert response.status_code == 200
    exported = json.loads(export_path.read_text(encoding="utf-8"))
    matching = [item for item in exported if item["highlight_text"] == "思想自由"]
    assert matching[0]["tags"] == ["哲学", "重读", "已导出"]


def test_batch_delete_endpoint_rejects_active_note_without_deleting_trash(client, seeded_notes):
    client.post(
        "/api/notes/batch/trash",
        json={"operation_id": "api-trash-before-delete", "ids": ["note-match"]},
    )

    response = client.post(
        "/api/notes/batch/delete",
        json={
            "operation_id": "api-delete-conflict",
            "ids": ["note-match", "note-one-tag"],
        },
    )

    assert response.status_code == 409
    assert client.get("/api/highlights/note-match").status_code == 200
