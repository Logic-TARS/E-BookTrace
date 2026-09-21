"""SQLite storage layer for Marginalia highlights."""

from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sqlite3
from typing import Any, Optional
import uuid

import aiosqlite

from config import settings
from notes import normalize_note_tags

# Ensure data directory exists
DB_PATH = Path(__file__).parent / "data" / "marginalia.db"
DB_PATH.parent.mkdir(parents=True, exist_ok=True)
LEGACY_EXTERNAL_SYNC_COLUMN = "synced_to_" + "fei" + "shu"


async def init_db() -> None:
    """Create tables if they don't exist."""
    async with aiosqlite.connect(str(DB_PATH)) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS highlights (
                id TEXT PRIMARY KEY,
                book_id TEXT,
                client_id TEXT DEFAULT '',
                book_title TEXT NOT NULL,
                book_author TEXT DEFAULT '',
                chapter TEXT DEFAULT '',
                cfi TEXT DEFAULT '',
                highlight_text TEXT NOT NULL,
                note TEXT DEFAULT '',
                tags TEXT DEFAULT '[]',
                color TEXT DEFAULT 'yellow',
                created_at TEXT,
                progress_percent REAL DEFAULT 0.0,
                received_at TEXT,
                updated_at TEXT,
                status TEXT DEFAULT 'raw',
                knowledge_book_id TEXT
            )
        """)
        await _ensure_column(db, "book_id", "TEXT")
        await _ensure_column(db, "client_id", "TEXT DEFAULT ''")
        await _ensure_column(db, "updated_at", "TEXT")
        await _ensure_column(db, "status", "TEXT DEFAULT 'raw'")
        await _ensure_column(db, "knowledge_book_id", "TEXT")
        await _ensure_column(db, "deleted_at", "TEXT")
        await db.execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS idx_highlights_client_id
            ON highlights(client_id)
            WHERE client_id IS NOT NULL AND client_id != ''
            """
        )
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_highlights_book_id ON highlights(book_id)"
        )
        await db.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_highlights_view_updated
            ON highlights(deleted_at, updated_at DESC)
            """
        )
        await db.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_highlights_view_book
            ON highlights(deleted_at, book_id)
            """
        )
        await db.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_highlights_view_position
            ON highlights(deleted_at, book_title, progress_percent)
            """
        )
        await _ensure_notes_fts(db, rebuild=True)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS drafts (
                id TEXT PRIMARY KEY,
                target TEXT NOT NULL,
                title TEXT NOT NULL,
                content TEXT NOT NULL,
                metadata TEXT DEFAULT '{}',
                source_highlight_ids TEXT DEFAULT '[]',
                created_at TEXT,
                updated_at TEXT,
                exported_to_obsidian INTEGER DEFAULT 0
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS note_batch_operations (
                operation_id TEXT PRIMARY KEY,
                operation_type TEXT NOT NULL,
                request_hash TEXT NOT NULL,
                result_json TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
        """)
        await db.commit()


async def _ensure_column(db: aiosqlite.Connection, name: str, definition: str) -> None:
    rows = await db.execute_fetchall("PRAGMA table_info(highlights)")
    columns = {row[1] for row in rows}
    if name not in columns:
        await db.execute(f"ALTER TABLE highlights ADD COLUMN {name} {definition}")


async def _ensure_notes_fts(
    db: aiosqlite.Connection, *, rebuild: bool = False
) -> bool:
    try:
        await db.execute(
            """
            CREATE VIRTUAL TABLE IF NOT EXISTS highlights_notes_fts
            USING fts5(
                book_title, book_author, chapter, highlight_text, note, tags,
                content='highlights', content_rowid='rowid', tokenize='trigram'
            )
            """
        )
        await db.executescript(
            """
            CREATE TRIGGER IF NOT EXISTS highlights_notes_fts_insert
            AFTER INSERT ON highlights BEGIN
                INSERT INTO highlights_notes_fts(
                    rowid, book_title, book_author, chapter,
                    highlight_text, note, tags
                ) VALUES (
                    new.rowid, new.book_title, new.book_author, new.chapter,
                    new.highlight_text, new.note, new.tags
                );
            END;
            CREATE TRIGGER IF NOT EXISTS highlights_notes_fts_delete
            AFTER DELETE ON highlights BEGIN
                INSERT INTO highlights_notes_fts(
                    highlights_notes_fts, rowid, book_title, book_author,
                    chapter, highlight_text, note, tags
                ) VALUES (
                    'delete', old.rowid, old.book_title, old.book_author,
                    old.chapter, old.highlight_text, old.note, old.tags
                );
            END;
            CREATE TRIGGER IF NOT EXISTS highlights_notes_fts_update
            AFTER UPDATE ON highlights BEGIN
                INSERT INTO highlights_notes_fts(
                    highlights_notes_fts, rowid, book_title, book_author,
                    chapter, highlight_text, note, tags
                ) VALUES (
                    'delete', old.rowid, old.book_title, old.book_author,
                    old.chapter, old.highlight_text, old.note, old.tags
                );
                INSERT INTO highlights_notes_fts(
                    rowid, book_title, book_author, chapter,
                    highlight_text, note, tags
                ) VALUES (
                    new.rowid, new.book_title, new.book_author, new.chapter,
                    new.highlight_text, new.note, new.tags
                );
            END;
            """
        )
        if rebuild:
            await db.execute(
                "INSERT INTO highlights_notes_fts(highlights_notes_fts) VALUES ('rebuild')"
            )
        return True
    except (sqlite3.OperationalError, aiosqlite.OperationalError):
        return False


