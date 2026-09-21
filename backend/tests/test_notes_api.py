import asyncio
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
