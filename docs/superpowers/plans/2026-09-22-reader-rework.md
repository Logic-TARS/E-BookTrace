# 阅读视图返工与 book-chat 恢复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把主应用阅读视图整体换成 `impeccable-reader-distill-v2` 的形态，并把 `/book-chat/` 页面拉回主线，笔记管理一行不改。

**Architecture:** 以实现线 `13a58ee` 为基线。阅读视图的标记 / CSS / JS 从 v2 移植 —— v2 依赖的 helper（`enableIframeTextSelection`、`findReaderIframes`、`getCurrentAnchorCfi`、`refreshReaderLayout`、`setReaderToolsOpen`、`syncReaderToolStates`、`syncReaderPanelBackdrop`、`closeOtherMobileReaderPanels`）本线全部已具备，所以是"加代码 + 接调用点"，不是重写渲染管线。book-chat 是自包含页面，直接落盘 + 预缓存。笔记管理的代码路径完全不碰。

**Tech Stack:** 原生 JS + epub.js 的 PWA；FastAPI + SQLite 后端；Playwright（`channel: 'chrome'`，静态服务器无后端）；pytest。

**Spec:** `docs/superpowers/specs/2026-09-22-reader-rework-design.md`

## Global Constraints

- 分支 `reader-rework`（基于 `13a58ee`），在 worktree `.worktrees/notes-management-implementation` 里工作；**不推送、不删任何分支**
- 基线（2026-09-22 实测）：后端 `179 passed`；前端 `73 passed / 1 failed`，那个失败是**偶发**（`tests/server-sync.spec.js:162`，单独重跑 4/4 通过）——不要当回归追
- 前端测试：在 `frontend/` 下 `npx playwright test`；单文件 `npx playwright test tests/<name>.spec.js`
- 后端测试：仓库根 `../../.venv/Scripts/python.exe -m pytest backend/tests -q`
- v2 代码一律用 git 对象引用：`git show impeccable-reader-distill-v2:<path>`（该分支从未合并，但对象都在本仓库）
- book-chat 源文件：`%TEMP%\marginalia-bookchat-backup-20260922\`（= 主工作区那份未跟踪副本），**不要**用 v2 提交版
- 版本号约束：`index.html` 里 `app.js?v=N` / `style.css?v=N` 必须与 `sw.js` 的 `APP_SHELL` 清单逐字一致
- **笔记管理代码禁改**：`applyNotesBatch`、`applyLocalNoteOperation`、`applyServerBookState`、别名合并、pending 队列、`buildNotesQueryParams`、`createManagedNoteDraft`、`closeManagedNote` 一律保留本线版本
- 界面文案照抄 v2 中文原文，不要改写
- 每个任务结束跑一次前端全量，确认没有新增失败（偶发那条除外）

---

### Task 1: 安全网 —— 基线固化 + 移植 DATABASE_URL 修复

**Files:**
- Modify: `backend/database.py`

**Interfaces:**
- Produces: `database._resolve_db_path()` 和模块级 `DB_PATH`。测试隔离依赖 `DB_PATH` 保持模块全局（`backend/tests/test_api.py:22` 用 patch 模块名的方式注入测试库），不要改成 per-call 查找。

- [ ] **Step 1: 确认分支与工作区状态**

```bash
pwd && git log --oneline -2 && git status --short
```

Expected: 处于 worktree 根；HEAD 是 `a32f66f`（spec 提交）+ `13a58ee`；工作区干净

- [ ] **Step 2: 记录后端基线**

```bash
../../.venv/Scripts/python.exe -m pytest backend/tests -q
```

Expected: `179 passed`

- [ ] **Step 3: 记录前端基线**

```bash
cd frontend && npx playwright test
```

Expected: `PASS (73) FAIL (1)`，且唯一失败是 `server-sync.spec.js:162`。若出现别的失败，先停下来报告，不要继续。

- [ ] **Step 4: cherry-pick DATABASE_URL 修复**

```bash
git cherry-pick 370c98c
```

Expected: 干净应用，只动 `backend/database.py`（+20 行）。

若冲突，手工落地这段（`backend/database.py` 顶部，替换原来的 `DB_PATH = Path(__file__).parent / "data" / "marginalia.db"`）：

```python
SQLITE_URL_PREFIX = "sqlite+aiosqlite:///"
DEFAULT_DB_PATH = Path(__file__).parent / "data" / "marginalia.db"


def _resolve_db_path() -> Path:
    """Read the database location from DATABASE_URL.

    aiosqlite wants a plain filesystem path, so strip the SQLAlchemy-style
    prefix. Unset or unrecognised values fall back to the original location,
    which keeps existing deployments pointing at the same file.
    """
    url = (settings.database_url or "").strip()
    if url.startswith(SQLITE_URL_PREFIX):
        candidate = url[len(SQLITE_URL_PREFIX):]
        if candidate:
            return Path(candidate)
    return DEFAULT_DB_PATH


DB_PATH = _resolve_db_path()
```

- [ ] **Step 5: 验证 DATABASE_URL 真的生效**

```bash
cd backend && DATABASE_URL="sqlite+aiosqlite:///$(pwd)/../.tmp-scratch.db" ../.venv/Scripts/python.exe -c "import database; print(database.DB_PATH)"
```

Expected: 打印以 `.tmp-scratch.db` 结尾的路径。**若不是**（仍打印 `backend/data/marginalia.db`），说明修复没生效，停下来修好再继续 —— 否则后续任何 scratch 库验证都会写进真实书库。

验证后删除 `backend/.tmp-scratch.db`（如果生成了）。

- [ ] **Step 6: 后端测试仍绿**

```bash
../../.venv/Scripts/python.exe -m pytest backend/tests -q
```

Expected: `179 passed`

- [ ] **Step 7: Commit（仅当 Step 4 走了手工路径）**

```bash
git add backend/database.py
git commit -m "Honour DATABASE_URL when locating the SQLite file

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2: book-chat 落地