async def save_highlights(highlights: list[dict]) -> list[str]:
    """Upsert highlights into the database. Returns list of server IDs."""
    items = await upsert_highlights(highlights)
    return [item["id"] for item in items]


async def upsert_highlights(highlights: list[dict]) -> list[dict]:
    """Insert or update highlights. Returns server/client ID mappings."""
    import uuid
    from datetime import datetime, timezone

    items = []
    now = datetime.now(timezone.utc).isoformat()

    async with aiosqlite.connect(str(DB_PATH)) as db:
        for h in highlights:
            client_id = h.get("client_id") or h.get("id") or ""
            existing_id = await _find_existing_highlight_id(db, h, client_id)
            tags_json = json.dumps(h.get("tags", []), ensure_ascii=False)

            if existing_id:
                await db.execute(
                    """
                    UPDATE highlights
                    SET client_id = COALESCE(NULLIF(?, ''), client_id),
                        book_title = ?, book_author = ?, chapter = ?, cfi = ?,
                        highlight_text = ?, note = ?, tags = ?, color = ?,
                        created_at = ?, progress_percent = ?, updated_at = ?,
                        status = ?, knowledge_book_id = COALESCE(?, knowledge_book_id)
                    WHERE id = ?
                    """,
                    (
                        client_id,
                        h.get("book_title", ""),
                        h.get("book_author", ""),
                        h.get("chapter", ""),
                        h.get("cfi", ""),
                        h.get("highlight_text", ""),
                        h.get("note", ""),
                        tags_json,
                        h.get("color", "yellow"),
                        _jsonable_datetime(h.get("created_at", now)),
                        h.get("progress_percent", 0.0),
                        now,
                        _highlight_status(h),
                        h.get("knowledge_book_id"),
                        existing_id,
                    ),
                )
                items.append({"id": existing_id, "client_id": client_id, "action": "updated"})
            else:
                hid = str(uuid.uuid4())
                await db.execute(
                    """
                    INSERT INTO highlights
                        (id, client_id, book_title, book_author, chapter, cfi,
                         highlight_text, note, tags, color,
                         created_at, progress_percent, received_at, updated_at,
                         status, knowledge_book_id)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        hid,
                        client_id,
                        h.get("book_title", ""),
                        h.get("book_author", ""),
                        h.get("chapter", ""),
                        h.get("cfi", ""),
                        h.get("highlight_text", ""),
                        h.get("note", ""),
                        tags_json,
                        h.get("color", "yellow"),
                        _jsonable_datetime(h.get("created_at", now)),
                        h.get("progress_percent", 0.0),
                        now,
                        now,
                        _highlight_status(h),
                        h.get("knowledge_book_id"),
                    ),
                )
                items.append({"id": hid, "client_id": client_id, "action": "created"})
        await db.commit()

    return items


async def _find_existing_highlight_id(
    db: aiosqlite.Connection, h: dict, client_id: str
) -> str | None:
    if client_id:
        cursor = await db.execute(
            "SELECT id FROM highlights WHERE client_id = ? OR id = ?",
            (client_id, client_id),
        )
        row = await cursor.fetchone()
        if row:
            return row[0]

        cursor = await db.execute(
            """
            SELECT id FROM highlights
            WHERE (client_id IS NULL OR client_id = '')
              AND book_title = ?
              AND cfi = ?
              AND created_at = ?
              AND highlight_text = ?
            """,
            (
                h.get("book_title", ""),
                h.get("cfi", ""),
                _jsonable_datetime(h.get("created_at", "")),
                h.get("highlight_text", ""),
            ),
        )
        row = await cursor.fetchone()
        if row:
            return row[0]
    return None


def _build_notes_where(
    *,
    q: str | None,
    book_id: str | None,
    tags: list[str],
    note_kind: str,
    color: str | None,
    view: str,
    ignore_book_filter: bool = False,
    ignore_tag_filter: bool = False,
    use_fts: bool = False,
) -> tuple[str, list[Any]]:
    clauses = [
        "highlights.deleted_at IS NOT NULL"
        if view == "trash"
        else "highlights.deleted_at IS NULL"
    ]
    params: list[Any] = []

    if q:
        if use_fts:
            clauses.append(
                "EXISTS (SELECT 1 FROM highlights_notes_fts "
                "WHERE highlights_notes_fts.rowid = highlights.rowid "
                "AND highlights_notes_fts MATCH ?)"
            )
            params.append(f'"{q.replace(chr(34), chr(34) * 2)}"')
        else:
            pattern = f"%{q}%"
            clauses.append(
                "(highlights.book_title LIKE ? OR highlights.book_author LIKE ? "
                "OR highlights.chapter LIKE ? OR highlights.highlight_text LIKE ? "
                "OR highlights.note LIKE ? OR highlights.tags LIKE ?)"
            )
            params.extend([pattern] * 6)

    if book_id and not ignore_book_filter:
        clauses.append("highlights.book_id = ?")
        params.append(book_id)

    for tag in ([] if ignore_tag_filter else tags):
        clauses.append(
            "EXISTS (SELECT 1 FROM json_each(highlights.tags) "
            "WHERE json_each.value = ?)"
        )
        params.append(tag)

    if note_kind == "reflected":
        clauses.append("TRIM(COALESCE(highlights.note, '')) <> ''")
    elif note_kind == "highlight_only":
        clauses.append("TRIM(COALESCE(highlights.note, '')) = ''")

    if color:
        clauses.append("highlights.color = ?")
        params.append(color)

    return " AND ".join(clauses), params


_NOTES_SORTS = {
    "updated_desc": "highlights.updated_at DESC, highlights.id ASC",
    "created_desc": "highlights.created_at DESC, highlights.id ASC",
    "position": "highlights.progress_percent ASC, highlights.id ASC",
    "book": "highlights.book_title COLLATE NOCASE ASC, highlights.id ASC",
}


async def _notes_fts_available(db: aiosqlite.Connection, q: str | None) -> bool:
    if not q or len(q) < 3:
        return False
    try:
        return await _ensure_notes_fts(db)
    except (sqlite3.OperationalError, aiosqlite.OperationalError):
        return False


async def _notes_rows(
    db: aiosqlite.Connection,
    *,
    q: str | None,
    book_id: str | None,
    tags: list[str],
    note_kind: str,
    color: str | None,
    view: str,
    order_by: str,
    limit: int | None = None,
    offset: int = 0,
) -> list[aiosqlite.Row]:
    use_fts = await _notes_fts_available(db, q)
    where, params = _build_notes_where(
        q=q,
        book_id=book_id,
        tags=tags,
        note_kind=note_kind,
        color=color,
        view=view,
        use_fts=use_fts,
    )
    query = f"SELECT highlights.* FROM highlights WHERE {where} ORDER BY {order_by}"
    if limit is not None:
        query += " LIMIT ? OFFSET ?"
        params.extend([limit, offset])
    try:
        return await db.execute_fetchall(query, params)
    except (sqlite3.OperationalError, aiosqlite.OperationalError):
        if not use_fts:
            raise
        where, params = _build_notes_where(
            q=q,
            book_id=book_id,
            tags=tags,
            note_kind=note_kind,
            color=color,
            view=view,
        )
        query = f"SELECT highlights.* FROM highlights WHERE {where} ORDER BY {order_by}"
        if limit is not None:
            query += " LIMIT ? OFFSET ?"
            params.extend([limit, offset])
        return await db.execute_fetchall(query, params)


async def list_notes(
    *,
    q: str | None = None,
    book_id: str | None = None,
    tags: list[str] | None = None,
    note_kind: str = "all",
    color: str | None = None,
    view: str = "active",
    sort: str = "updated_desc",
    limit: int = 50,
    offset: int = 0,
) -> dict[str, Any]:
    normalized_tags = tags or []
    normalized_limit = max(0, limit)
    normalized_offset = max(0, offset)
    order_by = _NOTES_SORTS.get(sort, _NOTES_SORTS["updated_desc"])

    async with aiosqlite.connect(str(DB_PATH)) as db:
        db.row_factory = aiosqlite.Row
        use_fts = await _notes_fts_available(db, q)
        where, params = _build_notes_where(
            q=q,
            book_id=book_id,
            tags=normalized_tags,
            note_kind=note_kind,
            color=color,
            view=view,
            use_fts=use_fts,
        )
        try:
            total_row = await db.execute_fetchall(
                f"SELECT COUNT(*) FROM highlights WHERE {where}", params
            )
        except (sqlite3.OperationalError, aiosqlite.OperationalError):
            use_fts = False
            where, params = _build_notes_where(
                q=q,
                book_id=book_id,
                tags=normalized_tags,
                note_kind=note_kind,
                color=color,
                view=view,
            )
            total_row = await db.execute_fetchall(
                f"SELECT COUNT(*) FROM highlights WHERE {where}", params
            )
        total = total_row[0][0]
        rows = await db.execute_fetchall(
            f"SELECT highlights.* FROM highlights WHERE {where} "
            f"ORDER BY {order_by} LIMIT ? OFFSET ?",
            [*params, normalized_limit, normalized_offset],
        )
        facets = await _notes_facets(
            db,
            q=q,
            book_id=book_id,
            tags=normalized_tags,
            note_kind=note_kind,
            color=color,
            view=view,
            use_fts=use_fts,
        )

    return {
        "items": [_row_to_dict(row) for row in rows],
        "total": total,
        "limit": normalized_limit,
        "offset": normalized_offset,
        "has_more": normalized_offset + len(rows) < total,
        "facets": facets,
    }


async def _notes_facets(
    db: aiosqlite.Connection,
    *,
    q: str | None,
    book_id: str | None,
    tags: list[str],
    note_kind: str,
    color: str | None,
    view: str,
    use_fts: bool,
) -> dict[str, list[dict[str, Any]]]:
    book_where, book_params = _build_notes_where(
        q=q,
        book_id=book_id,
        tags=tags,
        note_kind=note_kind,
        color=color,
        view=view,
        ignore_book_filter=True,
        use_fts=use_fts,
    )
    books = await db.execute_fetchall(
        f"""
        SELECT highlights.book_id AS id, highlights.book_title AS title,
               highlights.book_author AS author, COUNT(*) AS count
        FROM highlights
        WHERE {book_where}
        GROUP BY highlights.book_id, highlights.book_title, highlights.book_author
        ORDER BY highlights.book_title COLLATE NOCASE ASC, highlights.book_id ASC
        """,
        book_params,
    )

    tag_where, tag_params = _build_notes_where(
        q=q,
        book_id=book_id,
        tags=tags,
        note_kind=note_kind,
        color=color,
        view=view,
        ignore_tag_filter=True,
        use_fts=use_fts,
    )
    tag_rows = await db.execute_fetchall(
        f"""
        SELECT json_each.value AS name, COUNT(*) AS count
        FROM highlights, json_each(highlights.tags)
        WHERE {tag_where}
        GROUP BY json_each.value
        ORDER BY count DESC, name COLLATE NOCASE ASC
        """,
        tag_params,
    )
    return {
        "books": [dict(row) for row in books],
        "tags": [dict(row) for row in tag_rows],
    }


async def list_notes_for_export(
    *,
    q: str | None = None,
    book_id: str | None = None,
    tags: list[str] | None = None,
    note_kind: str = "all",
    color: str | None = None,
) -> list[dict[str, Any]]:
    async with aiosqlite.connect(str(DB_PATH)) as db:
        db.row_factory = aiosqlite.Row
        rows = await _notes_rows(
            db,
            q=q,
            book_id=book_id,
            tags=tags or [],
            note_kind=note_kind,
            color=color,
            view="active",
            order_by=(
                "highlights.book_title COLLATE NOCASE ASC, "
                "highlights.progress_percent ASC, highlights.created_at ASC, "
                "highlights.id ASC"
            ),
        )
        return [_row_to_dict(row) for row in rows]


async def get_all_highlights(
    book_title: Optional[str] = None, limit: int = 100, offset: int = 0
) -> list[dict]:
    """Fetch active highlights, optionally filtered by book title."""
    async with aiosqlite.connect(str(DB_PATH)) as db:
        db.row_factory = aiosqlite.Row
        if book_title:
            rows = await db.execute_fetchall(
                "SELECT * FROM highlights WHERE deleted_at IS NULL "
                "AND book_title LIKE ? ORDER BY received_at DESC LIMIT ? OFFSET ?",
                (f"%{book_title}%", limit, offset),
            )
        else:
            rows = await db.execute_fetchall(
                "SELECT * FROM highlights WHERE deleted_at IS NULL "
                "ORDER BY received_at DESC LIMIT ? OFFSET ?",
                (limit, offset),
            )
        return [_row_to_dict(r) for r in rows]


async def get_materials(
    book_title: Optional[str] = None,
    tag: Optional[str] = None,
    status: Optional[str] = None,
    has_note: Optional[bool] = None,
    limit: int = 200,
    offset: int = 0,
) -> list[dict]:
    """Fetch active highlight materials for the creation workspace."""
    async with aiosqlite.connect(str(DB_PATH)) as db:
        db.row_factory = aiosqlite.Row
        conditions = ["deleted_at IS NULL"]
        params = []
        if book_title:
            conditions.append("book_title LIKE ?")
            params.append(f"%{book_title}%")
        if status:
            conditions.append("status = ?")
            params.append(status)
        if has_note is True:
            conditions.append("note IS NOT NULL AND note != ''")
        elif has_note is False:
            conditions.append("(note IS NULL OR note = '')")

        where = " WHERE " + " AND ".join(conditions) if conditions else ""
        query = f"SELECT * FROM highlights{where} ORDER BY received_at DESC LIMIT ? OFFSET ?"
        params.extend([limit, offset])

        rows = await db.execute_fetchall(query, params)
        results = [_row_to_dict(r) for r in rows]

        # tag filter requires Python-side check (JSON array), but dataset is now much smaller
        if tag:
            results = [h for h in results if tag in h.get("tags", [])]

        return results


async def get_highlights_by_ids(ids: list[str]) -> list[dict]:
    """Fetch specific active highlights by their IDs."""
    if not ids:
        return []

    placeholders = ",".join("?" for _ in ids)
    async with aiosqlite.connect(str(DB_PATH)) as db:
        db.row_factory = aiosqlite.Row
        rows = await db.execute_fetchall(
            f"SELECT * FROM highlights WHERE deleted_at IS NULL AND "
            f"(id IN ({placeholders}) OR client_id IN ({placeholders}))",
            [*ids, *ids],
        )
        return [_row_to_dict(r) for r in rows]


async def get_highlight(identifier: str) -> dict | None:
    """Fetch one highlight by server ID or client ID."""
    async with aiosqlite.connect(str(DB_PATH)) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT * FROM highlights WHERE id = ? OR client_id = ?",
            (identifier, identifier),
        )
        row = await cursor.fetchone()
        return _row_to_dict(row) if row else None


async def update_highlight(identifier: str, data: dict) -> dict | None:
    """Update editable fields and return the updated highlight."""
    from datetime import datetime, timezone

    allowed = {
        "book_title", "book_author", "chapter", "cfi", "highlight_text",
        "note", "tags", "color", "progress_percent", "status",
        "knowledge_book_id",
    }
    values = {k: v for k, v in data.items() if k in allowed and v is not None}
    if not values:
        return await get_highlight(identifier)

    if "tags" in values:
        values["tags"] = json.dumps(values["tags"], ensure_ascii=False)
    if "note" in values and "status" not in values:
        values["status"] = "reflected" if str(values["note"]).strip() else "raw"
    values["updated_at"] = datetime.now(timezone.utc).isoformat()

    assignments = ", ".join(f"{key} = ?" for key in values)
    params = [*values.values(), identifier, identifier]

    async with aiosqlite.connect(str(DB_PATH)) as db:
        await db.execute(
            f"UPDATE highlights SET {assignments} WHERE id = ? OR client_id = ?",
            params,
        )
        await db.commit()

    return await get_highlight(identifier)


async def delete_highlight(identifier: str, legacy_match: Optional[dict] = None) -> bool:
    """Delete a highlight by ID/client ID, with an optional legacy exact match."""
    async with aiosqlite.connect(str(DB_PATH)) as db:
        cursor = await db.execute(
            "DELETE FROM highlights WHERE id = ? OR client_id = ?",
            (identifier, identifier),
        )
        deleted = cursor.rowcount

        if deleted == 0 and legacy_match:
            cursor = await db.execute(
                """
                DELETE FROM highlights
                WHERE (client_id IS NULL OR client_id = '')
                  AND book_title = ?
                  AND cfi = ?
                  AND created_at = ?
                  AND highlight_text = ?
                """,
                (
                    legacy_match.get("book_title", ""),
                    legacy_match.get("cfi", ""),
                    _jsonable_datetime(legacy_match.get("created_at", "")),
                    legacy_match.get("highlight_text", ""),
                ),
            )
            deleted = cursor.rowcount

        await db.commit()
        return deleted > 0


class NoteBatchConflict(Exception):
    pass


def _normalize_note_ids(ids: list[str]) -> list[str]:
    return list(dict.fromkeys(value.strip() for value in ids if value.strip()))


def _batch_request_hash(operation_type: str, request: dict[str, Any]) -> str:
    canonical = json.dumps(
        {"operation_type": operation_type, **request},
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


async def _existing_batch_result(
    db: aiosqlite.Connection,
    *,
    operation_id: str,
    operation_type: str,
    request_hash: str,
) -> dict[str, Any] | None:
    row = await db.execute_fetchall(
        "SELECT operation_type, request_hash, result_json "
        "FROM note_batch_operations WHERE operation_id = ?",
        (operation_id,),
    )
    if not row:
        return None
    if row[0][0] != operation_type or row[0][1] != request_hash:
        raise NoteBatchConflict("operation_id already belongs to a different request")
    return json.loads(row[0][2])


async def _save_batch_result(
    db: aiosqlite.Connection,
    *,
    operation_id: str,
    operation_type: str,
    request_hash: str,
    result: dict[str, Any],
) -> None:
    await db.execute(
        """
        INSERT INTO note_batch_operations (
            operation_id, operation_type, request_hash, result_json, created_at
        ) VALUES (?, ?, ?, ?, ?)
        """,
        (
            operation_id,
            operation_type,
            request_hash,
            json.dumps(result, ensure_ascii=False),
            datetime.now(timezone.utc).isoformat(),
        ),
    )


def _batch_item(row: aiosqlite.Row, *, tags: list[str] | None = None) -> dict[str, Any]:
    return {
        "id": row["id"],
        "client_id": row["client_id"] or "",
        "book_id": row["book_id"],
        "tags": _row_json_list(row["tags"]) if tags is None else tags,
        "deleted_at": row["deleted_at"],
    }


async def _load_batch_rows(
    db: aiosqlite.Connection, ids: list[str]
) -> dict[str, aiosqlite.Row]:
    if not ids:
        return {}
    placeholders = ",".join("?" for _ in ids)
    rows = await db.execute_fetchall(
        f"SELECT * FROM highlights WHERE id IN ({placeholders})",
        ids,
    )
    return {row["id"]: row for row in rows}


async def batch_update_note_tags(
    *, operation_id: str, ids: list[str], action: str, tags: list[str]
) -> dict[str, Any]:
    normalized_ids = _normalize_note_ids(ids)
    normalized_tags = normalize_note_tags(tags)
    request = {
        "ids": normalized_ids,
        "action": action,
        "tags": normalized_tags,
    }
    operation_type = "tags"
    request_hash = _batch_request_hash(operation_type, request)

    async with aiosqlite.connect(str(DB_PATH)) as db:
        db.row_factory = aiosqlite.Row
        await db.execute("BEGIN IMMEDIATE")
        try:
            replay = await _existing_batch_result(
                db,
                operation_id=operation_id,
                operation_type=operation_type,
                request_hash=request_hash,
            )
            if replay is not None:
                await db.commit()
                return replay

            rows = await _load_batch_rows(db, normalized_ids)
            invalid_ids = [
                note_id
                for note_id in normalized_ids
                if note_id not in rows or rows[note_id]["deleted_at"] is not None
            ]
            if invalid_ids:
                raise NoteBatchConflict(
                    "tags require active notes: " + ", ".join(invalid_ids)
                )

            items = []
            unchanged = 0
            now = datetime.now(timezone.utc).isoformat()
            for note_id in normalized_ids:
                row = rows[note_id]
                existing_tags = normalize_note_tags(_row_json_list(row["tags"]))
                if action == "add":
                    updated_tags = normalize_note_tags([*existing_tags, *normalized_tags])
                elif action == "remove":
                    removed = set(normalized_tags)
                    updated_tags = [tag for tag in existing_tags if tag not in removed]
                else:
                    raise NoteBatchConflict("unsupported tag action")

                if updated_tags == existing_tags:
                    unchanged += 1
                    continue
                await db.execute(
                    "UPDATE highlights SET tags = ?, updated_at = ? WHERE id = ?",
                    (json.dumps(updated_tags, ensure_ascii=False), now, note_id),
                )
                items.append(_batch_item(row, tags=updated_tags))

            result = {
                "operation_id": operation_id,
                "affected": len(items),
                "unchanged": unchanged,
                "items": items,
            }
            await _save_batch_result(
                db,
                operation_id=operation_id,
                operation_type=operation_type,
                request_hash=request_hash,
                result=result,
            )
            await db.commit()
            return result
        except BaseException:
            await db.rollback()
            raise


async def _batch_set_deleted_at(
    *, operation_id: str, ids: list[str], restore: bool
) -> dict[str, Any]:
    normalized_ids = _normalize_note_ids(ids)
    operation_type = "restore" if restore else "trash"
    request_hash = _batch_request_hash(operation_type, {"ids": normalized_ids})

    async with aiosqlite.connect(str(DB_PATH)) as db:
        db.row_factory = aiosqlite.Row
        await db.execute("BEGIN IMMEDIATE")
        try:
            replay = await _existing_batch_result(
                db,
                operation_id=operation_id,
                operation_type=operation_type,
                request_hash=request_hash,
            )
            if replay is not None:
                await db.commit()
                return replay

            rows = await _load_batch_rows(db, normalized_ids)
            timestamp = None if restore else datetime.now(timezone.utc).isoformat()
            items = []
            unchanged = 0
            for note_id in normalized_ids:
                row = rows.get(note_id)
                should_change = row is not None and (
                    row["deleted_at"] is not None if restore else row["deleted_at"] is None
                )
                if not should_change:
                    unchanged += 1
                    continue
                await db.execute(
                    "UPDATE highlights SET deleted_at = ?, updated_at = ? WHERE id = ?",
                    (timestamp, datetime.now(timezone.utc).isoformat(), note_id),
                )
                item = _batch_item(row)
                item["deleted_at"] = timestamp
                items.append(item)

            result = {
                "operation_id": operation_id,
                "affected": len(items),
                "unchanged": unchanged,
                "items": items,
            }
            await _save_batch_result(
                db,
                operation_id=operation_id,
                operation_type=operation_type,
                request_hash=request_hash,
                result=result,
            )
            await db.commit()
            return result
        except BaseException:
            await db.rollback()
            raise


async def batch_trash_notes(
    *, operation_id: str, ids: list[str]
) -> dict[str, Any]:
    return await _batch_set_deleted_at(
        operation_id=operation_id,
        ids=ids,
        restore=False,
    )


async def batch_restore_notes(
    *, operation_id: str, ids: list[str]
) -> dict[str, Any]:
    return await _batch_set_deleted_at(
        operation_id=operation_id,
        ids=ids,
        restore=True,
    )


async def batch_delete_notes(
    *, operation_id: str, ids: list[str]
) -> dict[str, Any]:
    normalized_ids = _normalize_note_ids(ids)
    operation_type = "delete"
    request_hash = _batch_request_hash(operation_type, {"ids": normalized_ids})

    async with aiosqlite.connect(str(DB_PATH)) as db:
        db.row_factory = aiosqlite.Row
        await db.execute("BEGIN IMMEDIATE")
        try:
            replay = await _existing_batch_result(
                db,
                operation_id=operation_id,
                operation_type=operation_type,
                request_hash=request_hash,
            )
            if replay is not None:
                await db.commit()
                return replay

            rows = await _load_batch_rows(db, normalized_ids)
            active_ids = [
                note_id
                for note_id in normalized_ids
                if note_id in rows and rows[note_id]["deleted_at"] is None
            ]
            if active_ids:
                raise NoteBatchConflict(
                    "delete requires trashed notes: " + ", ".join(active_ids)
                )

            items = [
                _batch_item(rows[note_id])
                for note_id in normalized_ids
                if note_id in rows
            ]
            if items:
                placeholders = ",".join("?" for _ in items)
                await db.execute(
                    f"DELETE FROM highlights WHERE id IN ({placeholders})",
                    [item["id"] for item in items],
                )

            result = {
                "operation_id": operation_id,
                "affected": len(items),
                "unchanged": len(normalized_ids) - len(items),
                "items": items,
            }
            await _save_batch_result(
                db,
                operation_id=operation_id,
                operation_type=operation_type,
                request_hash=request_hash,
                result=result,
            )
            await db.commit()
            return result
        except BaseException:
            await db.rollback()
            raise


def _row_to_dict(row: aiosqlite.Row) -> dict:
    """Convert a SQLite row to a dictionary."""
    d = dict(row)

    # Parse tags from JSON string
    try:
        d["tags"] = json.loads(d["tags"]) if isinstance(d["tags"], str) else d["tags"]
    except (json.JSONDecodeError, TypeError):
        d["tags"] = []

    d.pop(LEGACY_EXTERNAL_SYNC_COLUMN, None)
    return d


def _jsonable_datetime(value: Any) -> str:
    if value is None:
        return ""
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)


def _highlight_status(highlight: dict) -> str:
    explicit = highlight.get("status")
    if explicit and (explicit != "raw" or not str(highlight.get("note", "")).strip()):
        return explicit
    return "reflected" if str(highlight.get("note", "")).strip() else "raw"


def _row_json_list(value: Any) -> list:
    try:
        if isinstance(value, str):
            parsed = json.loads(value)
            return parsed if isinstance(parsed, list) else []
        return value if isinstance(value, list) else []
    except (json.JSONDecodeError, TypeError):
        return []


def _row_json_dict(value: Any) -> dict:
    try:
        if isinstance(value, str):
            parsed = json.loads(value)
            return parsed if isinstance(parsed, dict) else {}
        return value if isinstance(value, dict) else {}
    except (json.JSONDecodeError, TypeError):
        return {}


def _draft_row_to_dict(row: aiosqlite.Row) -> dict:
    d = dict(row)
    d["metadata"] = _row_json_dict(d.get("metadata"))
    d["source_highlight_ids"] = _row_json_list(d.get("source_highlight_ids"))
    d["exported_to_obsidian"] = bool(d.get("exported_to_obsidian"))
    return d


async def create_draft(
    target: str,
    title: str,
    content: str,
    source_highlight_ids: list[str],
    metadata: Optional[dict] = None,
) -> dict:
    """Create a generated content draft."""
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc).isoformat()
    draft_id = str(uuid.uuid4())
    async with aiosqlite.connect(str(DB_PATH)) as db:
        await db.execute(
            """
            INSERT INTO drafts
                (id, target, title, content, metadata, source_highlight_ids,
                 created_at, updated_at, exported_to_obsidian)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
            """,
            (
                draft_id,
                target,
                title,
                content,
                json.dumps(metadata or {}, ensure_ascii=False),
                json.dumps(source_highlight_ids, ensure_ascii=False),
                now,
                now,
            ),
        )
        await db.commit()
    draft = await get_draft(draft_id)
    return draft or {}


async def list_drafts(target: Optional[str] = None, limit: int = 100, offset: int = 0) -> list[dict]:
    """List content drafts."""
    async with aiosqlite.connect(str(DB_PATH)) as db:
        db.row_factory = aiosqlite.Row
        if target:
            rows = await db.execute_fetchall(
                "SELECT * FROM drafts WHERE target = ? ORDER BY updated_at DESC LIMIT ? OFFSET ?",
                (target, limit, offset),
            )
        else:
            rows = await db.execute_fetchall(
                "SELECT * FROM drafts ORDER BY updated_at DESC LIMIT ? OFFSET ?",
                (limit, offset),
            )
        return [_draft_row_to_dict(r) for r in rows]


async def get_draft(draft_id: str) -> dict | None:
    """Fetch one draft."""
    async with aiosqlite.connect(str(DB_PATH)) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute("SELECT * FROM drafts WHERE id = ?", (draft_id,))
        row = await cursor.fetchone()
        return _draft_row_to_dict(row) if row else None


async def update_draft(draft_id: str, data: dict) -> dict | None:
    """Update a draft and return it."""
    from datetime import datetime, timezone

    allowed = {"title", "content", "metadata", "exported_to_obsidian"}
    values = {k: v for k, v in data.items() if k in allowed and v is not None}
    if not values:
        return await get_draft(draft_id)
    if "metadata" in values:
        values["metadata"] = json.dumps(values["metadata"], ensure_ascii=False)
    if "exported_to_obsidian" in values:
        values["exported_to_obsidian"] = 1 if values["exported_to_obsidian"] else 0
    values["updated_at"] = datetime.now(timezone.utc).isoformat()
    assignments = ", ".join(f"{key} = ?" for key in values)
    params = [*values.values(), draft_id]

    async with aiosqlite.connect(str(DB_PATH)) as db:
        await db.execute(f"UPDATE drafts SET {assignments} WHERE id = ?", params)
        await db.commit()
    return await get_draft(draft_id)


async def delete_draft(draft_id: str) -> bool:
    """Delete a draft."""
    async with aiosqlite.connect(str(DB_PATH)) as db:
        cursor = await db.execute("DELETE FROM drafts WHERE id = ?", (draft_id,))
        await db.commit()
        return cursor.rowcount > 0


NOTES_JSON_PATH = Path(__file__).parent / "data" / "notes.json"


async def export_all_to_json() -> Path:
    """Export all highlights from SQLite to a standard JSON file on disk."""
    all_highlights = await get_all_highlights(limit=100000, offset=0)
    entries = []
    for h in all_highlights:
        entries.append({
            "book_title": h.get("book_title", ""),
            "book_author": h.get("book_author", ""),
            "chapter": h.get("chapter", ""),
            "highlight_text": h.get("highlight_text", ""),
            "note": h.get("note", ""),
            "tags": h.get("tags", []),
            "color": h.get("color", "yellow"),
            "progress_percent": h.get("progress_percent", 0),
            "created_at": h.get("created_at", ""),
            "updated_at": h.get("updated_at", ""),
            "status": h.get("status", "raw"),
        })
    NOTES_JSON_PATH.parent.mkdir(parents=True, exist_ok=True)
    NOTES_JSON_PATH.write_text(
        json.dumps(entries, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return NOTES_JSON_PATH
