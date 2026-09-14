"""Pydantic models for the Marginalia API."""

from datetime import datetime
from typing import Literal, Optional
import uuid

from pydantic import BaseModel, Field


class HighlightCreate(BaseModel):
    """Incoming highlight from the frontend reader."""
    id: Optional[str] = None
    client_id: Optional[str] = None
    book_title: str
    book_author: str = ""
    chapter: str = ""
    cfi: str = ""
    highlight_text: str
    note: str = ""
    tags: list[str] = Field(default_factory=list)
    color: str = "yellow"
    created_at: Optional[datetime] = None
    progress_percent: float = 0.0
    status: str = "raw"
    knowledge_book_id: Optional[str] = None


class Highlight(HighlightCreate):
    """Full highlight record with server-generated fields."""
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    received_at: datetime = Field(default_factory=datetime.utcnow)


class SyncRequest(BaseModel):
    """Batch sync request from the client."""
    highlights: list[HighlightCreate]


class SyncResponse(BaseModel):
    """Response returned after a successful sync."""
    received: int
    ids: list[str]
    items: list[dict] = Field(default_factory=list)


class ReaderSyncOperation(BaseModel):
    """One idempotent cross-device reader mutation."""

    op_id: str
    type: str
    entity_id: str = ""
    payload: dict = Field(default_factory=dict)


class BookSyncRequest(BaseModel):
    """Pending reader mutations for one canonical server book."""

    operations: list[ReaderSyncOperation] = Field(default_factory=list)


class HighlightUpdate(BaseModel):
    """Editable highlight fields."""
    book_title: Optional[str] = None
    book_author: Optional[str] = None
    chapter: Optional[str] = None
    cfi: Optional[str] = None
    highlight_text: Optional[str] = None
    note: Optional[str] = None
    tags: Optional[list[str]] = None
    color: Optional[str] = None
    progress_percent: Optional[float] = None
    status: Optional[str] = None
    knowledge_book_id: Optional[str] = None


class HighlightDelete(BaseModel):
    """Optional legacy-match fields for deleting old synced rows."""
    client_id: Optional[str] = None
    server_id: Optional[str] = None
    book_title: Optional[str] = None
    cfi: Optional[str] = None
    highlight_text: Optional[str] = None
    created_at: Optional[datetime] = None


class ObsidianExportRequest(BaseModel):
    """Export a book's notes into an Obsidian vault."""
    kind: Literal["book"]
    book_title: Optional[str] = None