**Files:**
- Create: `frontend/book-chat/app.js`、`frontend/book-chat/index.html`、`frontend/book-chat/style.css`
- Create: `frontend/tests/book-chat.spec.js`
- Modify: `frontend/index.html`（书库页入口）、`frontend/sw.js`（预缓存清单 + 导航回退 + 缓存名）

**Interfaces:**
- Consumes: 后端 `/api/books`、`/api/books/upload`、`/api/books/{id}/file`、`/api/books/{id}/sync`（本线全部已存在）
- Produces: 可离线打开的 `/book-chat/` 页面；`sw.js` 缓存名 `marginalia-shell-v26`

- [ ] **Step 1: 拷入 book-chat 三文件**

```bash
mkdir -p frontend/book-chat
cp "$TEMP/marginalia-bookchat-backup-20260922/app.js"   frontend/book-chat/app.js
cp "$TEMP/marginalia-bookchat-backup-20260922/index.html" frontend/book-chat/index.html
cp "$TEMP/marginalia-bookchat-backup-20260922/style.css"  frontend/book-chat/style.css
wc -l frontend/book-chat/*        # 预期 1100 行上下，三文件非空
```

这份副本比 v2 提交版更新：含 `navigateToTarget`、`navigationToken`、`layoutRefreshToken`、`isLayoutRefreshing` 的导航竞态修复，字体栈去掉了 Inter，主题色微调。**不要**改成 v2 提交版。

- [ ] **Step 2: 书库页加入口**

在 `frontend/index.html` 的 `.library-actions` 里、`笔记管理` 按钮**之前**插入（照 v2 的位置）：

```html
          <a class="btn btn-secondary" id="btn-book-chat" href="/book-chat/">GPT 风格阅读</a>
```

- [ ] **Step 3: sw.js 加预缓存 + 导航回退**

三处改动：

1. 缓存名 `marginalia-shell-v25` → `marginalia-shell-v26`
2. `APP_SHELL` 追加三项：

```js
  'book-chat/index.html',
  'book-chat/app.js?v=4',
  'book-chat/style.css?v=3',
```

3. 导航分支加 book-chat 回退。现有代码把**所有** navigate 请求回退到 `index.html`：

```js
  if (
    event.request.mode === 'navigate' ||
    url.pathname.endsWith('/index.html') ||
    ...
  ) {
    event.respondWith(
      networkFirst(event.request).then((response) => (
        response || caches.match('index.html')     // ← 离线时 /book-chat/ 会拿到主应用页面
      ))
    );
    return;
  }
```

改成按路径挑选回退目标：

```js
    const fallback = url.pathname.startsWith('/book-chat/')
      ? 'book-chat/index.html'
      : 'index.html';
    event.respondWith(
      networkFirst(event.request).then((response) => response || caches.match(fallback))
    );
```

注意：v2 的 sw **没有**预缓存 book-chat（离线打开它会显示主应用页面）。这里是有意改进，spec 里已写明。

- [ ] **Step 4: 冒烟验证在线可用**

```bash
cd frontend && python -m http.server 8123 &
sleep 1 && curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8123/book-chat/
```

Expected: `200`。然后用浏览器打开 `http://localhost:8123/book-chat/`，确认：页面渲染出 ChatGPT 风格布局（左侧栏 + 顶栏 + 阅读区），控制台无报错。验证后关掉该服务器。

- [ ] **Step 5: 搬入并适配 book-chat 的验收测试**

```bash
git show impeccable-reader-distill-v2:frontend/tests/book-chat.spec.js > frontend/tests/book-chat.spec.js
```

这份 spec 自带 `page.route('**/api/**')` 模拟，不需要后端，能在本仓库的静态服务器配置下跑。已知需要适配的点：

- 断言里出现的缓存名：v2 写的是 `marginalia-epub-v1`，本线是 `marginalia-epubs-v1`，按本线改
- 若有用例断言主应用导航（从书库点 `#btn-book-chat` 跳转），确认选择器与 Step 2 插入的一致
- 其余按运行结果处理

- [ ] **Step 6: 复核存储键不冲突**

book-chat 用自己的前缀，主应用用 `marginalia.*`：

```bash
grep -oE "marginalia\.[a-zA-Z.]+" frontend/book-chat/app.js | sort -u
grep -oE "localStorage\.(get|set)Item\('[^']+'" frontend/app.js | sort -u | head -20
```

Expected: book-chat 只出现 `marginalia.chatReader.*`（`selectedBookId` / `position.` / `theme`），与主应用的键无重叠。若有重叠，停下报告。

- [ ] **Step 7: 补一条竞态回归用例**

09-20 那批改动（`navigateToTarget` / `navigationToken` / `layoutRefreshToken` / `isLayoutRefreshing`）修的是"侧栏开合与布局刷新打断阅读位置或丢掉进度上报"，v2 没有测试覆盖它。加进刚搬来的 `frontend/tests/book-chat.spec.js` 里，复用该文件顶部的 `mockReaderApi`（它已经记录了 `progressPayloads` 与 `requests`）：

