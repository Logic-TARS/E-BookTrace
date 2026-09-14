"""Tests for Pydantic models (backend/models.py)."""

import pytest
from models import (
    HighlightCreate,
    HighlightUpdate,
    SyncRequest,
    SyncResponse,
    ObsidianExportRequest,
)


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


class TestObsidianExportRequest:
    def test_book_export(self):
        request = ObsidianExportRequest(kind="book", book_title="沉思录")
        assert request.book_title == "沉思录"

    @pytest.mark.parametrize("kind", ["draft", "video", "article", ""])
    def test_only_book_export_is_supported(self, kind):
        with pytest.raises(ValueError):
            ObsidianExportRequest(kind=kind)
