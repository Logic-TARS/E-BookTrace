# Marginalia Architecture

## Overview

Marginalia is a local-first reading workflow: EPUB highlights -> backend notes library -> book-note Markdown written into the server's configured Obsidian directory, plus downloadable JSON notes.

```text
Reader PWA / book-chat reader
  epub.js + IndexedDB + service worker
                │ same-origin API, queued reading-state sync
                ▼
FastAPI (port 8720)
  EPUB storage + SQLite notes, books, bookmarks, progress
                │
                ├── JSON notes export
                └── Obsidian book-note Markdown export
```

## Components

### 1. Reader PWA (`frontend/`)

- **Stack**: Vanilla HTML/JS/CSS + epub.js; `frontend/book-chat/` remains an additional EPUB reading interface.
- **Storage**: IndexedDB (`books`, `highlights`, `bookmarks`, `sync_queue`) as an offline cache.
- **Key features**: server-first EPUB import, CFI-based highlighting, inline notes, tags, full-text book search, bookmarks, and cross-device reading-state sync.
- **Note management**: filter materials by text or tags, edit/delete reflections, and request a book-note Markdown export into the server's configured Obsidian directory. Tags are edited in the reader's note dialog, not in the workspace. JSON notes can be downloaded through `/api/notes/export`; Markdown export is not a browser download.
- **Offline**: the service worker caches the app shell and server EPUB responses; mutations queue locally until the server is reachable.

### 2. Backend API (`backend/`)

- **Stack**: Python FastAPI + aiosqlite; EbookLib parses and validates EPUB metadata.
- **Endpoints**:
  - `POST /api/highlights` — receive highlights from reader.
  - `GET /api/highlights` and `GET/PATCH/DELETE /api/highlights/{id}` — list, inspect, edit, and delete notes.
  - `GET /api/materials` — filter note materials.
  - `GET /api/search` — full-text search over highlight text, notes, and tags (FTS5).
  - `POST /api/obsidian/export` — export book notes.
  - `GET /api/notes/export` — download the JSON notes export.
  - `POST /api/books/upload` — validate, deduplicate, and persist an EPUB.
  - `GET /api/books` and `GET /api/books/{id}/file` — list and read canonical server EPUBs.
  - `GET/POST /api/books/{id}/sync` — pull state or apply idempotent progress/bookmark/highlight operations.
  - `DELETE /api/books/{id}` — delete a selected EPUB and synchronize its reader-state deletion across devices.
  - `GET /health` — health check.
- **Database**: SQLite for notes and reading state; existing historical tables and indexes are preserved rather than dropped during upgrades.
- **Storage**: existing runtime files under `backend/data/` remain intact during feature removal; backup and restore continue to cover the full data directory.

### 3. Obsidian Export (`backend/obsidian.py`)

- Writes a book's highlights, notes, and tags as Markdown under the server's configured `OBSIDIAN_VAULT_PATH/Marginalia/Books/` directory. The API returns an export status and path, not the Markdown file.
- Requires `OBSIDIAN_VAULT_PATH` to point at an existing, writable target vault. Container deployments need a corresponding vault mount.

## Data Flow

1. User imports EPUB -> backend stores a canonical hash-deduplicated copy; the importing browser keeps an offline copy.
2. User reads and selects text -> epub.js returns a CFI range.
3. User picks a highlight color -> the annotation is rendered and saved in IndexedDB.
4. User edits notes/tags in the reader's note dialog -> local highlight material is updated.
5. Reader changes enter an IndexedDB operation queue and automatically sync through `POST /api/books/{id}/sync`; manual sync remains available.
6. Backend refreshes `backend/data/notes.json` from SQLite; `GET /api/notes/export` downloads the JSON.
7. User filters materials and edits/deletes reflections in the workspace, or requests a book-note Markdown export into the server-side Obsidian directory.

## Key Design Decisions

| Decision | Why |
|----------|-----|
| IndexedDB over localStorage | EPUB blobs can be 10MB+; notes need indexed local queries |
| epub.js with a static frontend | No frontend build step; easy local deployment |
| SQLite over PostgreSQL | Zero setup for a personal tool; embedded in process |
| Idempotent auto-sync with a local queue | Progress, bookmarks, highlights, and notes survive offline use and converge across devices |
| JSON notes export | Simple machine-readable bridge for local workflows |
| Backend serves frontend | One local server and same-origin API calls |
| Shared personal account | Production uses Cloudflare Tunnel and Access rather than exposing the API directly |
| Preserve runtime data | Feature removal does not destroy historical database tables, indexes, or files |