```js
test('sidebar toggling keeps the reading position and still reports progress', async ({ page }) => {
  const api = await mockReaderApi(page);
  await page.goto('/book-chat/');
  await openFixtureInChat(page);            // 沿用该文件既有的打开书籍 helper
  const before = await page.locator('#progress-label').textContent();
  await page.locator('#open-sidebar').click();
  await page.locator('#backdrop').click();
  await expect(page.locator('#progress-label')).toHaveText(before);
  expect(api.progressPayloads.length).toBeGreaterThan(0);
});
```

若该文件没有可复用的"打开书籍"helper，就照抄相邻用例里打开 fixture 的写法。断言意图两条必须保留：位置显示不变、进度上报仍然发出。

- [ ] **Step 8: 跑 book-chat 测试**

```bash
cd frontend && npx playwright test tests/book-chat.spec.js
```

Expected: 全绿（含新增的竞态用例）。记录用例数（用于后续全量对比）。

- [ ] **Step 9: 全量回归 + Commit**

```bash
npx playwright test        # 预期：基线 + book-chat 用例数，无新增失败
cd .. && git add frontend/book-chat frontend/index.html frontend/sw.js frontend/tests/book-chat.spec.js
git commit -m "Land the GPT-style book-chat reader from the unmerged v2 line

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 3: 阅读视图标记与样式整体换成 v2

**Files:**
- Modify: `frontend/index.html`（`#reader-view` 区块整体替换）
- Modify: `frontend/style.css`（阅读区 CSS）
- Delete: `frontend/tests/ai-qa.spec.js`
- Modify: `frontend/tests/mobile-layout.spec.js`、`frontend/tests/reader-boundary.spec.js`、`frontend/tests/diagnostic.spec.js`

**Interfaces:**
- Consumes: Task 2 留下的 `sw.js`（缓存名 v26）
- Produces: 本线 `#reader-view` 的 id 集合 == v2 的 id 集合；AI 面板 / 翻页按钮 / 进度滑块从 DOM 消失

**为什么整块替换而不是逐块插**：实测 `#reader-view` 区块两边差 154 行，差异不只在"多/少"，还在共享部分的结构（v2 的 toolbar 有 `reader-toolbar-leading` + 产品名，同步按钮在工具面板内而非 footer）。逐块插会保留本线结构，v2 的 CSS 就对不上。

- [ ] **Step 1: 建 v2 参照 checkout（后续所有视觉对比都用它）**

```bash
git worktree add .worktrees/v2-reference impeccable-reader-distill-v2
ls .worktrees/v2-reference/frontend/index.html
```

- [ ] **Step 2: 用脚本整块替换 reader-view**

```bash
../../.venv/Scripts/python.exe - <<'PY'
import subprocess
from pathlib import Path

v2 = subprocess.run(
    ['git', 'show', 'impeccable-reader-distill-v2:frontend/index.html'],
    capture_output=True, text=True, check=True).stdout
start_tag = '    <div id="reader-view"'
end_tag = '    <div id="creation-view"'
block = v2[v2.index(start_tag):v2.index(end_tag)]

path = Path('frontend/index.html')
text = path.read_text(encoding='utf-8')
path.write_text(text[:text.index(start_tag)] + block + text[text.index(end_tag):], encoding='utf-8')
print(f'replaced {len(block.splitlines())} lines')
PY
```

Expected: `replaced 182 lines`

- [ ] **Step 3: 校验 id 集合，并清掉被删元素在 app.js 里的引用与绑定**

```bash
ids() { sed -n '/id="reader-view"/,/id="creation-view"/p' "$1" | grep -oE 'id="[a-zA-Z0-9_-]+"' | sort -u; }
ids frontend/index.html > /tmp/now.txt
ids .worktrees/v2-reference/frontend/index.html > /tmp/ref.txt
diff /tmp/now.txt /tmp/ref.txt && echo "ID 集合与 v2 完全一致"
grep -nE 'ai-panel|btn-toggle-ai|btn-nav-(prev|next)|progress-slider|ai-messages' frontend/index.html
```

Expected: 第一行打印「ID 集合与 v2 完全一致」；`grep` **无输出**

**标记删掉了，app.js 里的引用还在 —— 这一步必须同时清掉。** 否则 `dom.btnToggleAi.addEventListener(...)` 之类的 null 解引用会让**整个应用**在初始化时抛错（不只是阅读视图），本任务的全量回归会全线崩。

```bash
grep -nE "dom\.(btnToggleAi|btnCloseAi|aiPanel|aiMessages|aiForm|btnSendAi|aiConversationSelect|btnNewAiConversation|btnDeleteAiConversation|btnRetryAiIndex|aiQuestionInput|aiIndexStatus|btnNavPrev|btnNavNext|progressSlider)" frontend/app.js
```

本线已知的引用点（行号为改动前实测值，清掉前面的会偏移）：

| 行 | 内容 | 处理 |
|---|---|---|
| 135、139、143–148、177–178 | dom 引用块里这些元素的条目 | 删除条目 |
| 5406–5428 | AI 面板的 7 处 `addEventListener` | 删除 |
| 5489、5497 | `dom.progressSlider` 的 input/change 绑定 | 删除 |
| 5573、5578 | `dom.btnNavPrev/Next` 的 click 绑定 | 删除 |
| 696、846、857、874、4069、4076 | `dom.aiPanel.classList` 的面板互斥分支 | 删除这些分支（AI 面板不再属于面板集合） |
| 834 | `dom.btnToggleAi.setAttribute` | 删除 |
| 1937、1990、2070、2317、2325、2331、2342、2346、2367、2372、3830 | `dom.progressSlider` 的启用/禁用/取值 | 删除滑块相关语句；**保留**同一函数里 `dom.progressText` / `dom.pageText` 的读写 |
| 2213–2214 | `dom.btnNavPrev/Next` 的 disabled（已有 null 守卫） | 删除 |

