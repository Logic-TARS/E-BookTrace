import asyncio
import json
import sqlite3

import pytest
from fastapi.testclient import TestClient

import database
import library
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
def uploaded_book(notes_db):
    asyncio.run(library.init_library_db())
    book = {"id": "sync-book", "title": "同步测试", "author": "测试者"}
    connection = sqlite3.connect(notes_db)
    connection.execute(
        """
        INSERT INTO library_books (
            id, content_hash, title, author, original_filename,
            storage_filename, file_size, state_revision, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            book["id"],
            "sync-book-hash",
            book["title"],
            book["author"],
            "sync.epub",
            "sync-book.epub",
            1,
            0,
            "2026-09-20T00:00:00+00:00",
            "2026-09-20T00:00:00+00:00",
        ),
    )
    connection.commit()
    connection.close()
    return book


def _sync_highlight(client, book_id, op_id, entity_id, text="同步划线"):
    response = client.post(
        f"/api/books/{book_id}/sync",
        json={
            "operations": [
                {
                    "op_id": op_id,
                    "type": "highlight.upsert",
                    "entity_id": entity_id,
                    "payload": {"highlight_text": text},
                }
            ]
        },
    )
    assert response.status_code == 200
    return next(
        item for item in response.json()["highlights"]
        if item["client_id"] == entity_id
    )


@pytest.fixture
def synced_note(client, uploaded_book):
    return _sync_highlight(
        client,
        uploaded_book["id"],
        "seed-highlight-op",
        "synced-note",
    )


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

    client.post(
        f"/api/books/{book_id}/sync",
        json={
            "protocol_version": 2,
            "operations": [
                {
                    "op_id": "trash-before-delete-op",
                    "type": "highlight.trash",
                    "entity_id": synced_note["client_id"],
                    "payload": {},
                }
            ],
        },
    )
    deleted = client.post(
        f"/api/books/{book_id}/sync",
        json={
            "protocol_version": 2,
            "operations": [
                {
                    "op_id": "delete-trashed-op",
                    "type": "highlight.delete",
                    "entity_id": synced_note["client_id"],
                    "payload": {},
                }
            ],
        },
    )
    assert deleted.status_code == 200
    assert deleted.json()["highlights"] == []


def test_sync_protocol_v2_rejects_permanent_delete_of_active_note_and_rolls_back(
    client, uploaded_book, synced_note
):
    response = client.post(
        f"/api/books/{uploaded_book['id']}/sync",
        json={
            "protocol_version": 2,
            "operations": [
                {
                    "op_id": "progress-before-conflict",
                    "type": "progress.set",
                    "entity_id": "",
                    "payload": {"progress_percent": 75},
                },
                {
                    "op_id": "delete-active-op",
                    "type": "highlight.delete",
                    "entity_id": synced_note["client_id"],
                    "payload": {},
                },
            ],
        },
    )

    assert response.status_code == 409
    state = client.get(f"/api/books/{uploaded_book['id']}/sync").json()
    assert state["revision"] == 1
    assert state["progress"] is None
    assert state["highlights"][0]["deleted_at"] is None


def test_sync_protocol_v2_replay_does_not_increment_revision(
    client, uploaded_book, synced_note
):
    operation = {
        "protocol_version": 2,
        "operations": [
            {
                "op_id": "trash-replay-op",
                "type": "highlight.trash",
                "entity_id": synced_note["client_id"],
                "payload": {},
            }
        ],
    }

    first = client.post(f"/api/books/{uploaded_book['id']}/sync", json=operation)
    repeated = client.post(f"/api/books/{uploaded_book['id']}/sync", json=operation)

    assert first.status_code == 200
    assert repeated.status_code == 200
    assert first.json()["revision"] == 2
    assert repeated.json()["revision"] == 2


def test_sync_protocol_v2_upsert_does_not_restore_trashed_note(
    client, uploaded_book, synced_note
):
    book_id = uploaded_book["id"]
    client.post(
        f"/api/books/{book_id}/sync",
        json={
            "protocol_version": 2,
            "operations": [
                {
                    "op_id": "trash-before-upsert-op",
                    "type": "highlight.trash",
                    "entity_id": synced_note["client_id"],
                    "payload": {},
                }
            ],
        },
    )

    response = client.post(
        f"/api/books/{book_id}/sync",
        json={
            "protocol_version": 2,
            "operations": [
                {
                    "op_id": "upsert-trashed-op",
                    "type": "highlight.upsert",
                    "entity_id": synced_note["client_id"],
                    "payload": {"highlight_text": "更新后的划线"},
                }
            ],
        },
    )

    assert response.status_code == 200
    item = next(
        item for item in response.json()["highlights"]
        if item["client_id"] == synced_note["client_id"]
    )
    assert item["highlight_text"] == "更新后的划线"
    assert item["deleted_at"] is not None


def test_sync_protocol_v2_missing_highlight_operations_are_idempotent_noops(
    client, uploaded_book
):
    response = client.post(
        f"/api/books/{uploaded_book['id']}/sync",
        json={
            "protocol_version": 2,
            "operations": [
                {
                    "op_id": "trash-missing-op",
                    "type": "highlight.trash",
                    "entity_id": "missing-trash",
                    "payload": {},
                },
                {
                    "op_id": "restore-missing-op",
                    "type": "highlight.restore",
                    "entity_id": "missing-restore",
                    "payload": {},
                },
                {
                    "op_id": "delete-missing-op",
                    "type": "highlight.delete",
                    "entity_id": "missing-delete",
                    "payload": {},
                },
            ],
        },
    )

    assert response.status_code == 200
    assert response.json()["revision"] == 3
    assert response.json()["highlights"] == []


def test_sync_protocol_v2_rejects_active_delete_after_trashing_another_note(
    client, uploaded_book
):
    trashed_note = _sync_highlight(
        client, uploaded_book["id"], "seed-trash-candidate-op", "trash-candidate"
    )
    active_note = _sync_highlight(
        client, uploaded_book["id"], "seed-active-candidate-op", "active-candidate"
    )
    client.post(
        f"/api/books/{uploaded_book['id']}/sync",
        json={
            "protocol_version": 2,
            "operations": [
                {
                    "op_id": "trash-candidate-op",
                    "type": "highlight.trash",
                    "entity_id": trashed_note["client_id"],
                    "payload": {},
                }
            ],
        },
    )

    response = client.post(
        f"/api/books/{uploaded_book['id']}/sync",
        json={
            "protocol_version": 2,
            "operations": [
                {
                    "op_id": "delete-trash-candidate-op",
                    "type": "highlight.delete",
                    "entity_id": trashed_note["client_id"],
                    "payload": {},
                },
                {
                    "op_id": "delete-active-candidate-op",
                    "type": "highlight.delete",
                    "entity_id": active_note["client_id"],
                    "payload": {},
                },
            ],
        },
    )

    assert response.status_code == 409
    state = client.get(f"/api/books/{uploaded_book['id']}/sync").json()
    assert state["revision"] == 3
    highlights = {item["client_id"]: item for item in state["highlights"]}
    assert set(highlights) == {
        trashed_note["client_id"],
        active_note["client_id"],
    }
    assert highlights[trashed_note["client_id"]]["deleted_at"] is not None
    assert highlights[active_note["client_id"]]["deleted_at"] is None


def _seed_cross_field_collision(notes_db, book_id, *, id_target_deleted_at=None):
    connection = sqlite3.connect(notes_db)
    connection.executemany(
        """
        INSERT INTO highlights (
            id, client_id, book_id, book_title, highlight_text,
            tags, created_at, received_at, updated_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, '[]', ?, ?, ?, ?)
        """,
        [
            (
                "collision-key",
                "id-target-client",
                book_id,
                "同步测试",
                "ID target",
                "2026-09-20T00:00:00+00:00",
                "2026-09-20T00:00:00+00:00",
                "2026-09-20T00:00:00+00:00",
                id_target_deleted_at,
            ),
            (
                "client-target-id",
                "collision-key",
                book_id,
                "同步测试",
                "Client target",
                "2026-09-20T00:00:00+00:00",
                "2026-09-20T00:00:00+00:00",
                "2026-09-20T00:00:00+00:00",
                None,
            ),
        ],
    )
    connection.commit()
    connection.close()


def test_sync_protocol_v2_trash_prefers_exact_id_on_cross_field_collision(
    client, notes_db, uploaded_book
):
    _seed_cross_field_collision(notes_db, uploaded_book["id"])

    response = client.post(
        f"/api/books/{uploaded_book['id']}/sync",
        json={
            "protocol_version": 2,
            "operations": [
                {
                    "op_id": "trash-cross-field-collision",
                    "type": "highlight.trash",
                    "entity_id": "collision-key",
                    "payload": {},
                }
            ],
        },
    )

    assert response.status_code == 200
    highlights = {item["id"]: item for item in response.json()["highlights"]}
    assert highlights["collision-key"]["deleted_at"] is not None
    assert highlights["client-target-id"]["deleted_at"] is None


def test_sync_protocol_v2_restore_prefers_exact_id_on_cross_field_collision(
    client, notes_db, uploaded_book
):
    _seed_cross_field_collision(
        notes_db,
        uploaded_book["id"],
        id_target_deleted_at="2026-09-20T01:00:00+00:00",
    )

    response = client.post(
        f"/api/books/{uploaded_book['id']}/sync",
        json={
            "protocol_version": 2,
            "operations": [
                {
                    "op_id": "restore-cross-field-collision",
                    "type": "highlight.restore",
                    "entity_id": "collision-key",
                    "payload": {},
                }
            ],
        },
    )

    assert response.status_code == 200
    highlights = {item["id"]: item for item in response.json()["highlights"]}
    assert highlights["collision-key"]["deleted_at"] is None
    assert highlights["client-target-id"]["deleted_at"] is None
    assert highlights["client-target-id"]["updated_at"] == "2026-09-20T00:00:00+00:00"


def test_sync_protocol_v2_delete_only_removes_exact_id_on_cross_field_collision(
    client, notes_db, uploaded_book
):
    _seed_cross_field_collision(
        notes_db,
        uploaded_book["id"],
        id_target_deleted_at="2026-09-20T01:00:00+00:00",
    )

    response = client.post(
        f"/api/books/{uploaded_book['id']}/sync",
        json={
            "protocol_version": 2,
            "operations": [
                {
                    "op_id": "delete-cross-field-collision",
                    "type": "highlight.delete",
                    "entity_id": "collision-key",
                    "payload": {},
                }
            ],
        },
    )

    assert response.status_code == 200
    assert [item["id"] for item in response.json()["highlights"]] == [
        "client-target-id"
    ]
    assert response.json()["highlights"][0]["deleted_at"] is None


def test_sync_protocol_v2_delete_conflicts_for_active_exact_id_without_touching_collision(
    client, notes_db, uploaded_book
):
    _seed_cross_field_collision(notes_db, uploaded_book["id"])

    response = client.post(
        f"/api/books/{uploaded_book['id']}/sync",
        json={
            "protocol_version": 2,
            "operations": [
                {
                    "op_id": "delete-active-cross-field-collision",
                    "type": "highlight.delete",
                    "entity_id": "collision-key",
                    "payload": {},
                }
            ],
        },
    )

    assert response.status_code == 409
    state = client.get(f"/api/books/{uploaded_book['id']}/sync").json()
    assert {item["id"] for item in state["highlights"]} == {
        "collision-key",
        "client-target-id",
    }


def test_legacy_sync_delete_only_removes_exact_id_on_cross_field_collision(
    client, notes_db, uploaded_book
):
    _seed_cross_field_collision(notes_db, uploaded_book["id"])

    response = client.post(
        f"/api/books/{uploaded_book['id']}/sync",
        json={
            "operations": [
                {
                    "op_id": "legacy-delete-cross-field-collision",
                    "type": "highlight.delete",
                    "entity_id": "collision-key",
                    "payload": {},
                }
            ]
        },
    )

    assert response.status_code == 200
    assert [item["id"] for item in response.json()["highlights"]] == [
        "client-target-id"
    ]


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
