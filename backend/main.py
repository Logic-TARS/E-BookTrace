"""Marginalia API — FastAPI application."""

from __future__ import annotations

import asyncio
import logging
import sys
from contextlib import asynccontextmanager
from typing import Optional

from pathlib import Path

from fastapi import Body, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.trustedhost import TrustedHostMiddleware

from config import settings
from database import (
    init_db,
    upsert_highlights,
    get_all_highlights,
    get_materials,
    search_highlights,
    get_highlight,
    update_highlight,
    delete_highlight,
)
from models import (
    BookSyncRequest,
    HighlightDelete,
    HighlightUpdate,
    ObsidianExportRequest,
    SyncRequest,
    SyncResponse,
)
from books_api import serve_book
from database import export_all_to_json

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("marginalia")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup/shutdown lifecycle."""
    await init_db()
    from library import init_library_db, reconcile_legacy_books

    await init_library_db()
    await reconcile_legacy_books()
    logger.info("Database initialized; Python executable: %s", sys.executable)
    yield


app = FastAPI(
    title="Marginalia API",
    description="EPUB reading, synchronized highlights and book notes",
    version="0.1.0",
    lifespan=lifespan,
)

# Browser access is restricted to configured origins in production.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(
    TrustedHostMiddleware,
    allowed_hosts=settings.allowed_host_list,
)


@app.middleware("http")
async def add_private_api_cache_headers(request: Request, call_next):
    """Prevent API responses from being stored by browsers or edge caches."""
    response = await call_next(request)
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "private, no-store"
        response.headers["CDN-Cache-Control"] = "no-store"
        response.headers["Cloudflare-CDN-Cache-Control"] = "no-store"
        response.headers["Pragma"] = "no-cache"
    return response


# ── Health ──────────────────────────────────────────────
@app.get("/health")
async def health():
    return {"status": "ok", "service": "marginalia"}


# ── Sync highlights ─────────────────────────────────────
@app.post("/api/highlights", response_model=SyncResponse)
async def sync_highlights(request: SyncRequest):
    """
    Receive highlights from the frontend reader.
    1. Validate and save to SQLite
    2. Refresh the standard JSON notes export
    3. Return assigned IDs
    """
    if not request.highlights:
        raise HTTPException(status_code=422, detail="No highlights provided")

    try:
        highlights_dicts = [h.model_dump() for h in request.highlights]
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Invalid highlight data: {e}")

    items = await upsert_highlights(highlights_dicts)
    ids = [item["id"] for item in items]
    logger.info(f"Saved {len(ids)} highlights")

    # Keep the standard JSON export in sync with SQLite.
    asyncio.create_task(_export_notes())

    return SyncResponse(received=len(ids), ids=ids, items=items)


# ── List highlights ─────────────────────────────────────
@app.get("/api/highlights")
async def list_highlights(
    book_title: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
):
    """
    List stored highlights.
    Optional: filter by book_title (partial match).
    """
    highlights = await get_all_highlights(
        book_title=book_title, limit=limit, offset=offset
    )
    return {"highlights": highlights, "count": len(highlights)}


@app.get("/api/materials")
async def list_materials(
    book_title: Optional[str] = None,
    tag: Optional[str] = None,
    status: Optional[str] = None,
    has_note: Optional[bool] = None,
    limit: int = 200,
    offset: int = 0,
):
    """List highlights and reflections for the notes workspace."""
    materials = await get_materials(
        book_title=book_title,
        tag=tag,
        status=status,
        has_note=has_note,
        limit=limit,
        offset=offset,
    )
    return {"materials": materials, "count": len(materials)}


@app.get("/api/search")
async def search_endpoint(
    q: str,
    book_title: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
):
    """Full-text search across highlight text, notes, tags and book metadata."""
    results = await search_highlights(
        query=q, book_title=book_title, limit=limit, offset=offset
    )
    return {"results": results, "count": len(results)}


# ── Single highlight CRUD ───────────────────────────────
@app.get("/api/highlights/{highlight_id}")
async def get_highlight_endpoint(highlight_id: str):
    highlight = await get_highlight(highlight_id)
    if not highlight:
        raise HTTPException(status_code=404, detail="Highlight not found")
    return highlight


@app.patch("/api/highlights/{highlight_id}")
async def update_highlight_endpoint(highlight_id: str, request: HighlightUpdate):
    data = request.model_dump(exclude_unset=True)
    data = {k: v for k, v in data.items() if v is not None}
    if not data:
        raise HTTPException(status_code=422, detail="No update fields provided")

    highlight = await update_highlight(highlight_id, data)
    if not highlight:
        raise HTTPException(status_code=404, detail="Highlight not found")

    asyncio.create_task(_export_notes())
    return highlight


@app.delete("/api/highlights/{highlight_id}")
async def delete_highlight_endpoint(
    highlight_id: str,
    request: Optional[HighlightDelete] = Body(default=None),
):
    legacy_match = request.model_dump(exclude_none=True) if request else None
    deleted = await delete_highlight(highlight_id, legacy_match)
    if not deleted:
        raise HTTPException(status_code=404, detail="Highlight not found")

    asyncio.create_task(_export_notes())
    return {"deleted": True, "id": highlight_id}


@app.post("/api/obsidian/export")
async def export_to_obsidian(request: ObsidianExportRequest):
    try:
        from obsidian import ObsidianConfigError, export_book_materials

        if not request.book_title:
            raise HTTPException(status_code=422, detail="book_title is required")
        highlights = await get_materials(book_title=request.book_title, limit=100000)
        path = export_book_materials(request.book_title, highlights)
    except ObsidianConfigError as e:
        raise HTTPException(status_code=422, detail=str(e))

    return {"exported": True, "path": str(path)}


# ── Server-side EPUB books ─────────────────────────────
@app.get("/api/books")
async def get_books():
    """List canonical EPUBs in the persistent server library."""
    from library import list_library_books

    return {"books": await list_library_books()}


@app.post("/api/books/upload", status_code=202)
async def upload_server_book(
    file: UploadFile = File(...),
    title: str = Form(default=""),
    author: str = Form(default=""),
):
    from library import upload_library_book

    content = await file.read(settings.max_epub_upload_mb * 1024 * 1024 + 1)
    book, created = await upload_library_book(
        content, file.filename or "book.epub", title, author
    )
    return {"book": book, "created": created}


@app.get("/api/books/{book_id}/file")
async def get_server_book_file(book_id: str):
    from library import serve_library_book

    return await serve_library_book(book_id)


@app.get("/api/books/{book_id}/sync")
async def get_server_book_sync(book_id: str):
    from library import get_book_state

    return await get_book_state(book_id)


@app.post("/api/books/{book_id}/sync")
async def sync_server_book(book_id: str, request: BookSyncRequest):
    from library import sync_book_state

    return await sync_book_state(
        book_id, [operation.model_dump() for operation in request.operations]
    )


@app.delete("/api/books/{book_id}")
async def delete_server_book(book_id: str):
    from library import delete_library_book

    if not await delete_library_book(book_id):
        raise HTTPException(status_code=404, detail="Book not found")
    return {"deleted": True, "id": book_id}


@app.get("/api/books/{filename:path}")
async def get_book(filename: str):
    """Legacy filename-based EPUB endpoint."""
    return serve_book(filename)


# ── Notes export ──────────────────────────────────────
@app.get("/api/notes/export")
async def export_notes():
    """Export all highlights as a standard JSON file."""
    path = await export_all_to_json()
    return FileResponse(
        path=str(path),
        media_type="application/json",
        filename="notes.json",
    )


async def _export_notes() -> None:
    """Fire-and-forget: write notes to JSON file."""
    try:
        path = await export_all_to_json()
        logger.info(f"Notes exported to {path}")
    except Exception as e:
        logger.error(f"Notes export failed: {e}")


# ── Static files (frontend) ──────────────────────────────
frontend_dir = Path(__file__).parent.parent / "frontend"
if frontend_dir.is_dir():
    app.mount("/", StaticFiles(directory=str(frontend_dir), html=True), name="frontend")


# ── Run ─────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8720, reload=True)