两条规则：

1. **删引用，不删功能。** 被删元素承载的行为若用户仍需要，接到 v2 的对应实现上。进度读数不需要新代码：v2 的标记里 `#progress-text` / `#page-text` 已存在（在目录面板内），本线的 `dom.progressText` / `dom.pageText` 引用与写入逻辑原样可用。
2. **AI 问答整条链路的函数体删除留给 Task 7**，本步只清引用点，保证不运行时抛错。

清完复核：

```bash
grep -nE "dom\.(btnToggleAi|btnCloseAi|aiPanel|btnNavPrev|btnNavNext|progressSlider)" frontend/app.js
```

Expected: 无输出

- [ ] **Step 4: 移植阅读区 CSS**

先把 v2 的 CSS 落到临时文件，然后按块搬进本线 `frontend/style.css`：

```bash
git show impeccable-reader-distill-v2:frontend/style.css > /tmp/v2-style.css
sed -n '877,962p'   /tmp/v2-style.css   # #reader-view / toolbar / chrome-hidden / 工具面板 / 工具按钮态
sed -n '964,1077p'  /tmp/v2-style.css   # 排版面板
sed -n '1122,1125p' /tmp/v2-style.css   # .reader-tool-panel .toolbar-search
sed -n '1271,1422p' /tmp/v2-style.css   # 目录面板 + 位置读数
sed -n '1423,1471p' /tmp/v2-style.css   # 边缘唤起按钮
sed -n '2127,2156p' /tmp/v2-style.css   # chrome reveal
```

同时**删掉**本线里被 v2 取代的旧规则（选择器清单）：

- `.nav-btn`、`.nav-btn-prev`、`.nav-btn-next`（翻页按钮，v2 没有）
- `.progress-slider`、`.progress-info`（进度滑块；v2 用目录面板里的 `#page-text`）
- `.ai-panel`、`.ai-*`（AI 面板整套）
- 与 v2 同名但内容不同的阅读区规则（`.reader-toolbar`、`.reader-tool-panel`、`.reader-tool-actions`、`.reader-main`、`.reader-viewport`、`.reader-footer`、`.notes-panel*`、`.search-panel*`）：**以 v2 的为准替换**

媒体查询里的补充规则不要漏：

```bash
grep -nE "reader-navigator-reveal|reader-notes-reveal|reader-location|page-text|reader-chrome-hidden" /tmp/v2-style.css | sed -n '1,40p'
```

逐一在 v2 里定位所在媒体查询块（已知散落在 2547、2662–2670、2944、3330–3340 附近），按 v2 内容改写本线的对应块。

- [ ] **Step 5: 版本号与缓存名同步**

`frontend/index.html` 里 `app.js?v=N`、`style.css?v=N` 各 +1，`frontend/sw.js` 的 `APP_SHELL` 两项改成同样的串；同时缓存名 `marginalia-shell-v26` → `marginalia-shell-v27`（APP_SHELL 内容变了，不换名会让旧缓存继续命中）。校验：

```bash
grep -oE '(app\.js|style\.css)\?v=[0-9]+' frontend/index.html | sort -u
grep -oE '(app\.js|style\.css)\?v=[0-9]+' frontend/sw.js   | sort -u
grep -n "marginalia-shell-v" frontend/sw.js
```

Expected: 前两条输出完全相同的两行；缓存名是 `marginalia-shell-v27`

- [ ] **Step 6: 删除 AI 问答测试**

```bash
git rm frontend/tests/ai-qa.spec.js      # v2 在 ed90dd0 已删；本线随之删除（4 个用例）
```

- [ ] **Step 7: 适配引用被移除 UI 的三个测试文件**

已知失败点与替换方式（v2 的阅读器没有翻页按钮，翻页走键盘；位置读数在 `#page-text`）：

| 文件:行 | 现状 | 改成 |
|---|---|---|
| `mobile-layout.spec.js:351,352,533,534` | `expect('#btn-nav-prev/next').toBeHidden()` | 删掉这两行断言（v2 无翻页按钮）；若要保留"窄屏不挤压阅读区"的意图，改断言 `#page-text` 可见 |
| `mobile-layout.spec.js:372,374,378,384` | 点 `#btn-toggle-ai` 切换 `#ai-panel` | 点 `#btn-toggle-navigator` 切换 `#reader-navigator` |
| `mobile-layout.spec.js:460` | `#btn-nav-next` 触发翻页 | `await page.keyboard.press('ArrowRight')` |
| `reader-boundary.spec.js:91,99` | 点 `#btn-nav-next/prev` | `press('ArrowRight')` / `press('ArrowLeft')` |
| `reader-boundary.spec.js:208` | 读 `#progress-slider` 的值 | 读 `#page-text` 的「第 N / M 页」 |
| `diagnostic.spec.js:39` | `click('#btn-nav-next')` | `await page.keyboard.press('ArrowRight')` |

参考实现：v2 的 `reader-boundary.spec.js` 里就有这两个 helper（`pressArrowRight` / `pressArrowLeft`，约 96–104 行）与 `getPageInfo`（读 `#page-text`），可直接照抄。

- [ ] **Step 8: 全量前端回归**

```bash
npx playwright test
```

Expected: 无失败（偶发那条除外）；用例总数 = 基线 74 − ai-qa 的 4 + Task 2 的 book-chat 用例数

- [ ] **Step 9: 视觉对比（CSS 是否真的对齐）**

