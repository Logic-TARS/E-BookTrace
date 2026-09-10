(() => {
  'use strict';

  const STORAGE = {
    selectedBook: 'marginalia.chatReader.selectedBookId',
    positionPrefix: 'marginalia.chatReader.position.',
    theme: 'marginalia.chatReader.theme',
  };
  const SEARCH_DELAY = 280;
  const PROGRESS_DELAY = 700;
  const MAX_SEARCH_RESULTS = 60;
  const THEME_COLORS = {
    dark: '#171717',
    light: '#faf8f3',
  };
  const EPUB_THEMES = {
    dark: {
      'html, body': {
        color: '#e7e1d8 !important',
        background: '#211f1c !important',
      },
      body: {
        'font-family': 'Georgia, "Noto Serif CJK SC", "Songti SC", serif',
        'line-height': '1.75',
        padding: '0 5% !important',
      },
      'a, a:link, a:visited': { color: '#68cdb2 !important' },
      img: { 'max-width': '100% !important', 'max-height': '100% !important' },
    },
    light: {
      'html, body': {
        color: '#262421 !important',
        background: '#f5f2ea !important',
      },
      body: {
        'font-family': 'Georgia, "Noto Serif CJK SC", "Songti SC", serif',
        'line-height': '1.75',
        padding: '0 5% !important',
      },
      'a, a:link, a:visited': { color: '#087f65 !important' },
      img: { 'max-width': '100% !important', 'max-height': '100% !important' },
    },
  };
  const dom = {
    sidebar: document.getElementById('sidebar'),
    backdrop: document.getElementById('backdrop'),
    openSidebar: document.getElementById('open-sidebar'),
    closeSidebar: document.getElementById('close-sidebar'),
    themeToggle: document.getElementById('theme-toggle'),
    themeIcon: document.getElementById('theme-icon'),
    themeColor: document.querySelector('meta[name="theme-color"]'),
    importButton: document.getElementById('import-button'),
    epubInput: document.getElementById('epub-input'),
    libraryTab: document.getElementById('library-tab'),
    tocTab: document.getElementById('toc-tab'),
    libraryPanel: document.getElementById('library-panel'),
    tocPanel: document.getElementById('toc-panel'),
    libraryCount: document.getElementById('library-count'),
    bookList: document.getElementById('book-list'),
    libraryEmpty: document.getElementById('library-empty'),
    tocList: document.getElementById('toc-list'),
    tocEmpty: document.getElementById('toc-empty'),
    tocBookTitle: document.getElementById('toc-book-title'),
    tocBookAuthor: document.getElementById('toc-book-author'),
    chapterTitle: document.getElementById('chapter-title'),
    pageLabel: document.getElementById('page-label'),
    progressLabel: document.getElementById('progress-label'),
    readerState: document.getElementById('reader-state'),
    stateMark: document.getElementById('state-mark'),
    stateTitle: document.getElementById('state-title'),
    stateDescription: document.getElementById('state-description'),
    stateAction: document.getElementById('state-action'),
    epubContainer: document.getElementById('epub-container'),
    previousPage: document.getElementById('previous-page'),
    nextPage: document.getElementById('next-page'),
    searchInput: document.getElementById('search-input'),
    searchJump: document.getElementById('search-jump'),
    searchPopover: document.getElementById('search-popover'),
    searchStatus: document.getElementById('search-status'),
    searchResults: document.getElementById('search-results'),
    toast: document.getElementById('toast'),
  };

  let books = [];
  let selectedBook = null;
  let currentBook = null;
  let rendition = null;
  let currentBookUrl = null;
  let currentLocation = null;
  let toc = [];
  let flatToc = [];
  let selectionToken = 0;
  let searchToken = 0;
  let searchTimer = null;
  let progressTimer = null;
  let toastTimer = null;
  let downloadController = null;
  let pendingProgress = null;
  let restoredProgress = null;
  let progressReady = false;
  let locationsReady = false;
  let navigationBusy = false;
  let isComposing = false;
  let searchResults = [];
  let activeSearchIndex = -1;
  let operationSequence = 0;
  let resizeTimer = null;
  const systemTheme = window.matchMedia('(prefers-color-scheme: light)');
  let theme = 'dark';
  let followsSystemTheme = false;

  function readStorage(key) {
    try {
      return localStorage.getItem(key);
    } catch (_error) {
      return null;
    }
  }

  function writeStorage(key, value) {
    try {
      if (value === null || value === undefined || value === '') localStorage.removeItem(key);
      else localStorage.setItem(key, String(value));
    } catch (_error) {}
  }

  function applyRenditionTheme() {
    if (!rendition || !rendition.themes) return;
    try {
      rendition.themes.select(theme);
    } catch (_error) {}
  }

  function setTheme(nextTheme, persist = false) {
    theme = nextTheme === 'light' ? 'light' : 'dark';
    document.documentElement.dataset.theme = theme;
    const target = theme === 'dark' ? '浅色' : '深色';
    const label = `切换到${target}模式`;
    dom.themeToggle.setAttribute('aria-label', label);
    dom.themeToggle.title = label;
    dom.themeIcon.textContent = theme === 'dark' ? '☀' : '☾';
    dom.themeColor.setAttribute('content', THEME_COLORS[theme]);
    if (persist) {
      followsSystemTheme = false;
      writeStorage(STORAGE.theme, theme);
    }
    applyRenditionTheme();
  }

  function initTheme() {
    const saved = readStorage(STORAGE.theme);
    followsSystemTheme = saved !== 'light' && saved !== 'dark';
    setTheme(followsSystemTheme && systemTheme.matches ? 'light' : saved, false);
  }

  function positionKey(bookId) {
    return STORAGE.positionPrefix + bookId;
  }

  function readFallbackPosition(bookId) {
    try {
      const parsed = JSON.parse(readStorage(positionKey(bookId)) || 'null');
      if (!parsed || typeof parsed !== 'object') return null;
      return {
        cfi: typeof parsed.cfi === 'string' ? parsed.cfi : '',
        progress_percent: Number.isFinite(Number(parsed.progress_percent))
          ? Number(parsed.progress_percent)
          : null,
        last_opened: Number(parsed.last_opened) || 0,
      };
    } catch (_error) {
      return null;
    }
  }

  function writeFallbackPosition(bookId, progress) {
    try {
      localStorage.setItem(positionKey(bookId), JSON.stringify(progress));
    } catch (_error) {}
  }

  function makeElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function showToast(message) {
    window.clearTimeout(toastTimer);
    dom.toast.textContent = message;
    dom.toast.hidden = false;
    toastTimer = window.setTimeout(() => {
      dom.toast.hidden = true;
    }, 3200);
  }

  async function parseError(response, fallback) {
    try {
      const body = await response.json();
      const detail = body && body.detail;
      if (typeof detail === 'string') return detail;
      if (detail && typeof detail.message === 'string') return detail.message;
    } catch (_error) {}
    return `${fallback}（${response.status}）`;
  }

  function setSidebarOpen(open) {
    const mobile = window.matchMedia('(max-width: 760px)').matches;
    const visible = mobile && open;
    dom.sidebar.classList.toggle('open', visible);
    dom.sidebar.setAttribute('aria-hidden', String(mobile && !visible));
    dom.openSidebar.setAttribute('aria-expanded', String(visible));
    dom.backdrop.hidden = !visible;
    if (visible) dom.closeSidebar.focus();
  }

  function setSidebarTab(name, focus = false) {
    const librarySelected = name === 'library';
    dom.libraryTab.setAttribute('aria-selected', String(librarySelected));
    dom.libraryTab.tabIndex = librarySelected ? 0 : -1;
    dom.tocTab.setAttribute('aria-selected', String(!librarySelected));
    dom.tocTab.tabIndex = librarySelected ? -1 : 0;
    dom.libraryPanel.hidden = !librarySelected;
    dom.tocPanel.hidden = librarySelected;
    if (focus) (librarySelected ? dom.libraryTab : dom.tocTab).focus();
  }

  function waitForReaderSize() {
    return new Promise(resolve => {
      const check = () => {
        const bounds = dom.epubContainer.getBoundingClientRect();
        if (bounds.width >= 2 && bounds.height >= 2) resolve(bounds);
        else window.requestAnimationFrame(check);
      };
      check();
    });
  }

  function setReaderState(state, title, description, actionLabel) {
    dom.readerState.dataset.state = state;
    dom.stateMark.textContent = state === 'error' ? '!' : 'M';
    dom.stateTitle.textContent = title;
    dom.stateDescription.textContent = description;
    dom.stateAction.textContent = actionLabel || '';
    dom.stateAction.hidden = !actionLabel;
    dom.readerState.hidden = false;
    dom.epubContainer.hidden = true;
    dom.previousPage.hidden = true;
    dom.nextPage.hidden = true;
    dom.searchInput.disabled = true;
  }

  function showReader() {
    dom.readerState.hidden = true;
    dom.epubContainer.hidden = false;
    dom.previousPage.hidden = false;
    dom.nextPage.hidden = false;
    dom.searchInput.disabled = false;
  }

  function renderBooks() {
    dom.bookList.replaceChildren();
    dom.libraryCount.textContent = String(books.length);
    books.forEach(book => {
      const button = makeElement('button', 'book-button');
      button.type = 'button';
      button.dataset.bookId = book.id;
      button.setAttribute('role', 'listitem');
      button.setAttribute('aria-current', String(Boolean(selectedBook && selectedBook.id === book.id)));
      button.append(
        makeElement('strong', '', book.title || book.original_filename || book.filename || '未命名书籍'),
        makeElement('span', '', book.author || '作者未知')
      );
      button.addEventListener('click', () => selectBook(book.id));
      dom.bookList.appendChild(button);
    });
    dom.libraryEmpty.hidden = books.length > 0;
    if (!books.length) dom.libraryEmpty.textContent = '书库中还没有 EPUB，点击上方按钮导入。';
  }

  function flattenToc(items, output = [], parentLabel = '') {
    (items || []).forEach(item => {
      item._readerParentLabel = parentLabel;
      output.push(item);
      flattenToc(
        item.subitems || item.children || [],
        output,
        item.label || item.title || parentLabel
      );
    });
    return output;
  }

  function renderTocBranch(items, parent) {
    (items || []).forEach(item => {
      const branch = makeElement('div', 'toc-branch');
      const button = makeElement('button', 'toc-button', item.label || item.title || '未命名章节');
      button.type = 'button';
      button.dataset.href = item.href || '';
      button.title = button.textContent;
      button.addEventListener('click', () => {
        if (rendition && item.href) rendition.display(item.href);
        setSidebarOpen(false);
      });
      branch.appendChild(button);
      renderTocBranch(item.subitems || item.children || [], branch);
      parent.appendChild(branch);
    });
  }

  function renderToc() {
    dom.tocList.replaceChildren();
    flatToc = flattenToc(toc, []);
    renderTocBranch(toc, dom.tocList);
    dom.tocEmpty.hidden = flatToc.length > 0;
    dom.tocEmpty.textContent = flatToc.length ? '' : '这本 EPUB 没有可用目录。';
    updateActiveToc(currentLocation && currentLocation.start && currentLocation.start.href);
  }

  function cleanHref(href) {
    const value = String(href || '').split('#')[0];
    try {
      return decodeURIComponent(value).replace(/^\.\//, '');
    } catch (_error) {
      return value.replace(/^\.\//, '');
    }
  }

  function hrefMatches(left, right) {
    const a = cleanHref(left);
    const b = cleanHref(right);
    return Boolean(a && b && (a === b || a.endsWith('/' + b) || b.endsWith('/' + a)));
  }

  function findChapter(href) {
    let exact = flatToc.find(item => hrefMatches(item.href, href));
    if (exact) return exact;
    const target = cleanHref(href);
    exact = flatToc.find(item => target && cleanHref(item.href) && target.includes(cleanHref(item.href)));
    return exact || null;
  }

  function updateActiveToc(href) {
    const chapter = findChapter(href);
    dom.tocList.querySelectorAll('.toc-button').forEach(button => {
      const active = Boolean(chapter && button.dataset.href === chapter.href);
      if (active) button.setAttribute('aria-current', 'location');
      else button.removeAttribute('aria-current');
    });
    if (chapter) dom.chapterTitle.textContent = chapter.label || chapter.title || '未命名章节';
    else if (href) dom.chapterTitle.textContent = href.split('/').pop().split('#')[0] || '正文';
  }

  function selectRestoredProgress(serverState, fallback) {
    const server = serverState && serverState.progress;
    if (server && server.cfi) return server;
    if (fallback && fallback.cfi) return fallback;
    return server || fallback || null;
  }

  function getLocationsTotal() {
    if (!currentBook || !currentBook.locations) return 0;
    const locations = currentBook.locations;
    if (typeof locations.length === 'function') return Number(locations.length()) || 0;
    if (Array.isArray(locations._locations)) return locations._locations.length;
    return 0;
  }

  function progressPercentFor(location) {
    const cfi = location && location.start && location.start.cfi;
    if (locationsReady && cfi && currentBook && currentBook.locations) {
      try {
        const fraction = currentBook.locations.percentageFromCfi(cfi);
        if (Number.isFinite(fraction)) return Math.max(0, Math.min(100, fraction * 100));
      } catch (_error) {}
    }
    if (location && location.start && Number.isFinite(location.start.percentage)) {
      return Math.max(0, Math.min(100, location.start.percentage * 100));
    }
    if (progressReady && location && location.start && currentBook && currentBook.spine) {
      const items = (currentBook.spine.spineItems || []).filter(item => item && item.linear !== 'no');
      const sectionIndex = items.findIndex(item => hrefMatches(item.href, location.start.href));
      if (sectionIndex >= 0 && items.length) {
        const displayed = location.start.displayed || {};
        const page = Math.max(1, Number(displayed.page) || 1);
        const total = Math.max(1, Number(displayed.total) || 1);
        return Math.max(0, Math.min(100, ((sectionIndex + ((page - 1) / total)) / items.length) * 100));
      }
    }
    if (restoredProgress && Number.isFinite(Number(restoredProgress.progress_percent))) {
      return Math.max(0, Math.min(100, Number(restoredProgress.progress_percent)));
    }
    return null;
  }

  function updateLocationUi(location) {
    if (!location || !location.start) return;
    const displayed = location.start.displayed || {};
    const current = Number(displayed.page) || 1;
    const total = Number(displayed.total) || 1;
    dom.pageLabel.textContent = `第 ${current} / ${total} 页`;
    const percent = progressPercentFor(location);
    dom.progressLabel.textContent = percent === null ? '计算中…' : `${Math.round(percent)}%`;
    updateActiveToc(location.start.href);
    dom.previousPage.disabled = Boolean(location.atStart);
    dom.nextPage.disabled = Boolean(location.atEnd);
  }

  function makeOperationId(bookId, cfi, opened) {
    operationSequence += 1;
    let hash = 2166136261;
    const input = `${bookId}|${cfi}|${opened}|${operationSequence}`;
    for (let index = 0; index < input.length; index += 1) {
      hash ^= input.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `chat-reader-progress-${bookId}-${opened}-${(hash >>> 0).toString(36)}`;
  }

  function captureProgress(location) {
    if (!selectedBook || !location || !location.start || !location.start.cfi) return null;
    const percent = progressPercentFor(location);
    const opened = Date.now();
    const payload = {
      cfi: location.start.cfi,
      progress_percent: percent === null
        ? Number(restoredProgress && restoredProgress.progress_percent) || 0
        : Number(percent.toFixed(4)),
      last_opened: opened,
    };
    writeFallbackPosition(selectedBook.id, payload);
    return {
      bookId: selectedBook.id,
      op_id: makeOperationId(selectedBook.id, payload.cfi, opened),
      payload,
    };
  }

  function scheduleProgress(location) {
    if (!progressReady) return;
    const captured = captureProgress(location);
    if (!captured) return;
    pendingProgress = captured;
    window.clearTimeout(progressTimer);
    progressTimer = window.setTimeout(() => flushProgress(), PROGRESS_DELAY);
  }

  async function flushProgress(options = {}) {
    window.clearTimeout(progressTimer);
    progressTimer = null;
    const pending = pendingProgress;
    if (!pending) return true;
    const requestOptions = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operations: [{
          op_id: pending.op_id,
          type: 'progress.set',
          payload: pending.payload,
        }],
      }),
    };
    if (options.keepalive) requestOptions.keepalive = true;
    try {
      const response = await fetch(`/api/books/${encodeURIComponent(pending.bookId)}/sync`, requestOptions);
      if (!response.ok) throw new Error(await parseError(response, '阅读进度同步失败'));
      if (pendingProgress && pendingProgress.op_id === pending.op_id) pendingProgress = null;
      return true;
    } catch (_error) {
      return false;
    }
  }

  function cancelSearch() {
    searchToken += 1;
    window.clearTimeout(searchTimer);
    searchTimer = null;
  }

  function clearSearch(close = true) {
    cancelSearch();
    searchResults = [];
    activeSearchIndex = -1;
    dom.searchResults.replaceChildren();
    dom.searchStatus.textContent = '';
    if (close) dom.searchPopover.hidden = true;
    dom.searchInput.setAttribute('aria-expanded', 'false');
    dom.searchJump.disabled = true;
  }

  async function destroyReader(options = {}) {
    cancelSearch();
    if (downloadController) downloadController.abort();
    downloadController = null;
    if (options.flush !== false) await flushProgress();
    progressReady = false;
    locationsReady = false;
    currentLocation = null;
    restoredProgress = null;
    pendingProgress = null;
    const oldRendition = rendition;
    const oldBook = currentBook;
    const oldUrl = currentBookUrl;
    rendition = null;
    currentBook = null;
    currentBookUrl = null;
    dom.epubContainer.replaceChildren();
    if (oldRendition) {
      try { oldRendition.destroy(); } catch (_error) {}
    }
    if (oldBook) {
      try { oldBook.destroy(); } catch (_error) {}
    }
    if (oldUrl) URL.revokeObjectURL(oldUrl);
    toc = [];
    flatToc = [];
    renderToc();
  }

  async function loadBooks(preferredId) {
    const response = await fetch('/api/books');
    if (!response.ok) throw new Error(await parseError(response, '无法加载书库'));
    const data = await response.json();
    books = Array.isArray(data.books) ? data.books : [];
    if (preferredId !== undefined) selectedBook = books.find(book => book.id === preferredId) || selectedBook;
    renderBooks();
    const wanted = preferredId === undefined ? readStorage(STORAGE.selectedBook) : preferredId;
    if (wanted && books.some(book => book.id === wanted)) await selectBook(wanted);
    else if (!books.length) setReaderState('empty', '书库还是空的', '导入一本 EPUB 后，它会出现在左侧服务器书库中。', '导入 EPUB');
    else setReaderState('idle', '选择一本书开始阅读', '从左侧服务器书库打开 EPUB。阅读、翻页和搜索都在此页面完成。');
  }

  async function loadSyncState(bookId, token) {
    try {
      const response = await fetch(`/api/books/${encodeURIComponent(bookId)}/sync`);
      if (token !== selectionToken) return null;
      if (!response.ok) throw new Error(await parseError(response, '无法读取阅读进度'));
      return await response.json();
    } catch (error) {
      if (token === selectionToken) showToast('服务器进度暂不可用，将使用本机位置');
      return null;
    }
  }

  async function selectBook(bookId) {
    const match = books.find(book => book.id === bookId);
    if (!match) return;
    const token = ++selectionToken;
    selectedBook = match;
    writeStorage(STORAGE.selectedBook, match.id);
    renderBooks();
    clearSearch();
    dom.searchInput.value = '';
    dom.tocBookTitle.textContent = match.title || match.original_filename || match.filename || '未命名书籍';
    dom.tocBookAuthor.textContent = match.author || '作者未知';
    dom.chapterTitle.textContent = '正在准备…';
    dom.pageLabel.textContent = '第 0 / 0 页';
    dom.progressLabel.textContent = '计算中…';
    setSidebarTab('toc');
    setSidebarOpen(false);
    setReaderState('loading', '正在下载 EPUB', '先恢复阅读进度，再从服务器获取书籍文件。');
    await destroyReader();
    if (token !== selectionToken) return;

    const fallback = readFallbackPosition(match.id);
    const serverState = await loadSyncState(match.id, token);
    if (token !== selectionToken) return;
    restoredProgress = selectRestoredProgress(serverState, fallback);

    downloadController = new AbortController();
    try {
      const response = await fetch(`/api/books/${encodeURIComponent(match.id)}/file`, {
        signal: downloadController.signal,
      });
      if (!response.ok) throw new Error(await parseError(response, 'EPUB 下载失败'));
      const arrayBuffer = await response.arrayBuffer();
      if (token !== selectionToken) return;
      setReaderState('loading', '正在解析 EPUB', '正在读取书籍元数据、正文和章节目录。');
      const blob = new Blob([arrayBuffer], { type: 'application/epub+zip' });
      currentBookUrl = URL.createObjectURL(blob);
      currentBook = ePub(currentBookUrl, { openAs: 'epub' });
      dom.epubContainer.hidden = false;
      const readerBounds = await waitForReaderSize();
      if (token !== selectionToken) return;
      rendition = currentBook.renderTo(dom.epubContainer, {
        width: Math.floor(readerBounds.width),
        height: Math.floor(readerBounds.height),
        flow: 'paginated',
        spread: 'none',
      });
      rendition.themes.register('dark', EPUB_THEMES.dark);
      rendition.themes.register('light', EPUB_THEMES.light);
      applyRenditionTheme();
      rendition.on('relocated', location => {
        if (token !== selectionToken) return;
        currentLocation = location;
        updateLocationUi(location);
        scheduleProgress(location);
      });
      rendition.hooks.content.register(contents => {
        const doc = contents && contents.document;
        if (!doc || doc.documentElement.dataset.chatReaderKeys === 'true') return;
        doc.documentElement.dataset.chatReaderKeys = 'true';
        doc.addEventListener('keydown', event => {
          if (event.altKey || event.ctrlKey || event.metaKey) return;
          if (event.key === 'ArrowLeft') navigatePage('prev');
          if (event.key === 'ArrowRight') navigatePage('next');
        });
      });

      const [navigation, metadata] = await Promise.all([
        currentBook.loaded.navigation,
        currentBook.loaded.metadata.catch(() => ({})),
      ]);
      if (token !== selectionToken) return;
      toc = Array.isArray(navigation.toc) ? navigation.toc : [];
      renderToc();
      if (metadata.title) dom.tocBookTitle.textContent = metadata.title;
      if (metadata.creator) dom.tocBookAuthor.textContent = metadata.creator;
      const startCfi = restoredProgress && restoredProgress.cfi || undefined;
      await rendition.display(startCfi);
      if (token !== selectionToken) return;
      showReader();
      progressReady = true;
      if (currentLocation) updateLocationUi(currentLocation);
      setSidebarOpen(false);
      warmLocations(currentBook, token);
    } catch (error) {
      if (error.name === 'AbortError' || token !== selectionToken) return;
      await destroyReader({ flush: false });
      setReaderState('error', '无法打开这本书', error.message || 'EPUB 下载或解析失败，请重试。', '重试');
    } finally {
      if (token === selectionToken) downloadController = null;
    }
  }

  async function warmLocations(book, token) {
    try {
      await book.locations.generate(1000);
      if (token !== selectionToken || book !== currentBook) return;
      locationsReady = getLocationsTotal() > 0;
      if (currentLocation) {
        updateLocationUi(currentLocation);
        scheduleProgress(currentLocation);
      }
    } catch (_error) {
      if (token === selectionToken) dom.progressLabel.textContent = restoredProgress
        && Number.isFinite(Number(restoredProgress.progress_percent))
        ? `${Math.round(Number(restoredProgress.progress_percent))}%`
        : '页码可用';
    }
  }

  function currentSpineSection() {
    if (!currentBook || !currentLocation || !currentLocation.start) return null;
    const href = cleanHref(currentLocation.start.href);
    const items = currentBook.spine && currentBook.spine.spineItems || [];
    return items.find(item => hrefMatches(item.href, href)) || null;
  }

  async function navigatePage(direction) {
    if (!rendition || navigationBusy || !currentLocation) return;
    if (direction === 'next' && currentLocation.atEnd) return;
    if (direction === 'prev' && currentLocation.atStart) return;
    navigationBusy = true;
    try {
      const displayed = currentLocation.start.displayed || {};
      const section = currentSpineSection();
      if (direction === 'next' && Number(displayed.page) >= Number(displayed.total) && section && section.next()) {
        await rendition.display(section.next().href, false);
      } else {
        await (direction === 'next' ? rendition.next() : rendition.prev());
      }
    } catch (_error) {
      showToast('暂时无法翻页');
    } finally {
      window.setTimeout(() => { navigationBusy = false; }, 100);
    }
  }

  function chapterSearchResults(query) {
    const needle = query.toLocaleLowerCase();
    return flatToc
      .filter(item => String(item.label || item.title || '').toLocaleLowerCase().includes(needle))
      .slice(0, MAX_SEARCH_RESULTS)
      .map(item => ({
        kind: 'chapter',
        title: item.label || item.title || '未命名章节',
        excerpt: item._readerParentLabel ? `目录章节 · ${item._readerParentLabel}` : '目录章节',
        target: item.href,
      }));
  }

  function collectTextMatches(doc, section, query, results) {
    const needle = query.toLocaleLowerCase();
    const nodeFilter = doc.defaultView && doc.defaultView.NodeFilter || NodeFilter;
    const walker = doc.createTreeWalker(doc.body, nodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent || ['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(parent.tagName)) return nodeFilter.FILTER_REJECT;
        return node.textContent.trim() ? nodeFilter.FILTER_ACCEPT : nodeFilter.FILTER_REJECT;
      },
    });
    let node;
    while ((node = walker.nextNode()) && results.length < MAX_SEARCH_RESULTS) {
      const text = node.textContent.replace(/\s+/g, ' ');
      const lower = text.toLocaleLowerCase();
      let offset = 0;
      let match = lower.indexOf(needle, offset);
      while (match !== -1 && results.length < MAX_SEARCH_RESULTS) {
        let cfi = '';
        try {
          const range = doc.createRange();
          range.setStart(node, match);
          range.setEnd(node, Math.min(node.textContent.length, match + query.length));
          cfi = section.cfiFromRange(range);
        } catch (_error) {}
        const start = Math.max(0, match - 38);
        const end = Math.min(text.length, match + query.length + 58);
        results.push({
          kind: 'text',
          title: findChapter(section.href)?.label || section.href || '正文匹配',
          excerpt: `${start ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`,
          target: cfi || section.href,
        });
        offset = match + Math.max(1, query.length);
        match = lower.indexOf(needle, offset);
      }
    }
  }

  async function searchBookText(query, token, book) {
    const results = [];
    const sections = (book.spine && book.spine.spineItems || []).filter(section => section && section.linear !== 'no');
    for (let index = 0; index < sections.length; index += 1) {
      if (token !== searchToken || book !== currentBook) return null;
      dom.searchStatus.textContent = `正在搜索正文 ${index + 1} / ${sections.length}…`;
      const section = sections[index];
      try {
        const loaded = await section.load(book.load.bind(book));
        if (token !== searchToken || book !== currentBook) return null;
        const doc = section.document || loaded && loaded.ownerDocument;
        if (doc && doc.body) collectTextMatches(doc, section, query, results);
      } catch (_error) {
      } finally {
        if (section.unload) section.unload();
      }
      if (results.length >= MAX_SEARCH_RESULTS) break;
      await new Promise(resolve => window.setTimeout(resolve, 0));
    }
    return results;
  }

  function renderSearchResults(results, status) {
    searchResults = results;
    activeSearchIndex = results.length ? 0 : -1;
    dom.searchResults.replaceChildren();
    dom.searchStatus.textContent = status;
    results.forEach((result, index) => {
      const button = makeElement('button', 'search-result');
      button.type = 'button';
      button.setAttribute('role', 'option');
      button.setAttribute('aria-selected', String(index === activeSearchIndex));
      button.append(
        makeElement('strong', '', result.title),
        makeElement('span', '', result.excerpt),
        makeElement('small', '', result.kind === 'chapter' ? '章节' : '正文')
      );
      button.addEventListener('click', () => activateSearchResult(index));
      dom.searchResults.appendChild(button);
    });
    dom.searchPopover.hidden = false;
    dom.searchInput.setAttribute('aria-expanded', 'true');
    dom.searchJump.disabled = !results.length;
  }

  function setActiveSearchIndex(index) {
    if (!searchResults.length) return;
    activeSearchIndex = (index + searchResults.length) % searchResults.length;
    dom.searchResults.querySelectorAll('.search-result').forEach((button, itemIndex) => {
      button.setAttribute('aria-selected', String(itemIndex === activeSearchIndex));
      if (itemIndex === activeSearchIndex) button.scrollIntoView({ block: 'nearest' });
    });
  }

  function activateSearchResult(index = activeSearchIndex) {
    const result = searchResults[index];
    if (!result || !rendition) return;
    rendition.display(result.target);
    clearSearch();
    dom.searchInput.value = '';
    dom.searchInput.focus();
  }

  function showSearchPrompt() {
    if (!currentBook || dom.searchInput.value.trim()) return;
    clearSearch(false);
    dom.searchStatus.textContent = '输入章节名，或至少两个字搜索正文';
    dom.searchPopover.hidden = false;
    dom.searchInput.setAttribute('aria-expanded', 'true');
  }

  function handleSearchInput() {
    if (isComposing) return;
    const query = dom.searchInput.value.trim();
    cancelSearch();
    if (!query || !currentBook) {
      clearSearch();
      if (!query && document.activeElement === dom.searchInput) showSearchPrompt();
      return;
    }
    const chapters = chapterSearchResults(query);
    renderSearchResults(chapters, chapters.length ? `找到 ${chapters.length} 个章节匹配` : '没有章节匹配');
    if (query.length < 2) return;
    const token = ++searchToken;
    const book = currentBook;
    searchTimer = window.setTimeout(async () => {
      const textResults = await searchBookText(query, token, book);
      if (!textResults || token !== searchToken || book !== currentBook) return;
      const combined = [...chapters, ...textResults].slice(0, MAX_SEARCH_RESULTS);
      const status = combined.length
        ? `找到 ${chapters.length} 个章节、${textResults.length} 条正文匹配`
        : '没有找到匹配内容';
      renderSearchResults(combined, status);
    }, SEARCH_DELAY);
  }

  async function uploadBook(file) {
    if (!file) return;
    dom.importButton.disabled = true;
    dom.importButton.querySelector('span:last-child').textContent = '正在导入…';
    setReaderState('loading', '正在导入 EPUB', '文件正在上传到服务器书库。');
    try {
      const form = new FormData();
      form.append('file', file);
      const response = await fetch('/api/books/upload', { method: 'POST', body: form });
      if (!response.ok) throw new Error(await parseError(response, 'EPUB 导入失败'));
      const result = await response.json();
      if (!result.book || !result.book.id) throw new Error('服务器没有返回书籍信息');
      showToast(result.created === false ? '这本书已在服务器书库中' : 'EPUB 已导入');
      await loadBooks(result.book.id);
    } catch (error) {
      setReaderState('error', 'EPUB 导入失败', error.message || '请检查文件后重试。', '重新选择文件');
    } finally {
      dom.epubInput.value = '';
      dom.importButton.disabled = false;
      dom.importButton.querySelector('span:last-child').textContent = '导入 EPUB';
    }
  }

  function bindEvents() {
    const tabs = [dom.libraryTab, dom.tocTab];
    dom.libraryTab.addEventListener('click', () => setSidebarTab('library'));
    dom.tocTab.addEventListener('click', () => setSidebarTab('toc'));
    tabs.forEach((tab, index) => {
      tab.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const nextIndex = event.key === 'Home' ? 0
          : event.key === 'End' ? tabs.length - 1
            : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
        setSidebarTab(nextIndex === 0 ? 'library' : 'toc', true);
      });
    });
    dom.openSidebar.addEventListener('click', () => setSidebarOpen(true));
    dom.closeSidebar.addEventListener('click', () => setSidebarOpen(false));
    dom.themeToggle.addEventListener('click', () => setTheme(theme === 'dark' ? 'light' : 'dark', true));
    systemTheme.addEventListener('change', event => {
      if (followsSystemTheme) setTheme(event.matches ? 'light' : 'dark', false);
    });
    dom.backdrop.addEventListener('click', () => setSidebarOpen(false));
    dom.importButton.addEventListener('click', () => dom.epubInput.click());
    dom.stateAction.addEventListener('click', () => {
      if (dom.readerState.dataset.state === 'error' && selectedBook) selectBook(selectedBook.id);
      else dom.epubInput.click();
    });
    dom.epubInput.addEventListener('change', () => uploadBook(dom.epubInput.files[0]));
    dom.previousPage.addEventListener('click', () => navigatePage('prev'));
    dom.nextPage.addEventListener('click', () => navigatePage('next'));
    dom.searchInput.addEventListener('input', handleSearchInput);
    dom.searchInput.addEventListener('focus', showSearchPrompt);
    dom.searchInput.addEventListener('blur', () => {
      window.setTimeout(() => {
        if (!dom.searchPopover.contains(document.activeElement)) clearSearch();
      }, 100);
    });
    dom.searchInput.addEventListener('compositionstart', () => { isComposing = true; });
    dom.searchInput.addEventListener('compositionend', () => {
      isComposing = false;
      handleSearchInput();
    });
    dom.searchInput.addEventListener('keydown', event => {
      if (event.isComposing || isComposing || event.keyCode === 229) return;
      if (event.key === 'ArrowDown' && searchResults.length) {
        event.preventDefault();
        setActiveSearchIndex(activeSearchIndex + 1);
      } else if (event.key === 'ArrowUp' && searchResults.length) {
        event.preventDefault();
        setActiveSearchIndex(activeSearchIndex - 1);
      } else if (event.key === 'Enter' && searchResults.length) {
        event.preventDefault();
        activateSearchResult();
      } else if (event.key === 'Escape') {
        clearSearch();
      }
    });
    dom.searchJump.addEventListener('click', () => activateSearchResult());
    document.addEventListener('keydown', event => {
      if (event.target === dom.searchInput || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === 'ArrowLeft') navigatePage('prev');
      if (event.key === 'ArrowRight') navigatePage('next');
      if (event.key === 'Escape') setSidebarOpen(false);
    });
    window.matchMedia('(max-width: 760px)').addEventListener('change', () => setSidebarOpen(false));
    window.addEventListener('resize', () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(async () => {
        if (!rendition || !currentLocation || dom.epubContainer.hidden) return;
        const cfi = currentLocation.start && currentLocation.start.cfi;
        const bounds = dom.epubContainer.getBoundingClientRect();
        if (bounds.width < 2 || bounds.height < 2) return;
        try {
          rendition.resize(Math.floor(bounds.width), Math.floor(bounds.height));
          if (cfi) await rendition.display(cfi);
        } catch (_error) {}
      }, 120);
    });
    window.addEventListener('pagehide', () => {
      if (progressReady && currentLocation) pendingProgress = captureProgress(currentLocation);
      flushProgress({ keepalive: true });
      destroyReader({ flush: false });
    });
    window.addEventListener('beforeunload', () => {
      if (downloadController) downloadController.abort();
      cancelSearch();
    });
  }

  async function init() {
    initTheme();
    bindEvents();
    renderBooks();
    renderToc();
    setSidebarTab('library');
    setSidebarOpen(false);
    setReaderState('loading', '正在连接服务器书库', '正在读取可用的 EPUB。');
    try {
      await loadBooks();
    } catch (error) {
      dom.libraryEmpty.hidden = false;
      dom.libraryEmpty.textContent = '无法加载服务器书库。';
      setReaderState('error', '无法连接书库', error.message || '请确认服务已启动后重试。', '重试');
    }
  }

  init();
})();
