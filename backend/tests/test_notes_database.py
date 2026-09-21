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


def test_init_db_migration_upgrades_legacy_notes_without_data_loss(legacy_notes_db):
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