```bash
(cd .worktrees/v2-reference/frontend && python -m http.server 8101 &) ; (cd frontend && python -m http.server 8102 &)
sleep 1
npx playwright screenshot --viewport-size=1280,900 http://localhost:8101/index.html /tmp/ref-lib.png
npx playwright screenshot --viewport-size=1280,900 http://localhost:8102/index.html /tmp/new-lib.png
```

打开两张图对比书库页与阅读器（打开同一本 fixture 后）的观感差异。CSS 漂移就在这里修 —— 以 v2 的规则为准，改到看不出差别为止。验证后关掉两个服务器。

- [ ] **Step 10: Commit**

```bash
git add -A frontend
git commit -m "Replace the reader view with the v2 markup and styles

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 4: 排版面板接线（阅读排版）

**Files:**
- Modify: `frontend/app.js`（常量、状态、helpers、apply/持久化、事件绑定、两个调用锚点）
- Create: `frontend/tests/reader-typography.spec.js`（取自 v2）

**Interfaces:**
- Consumes: Task 3 已就位的标记 `#reader-font-family`、`#reader-font-size`、`#reader-line-height`、`#reader-paragraph-spacing`（含 `-value` / `-label` / 各 reset 按钮）
- Produces: `applyReaderTypographyToDocument(doc)`、`applyReaderTypography({refresh})`、`setReaderFontSize/Family/LineHeight/ParagraphSpacing`；注入 `#marginalia-reader-typography-style`；持久化键 `marginalia.readerTypography`

本线**已有**的：`handleFontZoom`、`currentFontSize`、`FONT_SIZE_STEP/MIN/MAX`、`WHEEL_IDLE_MS`（=420）、`enableIframeTextSelection`、`findReaderIframes`、`getCurrentAnchorCfi`、`refreshReaderLayout`。**没有**：v2 的排版常量、面板状态、helpers、持久化、UI 同步。

- [ ] **Step 1: 加常量与状态**

在 `frontend/app.js` 的阅读器常量区（本线 `FONT_SIZE_MIN/MAX` 一带，约 54–60 行）加入 v2 的排版常量：

```js
  const READER_TYPOGRAPHY_KEY = 'marginalia.readerTypography';
  const READER_FONT_FAMILIES = new Set(['original', 'serif', 'sans', 'kai']);
  const READER_FONT_STACKS = {
    serif: '"Noto Serif SC", "Source Han Serif SC", "Songti SC", SimSun, Georgia, serif',
    sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
    kai: '"Kaiti SC", STKaiti, KaiTi, "楷体", serif',
  };
  const READER_LINE_HEIGHT_DEFAULT = 1.7;
  const READER_LINE_HEIGHT_MIN = 1.2;
  const READER_LINE_HEIGHT_MAX = 2.4;
  const READER_PARAGRAPH_SPACING_DEFAULT = 0.5;
  const READER_PARAGRAPH_SPACING_MIN = 0;
  const READER_PARAGRAPH_SPACING_MAX = 2;
  const READER_SPACING_STEP = 0.1;
  const FONT_ZOOM_DELTA_THRESHOLD = 10;
```

状态（放在 `currentFontSize` 旁边）：

```js
  let currentReaderFontFamily = 'original';
  let currentReaderLineHeight = READER_LINE_HEIGHT_DEFAULT;
  let currentReaderParagraphSpacing = READER_PARAGRAPH_SPACING_DEFAULT;
  let fontZoomAccumulatedDelta = 0;
  let fontZoomResetTimer = null;
```

- [ ] **Step 2: 加排版 helpers 与 apply**

照抄 v2 的实现（`impeccable-reader-distill-v2:frontend/app.js` 的 850–890 行给出 `normalizeReaderFontSize`、`normalizeReaderSpacing`、`formatReaderSpacing`、`updateReaderTypographyUI`、`persistReaderTypographyPreference`；892–927 行是恢复已存偏好；929–945 行是 `applyReaderTypographyToDocument`；946–962 行是 `applyReaderTypography`；964–1000 行是四个 setter）：

```bash
git show impeccable-reader-distill-v2:frontend/app.js > /tmp/v2-app.js
sed -n '850,1010p' /tmp/v2-app.js      # 全部照抄，函数体不要改写
```

四个 setter（`setReaderFontSize/Family/LineHeight/ParagraphSpacing`）签名保持 v2 原样：`(value, { persist = true } = {})`。

- [ ] **Step 3: 接 `applyReaderTypographyToDocument` 到 iframe 初始化**

本线的 `enableIframeTextSelection(doc)` 目前**先**判断 selection style 已存在就早退。v2 的顺序是：先 `applyReaderTypographyToDocument(doc)`，**再**判断早退 —— 这个顺序不能变，否则重新渲染的 iframe 拿不到排版样式。

v2 版本（`/tmp/v2-app.js` 3646 行起）：

```js
  function enableIframeTextSelection(doc) {
    if (!doc || !doc.head) return;
    applyReaderTypographyToDocument(doc);
    if (doc.getElementById('marginalia-selection-style')) return;
    ...
```

本线 `enableIframeTextSelection` 约在 3334 行，按上面改。

- [ ] **Step 4: 接 `applyReaderTypography({ refresh: false })` 到渲染初始化**

本线打开书籍的 `renderTo(...)` 之后有一行与其他两线逐字相同的锚点：

```js
      currentRendition = rendition;
      _boundIframeDocuments = new WeakSet();
```

紧跟其后插入（v2 就是这么放的，见 `/tmp/v2-app.js` 2069）：

```js
      applyReaderTypography({ refresh: false });
```

- [ ] **Step 5: 用 v2 的 `handleFontZoom` 替换本线的**

