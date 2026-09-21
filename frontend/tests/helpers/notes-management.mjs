export const INDEXED_DB_NAME = 'marginalia';
export const INDEXED_DB_VERSION = 6;

export function makeNote(overrides = {}) {
  return {
    id: 'note-1',
    client_id: 'client-note-1',
    server_id: 'note-1',
    book_id: 'book-1',
    book_title: '测试书',
    book_author: '测试作者',
    chapter: '第一章',
    cfi_range: 'epubcfi(/6/2!/4/2/2)',
    highlight_text: '测试划线',
    note: '测试感悟',
    tags: ['阅读'],
    color: 'yellow',
    status: 'reflected',
    progress_percent: 25,
    created_at: '2026-09-20T00:00:00Z',
    updated_at: '2026-09-20T00:00:00Z',
    deleted_at: null,
    synced: true,
    ...overrides,
  };
}

async function evaluateNotesDatabase(page, callback, argument) {
  return page.evaluate(async ({ databaseName, databaseVersion, argument, callbackSource }) => {
    const openDatabase = () => new Promise((resolve, reject) => {
      const request = indexedDB.open(databaseName, databaseVersion);
      request.onupgradeneeded = () => {
        const database = request.result;
        const transaction = request.transaction;
        let booksStore;
        if (!database.objectStoreNames.contains('books')) {
          booksStore = database.createObjectStore('books', { keyPath: 'id' });
        } else {
          booksStore = transaction.objectStore('books');
        }
        if (!booksStore.indexNames.contains('by_title')) {
          booksStore.createIndex('by_title', 'book_title', { unique: false });
        }

        let highlightsStore;
        if (!database.objectStoreNames.contains('highlights')) {
          highlightsStore = database.createObjectStore('highlights', { keyPath: 'id' });
        } else {
          highlightsStore = transaction.objectStore('highlights');
        }
        if (!highlightsStore.indexNames.contains('by_book')) {
          highlightsStore.createIndex('by_book', 'book_id', { unique: false });
        }
        if (!highlightsStore.indexNames.contains('by_synced')) {
          highlightsStore.createIndex('by_synced', 'synced', { unique: false });
        }

        if (!database.objectStoreNames.contains('deleted_highlights')) {
          database.createObjectStore('deleted_highlights', { keyPath: 'id' });
        }

        let bookmarksStore;
        if (!database.objectStoreNames.contains('bookmarks')) {
          bookmarksStore = database.createObjectStore('bookmarks', { keyPath: 'id' });
        } else {
          bookmarksStore = transaction.objectStore('bookmarks');
        }
        if (!bookmarksStore.indexNames.contains('by_book')) {
          bookmarksStore.createIndex('by_book', 'book_id', { unique: false });
        }

        let syncQueueStore;
        if (!database.objectStoreNames.contains('sync_queue')) {
          syncQueueStore = database.createObjectStore('sync_queue', { keyPath: 'id' });
        } else {
          syncQueueStore = transaction.objectStore('sync_queue');
        }
        if (!syncQueueStore.indexNames.contains('by_book')) {
          syncQueueStore.createIndex('by_book', 'book_id', { unique: false });
        }
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });

    const database = await openDatabase();
    try {
      return await (0, eval)(`(${callbackSource})`)(database, argument);
    } finally {
      database.close();
    }
  }, {
    databaseName: INDEXED_DB_NAME,
    databaseVersion: INDEXED_DB_VERSION,
    argument,
    callbackSource: callback.toString(),
  });
}

export async function seedNotesIndexedDb(page, {
  books = [],
  highlights = [],
  operations = [],
} = {}) {
  await evaluateNotesDatabase(page, (database, seed) => new Promise((resolve, reject) => {
    const storeNames = ['books', 'highlights', 'deleted_highlights', 'bookmarks', 'sync_queue'];
    const transaction = database.transaction(storeNames, 'readwrite');
    storeNames.forEach(name => transaction.objectStore(name).clear());
    seed.books.forEach(book => transaction.objectStore('books').put(book));
    seed.highlights.forEach(note => transaction.objectStore('highlights').put(note));
    seed.operations.forEach(operation => transaction.objectStore('sync_queue').put(operation));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  }), { books, highlights, operations });
}

export async function readNotesIndexedDb(page) {
  return evaluateNotesDatabase(page, database => new Promise((resolve, reject) => {
    const transaction = database.transaction('highlights', 'readonly');
    const request = transaction.objectStore('highlights').getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }));
}

export async function readSyncQueue(page) {
  return evaluateNotesDatabase(page, database => new Promise((resolve, reject) => {
    const transaction = database.transaction('sync_queue', 'readonly');
    const request = transaction.objectStore('sync_queue').getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }));
}

export async function installNotesApiRoutes(page, state = {}) {
  state.books ??= [];
  state.notes ??= [];
  state.requests ??= [];
  state.batchRequests ??= [];
  state.syncRequests ??= [];
  await page.route('**/api/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    let body = null;
    if (request.postData() && request.headers()['content-type']?.includes('application/json')) {
      body = request.postDataJSON();
    }
    state.requests.push({
      method,
      pathname: url.pathname,
      search: url.search,
      body,
    });

    if (url.pathname === '/api/books' && method === 'GET') {
      await route.fulfill({ json: { books: state.books } });
      return;
    }

    if (/^\/api\/books\/[^/]+\/sync$/.test(url.pathname) && method === 'POST') {
      state.syncRequests.push(body);
      await route.fulfill({ json: { book_id: decodeURIComponent(url.pathname.split('/')[3]), revision: 1, progress: null, bookmarks: [], highlights: state.notes } });
      return;
    }

    if (/^\/api\/books\/[^/]+\/sync$/.test(url.pathname) && method === 'GET') {
      await route.fulfill({
        json: {
          book_id: decodeURIComponent(url.pathname.split('/')[3]),
          revision: 0,
          progress: null,
          bookmarks: [],
          highlights: state.notes,
        },
      });
      return;
    }

    if (url.pathname === '/api/notes' && method === 'GET') {
      const view = url.searchParams.get('view') || 'active';
      const delay = state.notesGetDelays?.[view]?.shift?.() || 0;
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      const offset = Number(url.searchParams.get('offset') || 0);
      const limit = Number(url.searchParams.get('limit') || 50);
      const q = (url.searchParams.get('q') || '').toLowerCase();
      const matching = state.notes.filter(note => (
        view === 'trash' ? Boolean(note.deleted_at) : !note.deleted_at
      )).filter(note => !q || `${note.highlight_text} ${note.note}`.toLowerCase().includes(q));
      const items = matching.slice(offset, offset + limit);
      await route.fulfill({
        json: {
          items,
          total: matching.length,
          limit,
          offset,
          has_more: offset + items.length < matching.length,
          facets: state.facets || {
            books: state.notes.map(note => ({ id: note.book_id, title: note.book_title })),
            tags: [...new Set(state.notes.flatMap(note => note.tags || []))],
            note_kinds: [...new Set(state.notes.map(note => note.note ? 'reflected' : 'highlight'))],
            colors: [...new Set(state.notes.map(note => note.color).filter(Boolean))],
          },
        },
      });
      return;
    }

    if (url.pathname.startsWith('/api/notes/batch/') && method === 'POST') {
      body ||= {};
      const type = url.pathname.split('/').at(-1);
      const request = { type, ...body };
      state.batchRequests.push(request);
      if (state.failBatchType === type) {
        state.failBatchType = null;
        await route.fulfill({ status: 500, json: { detail: 'forced batch failure' } });
        return;
      }
      const ids = new Set(body.ids || []);
      const matches = note => ids.has(note.id) || ids.has(note.server_id) || ids.has(note.client_id);
      if (type === 'trash') state.notes.forEach(note => { if (matches(note)) note.deleted_at = new Date().toISOString(); });
      if (type === 'restore') state.notes.forEach(note => { if (matches(note)) note.deleted_at = null; });
      if (type === 'delete') state.notes = state.notes.filter(note => !matches(note));
      await route.fulfill({ json: {
        operation_id: body.operation_id,
        affected: ids.size,
        unchanged: 0,
        items: state.notes.filter(note => ids.has(note.id)).map(note => ({ id: note.id, client_id: note.client_id })),
      } });
      return;
    }

    if (url.pathname === '/api/notes/export.md' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'text/markdown; charset=utf-8',
        headers: { 'content-disposition': 'attachment; filename="Marginalia-notes.md"' },
        body: state.markdown || '# Marginalia 笔记\n',
      });
      return;
    }

    await route.fulfill({ status: 404, json: { detail: 'not mocked' } });
  });
}
