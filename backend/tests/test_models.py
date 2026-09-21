"""Tests for Pydantic models (backend/models.py)."""

import pytest
from pydantic import ValidationError

from models import (
    BookSyncRequest,
    HighlightCreate,
    HighlightUpdate,
    NoteBatchIdsRequest,
    NoteBatchTagsRequest,
    ScriptRequest,
    ScriptResponse,
    SyncRequest,
    SyncResponse,
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


class TestHighlightCreate:
    def test_valid_parse(self):
        data = {
            "book_title": "沉思录",
            "book_author": "马可·奥勒留",
            "highlight_text": "宇宙是变化，人生是看法。",
        }
        h = HighlightCreate(**data)
        assert h.book_title == "沉思录"
        assert h.highlight_text == "宇宙是变化，人生是看法。"

    def test_defaults(self):
        h = HighlightCreate(book_title="X", highlight_text="Y")
        assert h.book_author == ""
        assert h.chapter == ""
        assert h.tags == []
        assert h.color == "yellow"
        assert h.note == ""
        assert h.progress_percent == 0.0

    def test_tags_as_list(self):
        h = HighlightCreate(
            book_title="X", highlight_text="Y", tags=["哲学", "金句"]
        )
        assert h.tags == ["哲学", "金句"]

    def test_client_id_alias_fields(self):
        h = HighlightCreate(id="local-1", book_title="X", highlight_text="Y")
        assert h.id == "local-1"
        assert h.client_id is None

    def test_missing_required_fields(self):
        with pytest.raises(ValueError):
            HighlightCreate(book_title="X")  # missing highlight_text
        with pytest.raises(ValueError):
            HighlightCreate(highlight_text="Y")  # missing book_title


class TestSyncRequest:
    def test_valid_request(self):
        highlights = [
            HighlightCreate(book_title="A", highlight_text="B"),
        ]
        req = SyncRequest(highlights=highlights)
        assert len(req.highlights) == 1

    def test_empty_highlights_list(self):
        req = SyncRequest(highlights=[])
        assert req.highlights == []


class TestSyncResponse:
    def test_response_fields(self):
        resp = SyncResponse(received=5, ids=["a", "b", "c", "d", "e"])
        assert resp.received == 5
        assert len(resp.ids) == 5
        assert resp.items == []

    def test_response_items(self):
        resp = SyncResponse(
            received=1,
            ids=["server-1"],
            items=[{"id": "server-1", "client_id": "local-1", "action": "created"}],
        )
        assert resp.items[0]["client_id"] == "local-1"


class TestHighlightUpdate:
    def test_partial_update(self):
        update = HighlightUpdate(note="新笔记", tags=["儒学"])
        assert update.note == "新笔记"
        assert update.tags == ["儒学"]
        assert update.color is None


class TestScriptRequest:
    def test_valid_request(self):
        req = ScriptRequest(highlight_ids=["id1", "id2"])
        assert req.highlight_ids == ["id1", "id2"]

    def test_empty_ids(self):
        req = ScriptRequest(highlight_ids=[])
        assert req.highlight_ids == []

    def test_optional_book_title(self):
        req = ScriptRequest(book_title="沉思录", highlight_ids=["id1"])
        assert req.book_title == "沉思录"


class TestScriptResponse:
    def test_all_fields(self):
        resp = ScriptResponse(
            book_title="沉思录",
            script="完整脚本",
            hook="引言",
            body="正文",
            cta="号召",
            duration_estimate_seconds=60,
            source_count=3,
        )
        assert resp.book_title == "沉思录"
        assert resp.duration_estimate_seconds == 60
        assert resp.source_count == 3