本线的 `handleFontZoom`（约 3313 行）是旧版：直接改 `currentFontSize` 并调 `themes.fontSize`，没有累积阈值、不持久化、不刷新面板。v2 版（`/tmp/v2-app.js` 3621–3643）用 `fontZoomAccumulatedDelta` 累积 + `FONT_ZOOM_DELTA_THRESHOLD` 阈值 + `fontZoomResetTimer`，最后调 `setReaderFontSize(...)`。整函数替换为 v2 版本。

- [ ] **Step 6: dom 引用与事件绑定**

dom 引用（v2 的 160–170 行）：

```js
    readerFontFamily: $('#reader-font-family'),
    readerFontSize: $('#reader-font-size'),
    readerFontSizeValue: $('#reader-font-size-value'),
    btnReaderFontDecrease: $('#btn-reader-font-decrease'),
    btnReaderFontReset: $('#btn-reader-font-reset'),
    btnReaderFontIncrease: $('#btn-reader-font-increase'),
    readerLineHeight: $('#reader-line-height'),
    readerLineHeightValue: $('#reader-line-height-value'),
    btnReaderLineHeightReset: $('#btn-reader-line-height-reset'),
    readerParagraphSpacing: $('#reader-paragraph-spacing'),
    readerParagraphSpacingValue: $('#reader-paragraph-spacing-value'),
    btnReaderParagraphSpacingReset: $('#btn-reader-paragraph-spacing-reset'),
```

事件绑定照抄 v2 的 `bindEvents` 段落（`/tmp/v2-app.js` 5093–5118），粘到本线绑定阅读器控件的地方（本线已有 `dom.btnToggleNotes.addEventListener(...)` 一带，约 5466 行）。

- [ ] **Step 7: 恢复已存偏好**

v2 的恢复函数名是 **`loadReaderTypographyPreference()`**（`/tmp/v2-app.js` 895–927），在阅读器初始化时调用（v2 在 5290 行调它）。照抄函数体，并按 v2 的位置在本线的阅读器初始化路径上调用。

- [ ] **Step 8: 搬入排版测试并跑**

```bash
git show impeccable-reader-distill-v2:frontend/tests/reader-typography.spec.js > frontend/tests/reader-typography.spec.js
npx playwright test tests/reader-typography.spec.js
```

这份 spec 是给 v2 阅读器写的，本线的阅读器现在就是 v2 的形态，**预期能直接跑通**（它用的 `#file-input`、`#toolbar-book-title`、`#page-text`、`#btn-reader-tools`、`#reader-tool-panel` 本线都有）。用例：排版生效 + 阅读锚点保持 + 偏好恢复、Ctrl+滚轮缩小/放大（两条）、旧版仅字号偏好兼容、各目标视口下控件不溢出。

若失败，按失败选择器对照 v2 的标记修 —— 但**不要**改测试意图。

- [ ] **Step 9: 全量回归 + Commit**

```bash
npx playwright test
cd .. && git add frontend && git commit -m "Wire up the v2 reader typography panel

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 5: 目录与书签面板接线

**Files:**
- Modify: `frontend/app.js`（状态、面板开关、TOC 渲染、书签收敛、调用锚点）
- Create: `frontend/tests/reader-navigator.spec.js`

**Interfaces:**
- Consumes: Task 3 已就位的标记 `#reader-navigator`、`#toc-list`、`#btn-toggle-navigator`、`#btn-close-navigator`、`#bookmarks-list`（在面板内）、`#progress-text`、`#page-text`
- Produces: `setReaderNavigatorOpen(open, {restoreFocus})`、`toggleReaderNavigator()`、`renderTableOfContents(items)`、`updateTocActiveState(href)`、`gotoTocItem(item)`、`normalizeReaderHref(value)`

- [ ] **Step 1: 移植四个 TOC 函数**

```bash
sed -n '4276,4381p' /tmp/v2-app.js      # normalizeReaderHref / renderTableOfContents / updateTocActiveState / gotoTocItem
```

照抄到本线阅读器函数区。它们依赖的 `handleLocationChange`、`getCurrentAnchorCfi`、`getLocationCount`、`percentageFromCfi`、`warmLocationsWithProgress`、`showToast`、`currentBookMeta`、`currentBook` 本线都有。

- [ ] **Step 2: 移植面板开关与悬停**

```bash
sed -n '1071,1116p' /tmp/v2-app.js      # setReaderNavigatorOpen / toggleReaderNavigator / cancelReaderNavigatorHoverClose / openReaderNavigatorOnHover / scheduleReaderNavigatorHoverClose
```

以及状态 `let readerNavigatorHoverCloseTimer = null;`（v2 第 109 行）。

- [ ] **Step 3: 把目录面板并入移动端面板互斥**

本线的 `closeMobileReaderPanels()` 里硬编码了面板清单：

```js
    const hadOpenPanel = !dom.aiPanel.classList.contains('collapsed') ||
      !dom.notesPanel.classList.contains('collapsed') ||
      !dom.searchPanel.hidden;
```

AI 面板已随 Task 3 从 DOM 消失，这里必须改（否则 `dom.aiPanel` 为 null 直接报错）：

```js
    const hadOpenPanel = !dom.readerNavigator.classList.contains('collapsed') ||
      !dom.notesPanel.classList.contains('collapsed') ||
      !dom.searchPanel.hidden;
```

同时检查 `closeOtherMobileReaderPanels(except)` 的实现，让它认 `'navigator'`（v2 的 `setReaderNavigatorOpen` 会调 `closeOtherMobileReaderPanels('navigator')`）。

- [ ] **Step 4: 接 TOC 渲染与高亮锚点**

