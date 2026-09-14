# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with this repository.

## Project Overview

Marginalia is a local-first reading and note-management workflow: **EPUB highlights -> Backend API -> Notes Library -> Server-side Obsidian Markdown export and JSON download**. A browser PWA lets users read EPUBs, create color-coded highlights with inline notes/tags, and sync them, bookmarks, and reading progress to a FastAPI/SQLite backend. Tags are edited in the reader's note dialog; the note-management workspace filters materials and edits or deletes reflections.

## Commands

```bash
# Backend: install deps and run with hot reload (default port 8720)
cd backend && pip install -r requirements.txt && uvicorn main:app --reload --port 8720

# Run via python __main__ (same thing, port 8720)
cd backend && python main.py

# Docker Compose (hot reload + persistent data volume, port 8720)
docker compose up --build

# Backend tests
cd backend && pytest

# Frontend Playwright tests
cd frontend && npm test
```

All run methods use port 8720. The backend mounts `frontend/` as static files at `/`, so visiting `http://localhost:8720` serves the PWA automatically.

## Architecture

```text
frontend/          PWA Reader (vanilla JS + epub.js + IndexedDB)
  app.js           IIFE; DOM refs near the top; stores books, highlights, bookmarks
                   API_BASE is '' because the backend serves the frontend
  sw.js            App-shell and EPUB offline caches
  index.html       Library, reader, note-management workspace, modal, toast
  book-chat/       Additional EPUB reading interface
  manifest.json    PWA manifest
  style.css        Highlight colors and responsive layout
  tests/           Playwright browser tests

backend/           FastAPI
  main.py          Routes: health, highlights CRUD, materials, search,
                   book-note exports, server-side books and reading-state sync
  models.py        Pydantic schemas
  database.py      aiosqlite note storage, search, and JSON export
  library.py       EPUB upload, deduplication, library and reading-state sync
  obsidian.py      Book-note Markdown written into the server's Obsidian directory
  books_api.py     EPUB validation, metadata parsing, and legacy file serving
  config.py        Environment configuration
  Dockerfile       Development image, uvicorn on port 8720
  tests/           pytest tests

docs/              Architecture and production-deployment notes
```

## Data Flow

1. User imports EPUB -> backend persists a hash-deduplicated book; IndexedDB keeps its offline blob.
2. User selects text -> epub.js fires `selected` with a CFI range.
3. User picks color -> `rendition.annotations.highlight()` renders the highlight and IndexedDB stores it.
4. User edits note/tags -> local highlight material is updated.
5. Reading changes enter a local queue and automatically sync through `POST /api/books/{id}/sync`; manual sync is also available.
6. Backend refreshes `backend/data/notes.json`; `GET /api/notes/export` downloads that JSON. From the note-management workspace, `POST /api/obsidian/export` writes a book's highlights, notes, and tags as Markdown beneath the server's configured `OBSIDIAN_VAULT_PATH/Marginalia/Books/` directory. The browser displays the returned path; it does not download Markdown.

## Key Design Decisions

- **IndexedDB over localStorage**: EPUB blobs can be 10MB+.
- **Static frontend over build pipeline**: Keeps local deployment simple.
- **SQLite over PostgreSQL**: Zero setup for a personal tool.
- **Queued automatic sync**: Progress, bookmarks, highlights, and notes survive offline use and converge across devices.
- **JSON notes export**: Simple local bridge for automation and backups.
- **Backend serves frontend**: One server, one origin; `API_BASE = ''` works locally.
- **Shared personal account**: Production uses Cloudflare Tunnel and Access; the API must not be exposed directly to the public internet.

## Environment

Copy `.env.example` to `.env` for local configuration. The frontend uses `API_BASE = ''` (same-origin requests), so it must be served from the same origin as the API, either via the backend static file mount or behind a reverse proxy.

Never commit real environment files, app secrets, `backend/data/` SQLite databases, EPUB files, or Obsidian vault contents. Preserve existing runtime data, historical database tables/indexes, and files when upgrading; do not clean them as part of feature removal.
