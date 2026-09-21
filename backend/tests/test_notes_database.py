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


@pytest.fixture
def notes_db(tmp_path, monkeypatch):
    path = tmp_path / "notes.db"
    monkeypatch.setattr(database, "DB_PATH", path)
    run(database.init_db())

    rows = [
        (
            "note-a-new", "book-a", "庄子", "庄周", "齐物论", "思想自由",
            "思想需要反复体会", '["哲学", "重读"]', "yellow", 20,
            "2026-01-03T00:00:00Z", "2026-02-03T00:00:00Z", None,
        ),
        (
            "note-a-old", "book-a", "庄子", "庄周", "逍遥游", "思想之旅",
            "旧思想仍有启发", '["哲学", "重读", "经典"]', "yellow", 10,
            "2026-01-02T00:00:00Z", "2026-02-02T00:00:00Z", None,
        ),
        (
            "note-b", "book-b", "沉思录", "马可·奥勒留", "卷一", "思想训练",
            "日日反省", '["哲学", "重读", "斯多葛"]', "yellow", 30,
            "2026-01-09T00:00:00Z", "2026-02-01T00:00:00Z", None,
        ),
        (
            "note-blue", "book-a", "庄子", "庄周", "齐物论", "万物并作",
            "", '["哲学"]', "blue", 40,
            "2026-01-04T00:00:00Z", "2026-02-04T00:00:00Z", None,
        ),
        (
            "note-green", "book-b", "沉思录", "马可·奥勒留", "卷一", "向内看",
            "   ", '["修行"]', "green", 50,
            "2026-01-05T00:00:00Z", "2026-02-05T00:00:00Z", None,
        ),
        (
            "note-pink", "book-b", "沉思录", "马可·奥勒留", "卷二", "活在当下",
            "记住此刻", '["修行", "重读"]', "pink", 60,
            "2026-01-06T00:00:00Z", "2026-02-06T00:00:00Z", None,
        ),
        (
            "note-tie-b", "book-b", "沉思录", "马可·奥勒留", "卷二", "排序乙",
            "", '[]', "blue", 70,
            "2026-01-07T00:00:00Z", "2026-02-07T00:00:00Z", None,
        ),
        (
            "note-tie-a", "book-b", "沉思录", "马可·奥勒留", "卷二", "排序甲",
            "", '[]', "blue", 70,
            "2026-01-07T00:00:00Z", "2026-02-07T00:00:00Z", None,
        ),
        (
            "note-trash", "book-a", "庄子", "庄周", "逍遥游", "思想旧稿",
            "待清理", '["哲学"]', "yellow", 80,
            "2026-01-08T00:00:00Z", "2026-02-08T00:00:00Z",
            "2026-03-01T00:00:00Z",
        ),
    ]
    connection = sqlite3.connect(path)
    connection.executemany(
        """
        INSERT INTO highlights (
            id, book_id, book_title, book_author, chapter, highlight_text,
            note, tags, color, progress_percent, created_at, updated_at,
            received_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [row[:12] + (row[11], row[12]) for row in rows],
    )
    connection.commit()
    connection.close()
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
        "经典",
    }


def test_list_notes_facets_use_full_matching_set_not_pagination_page(notes_db):
    result = run(database.list_notes(q="思想", limit=1))

    assert result["total"] == 3
    assert {book["id"] for book in result["facets"]["books"]} == {
        "book-a",
        "book-b",
    }
    assert {tag["name"] for tag in result["facets"]["tags"]} >= {
        "哲学",
        "重读",
        "经典",
        "斯多葛",
    }


def test_list_notes_separates_active_and_trash_views(notes_db):
    active = run(database.list_notes(view="active"))
    trash = run(database.list_notes(view="trash"))

    assert all(item["deleted_at"] is None for item in active["items"])
    assert [item["id"] for item in trash["items"]] == ["note-trash"]


def test_list_notes_search_uses_like_for_two_character_chinese_query(notes_db):
    result = run(database.list_notes(q="思想"))

    assert {item["id"] for item in result["items"]} == {
        "note-a-new",
        "note-a-old",
        "note-b",
    }


def test_list_notes_search_falls_back_when_fts_is_unavailable(notes_db, monkeypatch):
    async def unavailable(_db, *, rebuild=False):
        raise sqlite3.OperationalError("no such tokenizer: trigram")

    monkeypatch.setattr(database, "_ensure_notes_fts", unavailable)

    result = run(database.list_notes(q="思想训练"))

    assert [item["id"] for item in result["items"]] == ["note-b"]


def test_list_notes_search_executes_fts_match_when_available(notes_db, monkeypatch):
    connection = sqlite3.connect(notes_db)
    try:
        connection.execute(
            "CREATE VIRTUAL TABLE temp.trigram_probe "
            "USING fts5(value, tokenize='trigram')"
        )
        connection.execute("INSERT INTO trigram_probe(value) VALUES (?)", ("思想训练",))
        capability_result = connection.execute(
            "SELECT value FROM trigram_probe WHERE trigram_probe MATCH ?",
            ('"思想训练"',),
        ).fetchone()
    except sqlite3.OperationalError as exc:
        pytest.skip(f"FTS5 trigram unavailable: {exc}")
    finally:
        connection.close()
    assert capability_result == ("思想训练",)

    successful_match_queries = []
    original = database.aiosqlite.Connection._execute_fetchall

    def track_successful_match(self, sql, parameters):
        rows = original(self, sql, parameters)
        if " MATCH ?" in sql:
            successful_match_queries.append(sql)
        return rows

    monkeypatch.setattr(
        database.aiosqlite.Connection,
        "_execute_fetchall",
        track_successful_match,
    )

    result = run(database.list_notes(q="思想训练"))

    assert [item["id"] for item in result["items"]] == ["note-b"]
    assert successful_match_queries


def test_list_notes_search_falls_back_when_match_execution_fails(notes_db, monkeypatch):
    async def available(_db, _q):
        return True

    match_attempts = 0
    original = database.aiosqlite.Connection._execute_fetchall

    def fail_match_execution(self, sql, parameters):
        nonlocal match_attempts
        if " MATCH ?" in sql:
            match_attempts += 1
            raise sqlite3.OperationalError("unable to use function MATCH")
        return original(self, sql, parameters)

    monkeypatch.setattr(database, "_notes_fts_available", available)
    monkeypatch.setattr(
        database.aiosqlite.Connection,
        "_execute_fetchall",
        fail_match_execution,
    )

    result = run(database.list_notes(q="思想训练"))

    assert match_attempts == 1
    assert [item["id"] for item in result["items"]] == ["note-b"]


def test_list_notes_filter_multi_tag_uses_and_semantics(notes_db):
    result = run(database.list_notes(tags=["哲学", "重读"]))

    assert {item["id"] for item in result["items"]} == {
        "note-a-new",
        "note-a-old",
        "note-b",
    }


@pytest.mark.parametrize(
    ("note_kind", "expected_ids"),
    [
        ("reflected", {"note-a-new", "note-a-old", "note-b", "note-pink"}),
        (
            "highlight_only",
            {"note-blue", "note-green", "note-tie-a", "note-tie-b"},
        ),
    ],
)
def test_list_notes_filter_note_kind(notes_db, note_kind, expected_ids):
    result = run(database.list_notes(note_kind=note_kind))

    assert {item["id"] for item in result["items"]} == expected_ids


@pytest.mark.parametrize(
    ("sort", "expected_ids"),
    [
        ("updated_desc", ["note-tie-a", "note-tie-b"]),
        ("created_desc", ["note-tie-a", "note-tie-b"]),
        ("position", ["note-tie-a", "note-tie-b"]),
        ("book", ["note-tie-a", "note-tie-b"]),
    ],
)
def test_list_notes_sort_has_stable_id_secondary_key(notes_db, sort, expected_ids):
    result = run(database.list_notes(q="排序", sort=sort))

    assert [item["id"] for item in result["items"]] == expected_ids


@pytest.mark.parametrize(
    ("sort", "expected_ids"),
    [
        ("updated_desc", ["note-blue", "note-a-new", "note-a-old", "note-b"]),
        ("created_desc", ["note-b", "note-blue", "note-a-new", "note-a-old"]),
        ("position", ["note-a-old", "note-a-new", "note-b", "note-blue"]),
        ("book", ["note-a-new", "note-a-old", "note-blue", "note-b"]),
    ],
)
def test_list_notes_sort_orders_distinct_values(notes_db, sort, expected_ids):
    result = run(database.list_notes(tags=["哲学"], sort=sort))

    assert [item["id"] for item in result["items"]] == expected_ids


def test_list_notes_sort_uses_whitelist_for_unknown_value(notes_db):
    result = run(database.list_notes(q="排序", sort="updated_at; DROP TABLE highlights"))

    assert [item["id"] for item in result["items"]] == ["note-tie-a", "note-tie-b"]
    assert run(database.list_notes())["total"] == 8


def test_list_notes_pagination_reports_matching_total(notes_db):
    first = run(database.list_notes(limit=3, offset=0))
    last = run(database.list_notes(limit=3, offset=6))

    assert len(first["items"]) == 3
    assert first["total"] == 8
    assert first["has_more"] is True
    assert len(last["items"]) == 2
    assert last["total"] == 8
    assert last["has_more"] is False


def test_list_notes_for_export_filters_and_sorts_all_active_matches(notes_db):
    result = run(database.list_notes_for_export(tags=["哲学"]))

    assert [item["id"] for item in result] == [
        "note-a-old",
        "note-a-new",
        "note-blue",
        "note-b",
    ]
    assert all(item["deleted_at"] is None for item in result)


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
    assert first["operation_id"] == "tags-1"
    assert first["affected"] == 2
    assert first["unchanged"] == 0
    assert [item["id"] for item in first["items"]] == [
        "note-a-new",
        "note-a-old",
    ]
    assert all(item["tags"].count("新标签") == 1 for item in first["items"])


def test_batch_tags_remove_counts_unchanged_notes(notes_db):
    result = run(
        database.batch_update_note_tags(
            operation_id="tags-remove-1",
            ids=["note-a-new", "note-blue"],
            action="remove",
            tags=["重读"],
        )
    )

    assert result["affected"] == 1
    assert result["unchanged"] == 1
    assert [item["id"] for item in result["items"]] == ["note-a-new"]
    assert result["items"][0]["tags"] == ["哲学"]


def test_batch_tags_rejects_missing_or_trashed_note_without_partial_update(notes_db):
    with pytest.raises(database.NoteBatchConflict):
        run(
            database.batch_update_note_tags(
                operation_id="tags-invalid-1",
                ids=["note-a-new", "note-trash", "missing"],
                action="add",
                tags=["不应保存"],
            )
        )

    assert "不应保存" not in run(database.get_highlight("note-a-new"))["tags"]
    retry = run(
        database.batch_update_note_tags(
            operation_id="tags-invalid-1",
            ids=["note-a-new"],
            action="add",
            tags=["有效重试"],
        )
    )
    assert retry["affected"] == 1


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


def test_batch_operation_id_collision_rejects_different_operation_type(notes_db):
    run(database.batch_trash_notes(operation_id="shared-1", ids=["note-a-new"]))

    with pytest.raises(database.NoteBatchConflict):
        run(database.batch_restore_notes(operation_id="shared-1", ids=["note-a-new"]))


def test_batch_replay_returns_first_result_without_reapplying(notes_db):
    first = run(
        database.batch_update_note_tags(
            operation_id="tags-replay-1",
            ids=["note-a-new"],
            action="add",
            tags=["首次"],
        )
    )
    run(
        database.batch_update_note_tags(
            operation_id="tags-later-1",
            ids=["note-a-new"],
            action="remove",
            tags=["首次"],
        )
    )

    replay = run(
        database.batch_update_note_tags(
            operation_id="tags-replay-1",
            ids=["note-a-new"],
            action="add",
            tags=["首次"],
        )
    )

    assert replay == first
    assert "首次" not in run(database.get_highlight("note-a-new"))["tags"]


def test_batch_trash_and_restore_follow_state_rules(notes_db):
    trashed = run(
        database.batch_trash_notes(
            operation_id="trash-state-1",
            ids=["note-a-new", "note-trash", "missing"],
        )
    )

    assert trashed["affected"] == 1
    assert trashed["unchanged"] == 2
    assert [item["id"] for item in trashed["items"]] == ["note-a-new"]
    assert trashed["items"][0]["deleted_at"] is not None

    restored = run(
        database.batch_restore_notes(
            operation_id="restore-state-1",
            ids=["note-a-new", "note-a-old", "missing"],
        )
    )

    assert restored["affected"] == 1
    assert restored["unchanged"] == 2
    assert [item["id"] for item in restored["items"]] == ["note-a-new"]
    assert restored["items"][0]["deleted_at"] is None


def test_batch_trash_uses_one_utc_timestamp(notes_db):
    result = run(
        database.batch_trash_notes(
            operation_id="trash-time-1",
            ids=["note-a-new", "note-a-old"],
        )
    )

    deleted_at_values = {item["deleted_at"] for item in result["items"]}
    assert len(deleted_at_values) == 1
    assert next(iter(deleted_at_values)).endswith("+00:00")


def test_batch_delete_rejects_active_note_without_partial_delete(notes_db):
    with pytest.raises(database.NoteBatchConflict):
        run(
            database.batch_delete_notes(
                operation_id="delete-1",
                ids=["note-trash", "note-a-new"],
            )
        )

    assert run(database.get_highlight("note-a-new")) is not None
    assert run(database.get_highlight("note-trash")) is not None


def test_batch_delete_removes_trashed_notes_and_counts_missing_unchanged(notes_db):
    result = run(
        database.batch_delete_notes(
            operation_id="delete-trash-1",
            ids=["note-trash", "missing"],
        )
    )

    assert result == {
        "operation_id": "delete-trash-1",
        "affected": 1,
        "unchanged": 1,
        "items": [
            {
                "id": "note-trash",
                "client_id": "",
                "book_id": "book-a",
                "tags": ["哲学"],
                "deleted_at": "2026-03-01T00:00:00Z",
            }
        ],
    }
    assert run(database.get_highlight("note-trash")) is None


def test_batch_mutation_and_idempotency_result_share_one_transaction(notes_db):
    connection = sqlite3.connect(notes_db)
    connection.execute(
        """
        CREATE TRIGGER fail_batch_result
        BEFORE INSERT ON note_batch_operations
        BEGIN
            SELECT RAISE(ABORT, 'forced result failure');
        END
        """
    )
    connection.commit()
    connection.close()

    with pytest.raises(sqlite3.IntegrityError, match="forced result failure"):
        run(
            database.batch_update_note_tags(
                operation_id="tags-rollback-1",
                ids=["note-a-new"],
                action="add",
                tags=["必须回滚"],
            )
        )

    assert "必须回滚" not in run(database.get_highlight("note-a-new"))["tags"]