- 书籍载入路径：本线有 `book.loaded.navigation` 块（grep 可定位）。在其中加（v2 的写法）：

```js
      book.loaded.navigation.then((nav) => {
        currentBook._toc = Array.isArray(nav.toc) ? nav.toc : [];
        renderTableOfContents(currentBook._toc);
        updateTocActiveState(currentChapterId);
      }).catch((err) => {
        console.warn('EPUB navigation load failed:', err);
        renderTableOfContents([]);
      });
```

- 章节切换：本线 `handleLocationChange(location)` 里在 `updateChapterLabel(location)` 之后加：

```js
    updateTocActiveState(location.start.href || '');
```

- [ ] **Step 5: 书签收敛到目录面板**

Task 3 的整块替换后，划线面板里的书签区已经不存在（v2 的标记里书签只在目录面板），但**渲染书签的 JS 还在**。确认：

```bash
grep -nE "bookmarksList|bookmarks-count|renderBookmarks|bookmark-item" frontend/app.js | head -20
```

本线的书签函数继续写 `#bookmarks-list`（id 未变，现在在目录面板内），因此通常无需改逻辑；确认没有代码引用已被删掉的划线面板书签容器即可。若发现引用，改为目录面板内的容器。

- [ ] **Step 6: 写目录面板的验收测试**

新建 `frontend/tests/reader-navigator.spec.js`：

```js
import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, 'fixtures', 'multichapter.epub');

async function openFixture(page) {
  await page.goto('/index.html');
  await page.setInputFiles('#file-input', FIXTURE);
  await expect(page.locator('#toolbar-book-title')).toContainText(/multichapter/i, { timeout: 15_000 });
}

async function openNavigator(page) {
  if (await page.locator('#reader-tool-panel').isHidden()) {
    await page.locator('#btn-reader-tools').click();
  }
  await page.locator('#btn-toggle-navigator').click();
  await expect(page.locator('#reader-navigator')).toBeVisible();
}

test.describe('reader navigator', () => {
  test.use({ serviceWorkers: 'block' });

  test('lists chapters, jumps on click, and marks the active one', async ({ page }) => {
    await openFixture(page);
    await openNavigator(page);
    const items = page.locator('#toc-list .toc-item');
    await expect(items.first()).toBeVisible();
    const count = await items.count();
    expect(count).toBeGreaterThan(1);
    await items.nth(count - 1).click();
    await expect(page.locator('#toc-list .toc-item.active')).toHaveCount(1);
    await expect(page.locator('#page-text')).toHaveText(/第\s*\d+\s*\/\s*\d+\s*页/);
  });

  test('keeps bookmarks in the navigator and out of the notes panel', async ({ page }) => {
    await openFixture(page);
    await page.locator('#btn-add-bookmark').click();
    await openNavigator(page);
    await expect(page.locator('#reader-navigator #bookmarks-list')).toBeVisible();
    await page.locator('#btn-reader-tools').click();
    await page.locator('#btn-toggle-notes').click();
    await expect(page.locator('#notes-panel #bookmarks-list')).toHaveCount(0);
  });
});
```

- [ ] **Step 7: 跑测试**

```bash
npx playwright test tests/reader-navigator.spec.js
```

Expected: 2 passed。若目录条数或书签条目选择器与实际不符，按 DOM 实际结构调整，但两条断言意图（有目录且可跳转并高亮 / 书签只在目录面板）必须保留。

- [ ] **Step 8: 全量回归 + Commit**

```bash
npx playwright test
cd .. && git add frontend && git commit -m "Wire up the v2 reader navigator and move bookmarks into it

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 6: 边缘唤起按钮与阅读器打磨

**Files:**
- Modify: `frontend/app.js`、`frontend/style.css`
- Create: `frontend/tests/visual-polish.spec.js`（取自 v2 并适配）

**Interfaces:**
- Consumes: Task 3 已就位的 `#btn-reveal-navigator`、`#btn-reveal-notes`、`#btn-reveal-reader-chrome`；Task 5 的 `setReaderNavigatorOpen`
- Produces: chrome 隐藏时的边缘唤起行为；与 v2 一致的选中工具条与面板观感

- [ ] **Step 1: 接边缘唤起按钮**

v2 的三个 reveal 按钮逻辑在 `impeccable-reader-distill-v2:frontend/app.js`：

```bash
grep -nE "btnRevealNavigator|btnRevealNotes|btnRevealReaderChrome|revealReaderChromeTemporarily" /tmp/v2-app.js | head -20
```

按 v2 绑定到本线对应 dom 与绑定区（`revealReaderChromeTemporarily` 在本线已存在，v2 的版本在 `/tmp/v2-app.js` 798 行附近，如与 v2 有差异以 v2 为准）。

- [ ] **Step 2: 对齐 chrome 自动收起的细节**

对照 v2 的提交 `504ce8b`（Polish reader chrome reveal, panels, and selection toolbar）与 `31cea12`（Polish reader experience and tests）：

```bash
git show 504ce8b -- frontend/app.js
git show 31cea12 -- frontend/style.css
```

把其中属于阅读控制栏 / 面板 / 选中工具条的改动落到本线。**跳过**与本线无关的部分（v2 的书库/笔记管理改动）。

- [ ] **Step 3: 搬入 visual-polish 测试并适配**

```bash
git show impeccable-reader-distill-v2:frontend/tests/visual-polish.spec.js > frontend/tests/visual-polish.spec.js
```

v2 这份有 3 个用例：书库与创作区在目标宽度下的结构、阅读器暖纸面色与无用侧栏列、阅读器安全区/危险色/选中工具条的覆盖范围。其中「创作区（studio）」那条针对的是 v2 的创作页，本线的对应页面是笔记管理工作台 —— 该用例需要按本线结构改写（保留其意图：目标宽度下不溢出、结构不塌），其余两条应可直接跑。

- [ ] **Step 4: 跑测试 + 视觉复核**

```bash
npx playwright test tests/visual-polish.spec.js
```

再用 Task 3 的并排截图法复核阅读器：工具面板展开态、目录面板展开态、chrome 隐藏态、选中一段文字后的工具条，四处与 v2 参照物逐一对比。

- [ ] **Step 5: 全量回归 + Commit**

```bash
npx playwright test
cd .. && git add frontend && git commit -m "Bring over the v2 reader chrome, reveal buttons, and selection polish

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 7: 清理死代码、边界核对与全量验收

**Files:**
- Modify: `frontend/app.js`（删除 AI 问答调用链）、`frontend/style.css`（残留 ai-* 规则）
- Modify: `README.md`、`docs/ARCHITECTURE.md`（若提及 AI 问答/TTS/三视图）

**Interfaces:**
- Consumes: 前六个任务的成果
- Produces: 无死代码的阅读视图；后端接口保持不变（`/api/knowledge/*` 仍在，只是前端不再调用）

- [ ] **Step 1: 删除 AI 问答函数与调用链**

Task 3 已经清掉了这些函数的所有**引用点**（绑定、dom 引用、面板互斥分支），所以现在它们是一批没人调用的死代码。以下函数体全部删除（v2 在 `ed90dd0` 里就是这么做的）：

`addAiMessage`、`askBookQuestion`、`collectBookQaContext`、`createAiConversation`、`deleteCurrentAiConversation`、`jumpToAiCitation`、`loadAiConversations`、`loadAiMessages`、`renderAiConversationOptions`、`renderAiMessages`、`setAiIndexState`、`toggleAiPanel`、`formatKnowledgeStatus`，以及它们在 dom 引用块、事件绑定块中的引用。

- [ ] **Step 2: 核对知识/上传边界（易错点）**

`ensureKnowledgeBook` / `pollKnowledgeStatus` / `recoverMissingKnowledgeBook` 与**导入流程**纠缠。判定标准：

- **必须保留**：`uploadBookToServer`（POST `/api/books/upload`）—— 导入时上传共享书库，book-chat 依赖它
- **保留**：只为索引状态服务的轮询，若被导入流程引用则保留（`app.js:1852` 一带的 `ensureKnowledgeBook(bookMeta)`）
- **删除**：只为 AI 面板服务的重试 / 引用跳转 / 索引状态展示

改完确认导入路径仍然完整：

```bash
grep -nE "uploadBookToServer|/api/books/upload" frontend/app.js
npx playwright test tests/import-ux.spec.js tests/server-sync.spec.js
```

Expected: 两处引用仍在；两个 spec 通过（`server-sync` 那条偶发除外）

- [ ] **Step 3: 清残留样式**

```bash
grep -nE "^\.ai-|ai-panel|ai-messages|progress-slider|nav-btn" frontend/style.css frontend/app.js
```

Expected: 无输出。若有，清掉。

- [ ] **Step 4: 全量前端回归**

```bash
cd frontend && npx playwright test
```

Expected: 无失败（偶发那条除外）。与 Task 1 基线对比，确认减少的用例数 == 4（ai-qa），增加的是 book-chat + reader-typography + reader-navigator + visual-polish 的用例数。

- [ ] **Step 5: 后端回归（应当完全没动）**

```bash
cd .. && ../../.venv/Scripts/python.exe -m pytest backend/tests -q
```

Expected: `179 passed`

- [ ] **Step 6: 离线实测（sw 缓存改动）**

起本线前端静态服务器，浏览器打开 `http://localhost:8123/index.html`，等 service worker 安装完成，然后 DevTools 切 Offline，刷新：

- 主应用应正常加载（APP_SHELL 命中）
- 打开 `/book-chat/` 应加载 book-chat 页面（Task 2 的导航回退生效）——**若显示主应用页面，说明回退没生效，回去修 sw.js**

- [ ] **Step 7: 文档一致性**

```bash
grep -nE "AI 问答|AI 问答面板|TTS|朗读|知识问答|book-chat|GPT" README.md docs/ARCHITECTURE.md
```

按实际状态改写：AI 问答/TTS 已不在前端；`/book-chat/` 已恢复；阅读器有排版面板与目录书签。

- [ ] **Step 8: 收尾提交**

```bash
git add -A && git commit -m "Drop the retired AI panel plumbing and refresh the docs

Co-Authored-By: Claude Code <noreply@anthropic.com>"
git log --oneline -8
```

- [ ] **Step 9: 清理参照 checkout**

```bash
git worktree remove .worktrees/v2-reference
git worktree list
```

Expected: 只剩主仓库与 `notes-management-implementation` 两个条目

---

## 完成标准

1. `#reader-view` 的 id 集合与 v2 完全一致，AI 面板 / 翻页按钮 / 进度滑块在前端彻底消失
2. 排版面板（字体 / 字号 / 行高 / 段距，含重置与持久化）、目录与书签面板、边缘唤起按钮可用
3. `/book-chat/` 在线可访问、离线可打开
4. 笔记管理行为与后端 `179 passed` 均未改变
5. 前端全量通过（偶发那条除外），v2 的四套 spec（book-chat、reader-typography、visual-polish、reader-navigator）在其中
6. 后端 `/api/knowledge/*` 接口与数据原样保留，仅前端不再调用