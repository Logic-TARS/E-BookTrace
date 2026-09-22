# 阅读视图返工与 book-chat 恢复设计

日期：2026-09-22
分支：`reader-rework`（基于 `notes-management-implementation` @ 13a58ee）
状态：待评审

## 背景

三条线都从 `main` 的 `77296b1` 前后切出，但只有一条走到了现在：

| 分支 | tip | 内容 |
|---|---|---|
| `impeccable-reader-distill-v2` | `ed90dd0` | 阅读器打磨（排版面板、目录与书签、边缘唤起）、`/book-chat/` 页面、v2 版笔记管理；**从未并入 main** |
| `notes-management-implementation` | `13a58ee` | 笔记管理完整实现（40+ 提交、notes API、30 个前端用例）；基于 plan 提交 `6b14d93` |
| `notes-management` | `4129234` | 同一计划的另一条平行实现（前端精致 UI），未采用 |

根因：笔记管理分支从 `main` 切出而非从 v2 切出，而 `main` 上既没有 v2 的阅读器打磨，也没有 `/book-chat/`。因此两份笔记管理实现都缺这两样。设计文档 `2026-09-20-notes-management-design.md` 写明"`/book-chat/` 的共享书库和进度同步行为必须保持不变"，但分支上根本不存在 book-chat —— 该约束被静默违反。

另有一份**未跟踪**的 book-chat 副本留在工作区（`frontend/book-chat/`，2026-09-20 16:37 修改），比 v2 提交版更新：含 `navigateToTarget`、`navigationToken`/`layoutRefreshToken`/`isLayoutRefreshing` 的布局刷新与导航竞态修复，以及字体栈（去掉 Inter）和主题色调整。它是唯一副本，任何 checkout/clean 都可能让它消失。

## 目标

- 主应用阅读视图（`#/reader`）整体采用 v2 的形态
- `/book-chat/` 页面落地并可访问，用它最新的那份副本
- 笔记管理保持实现线现有行为不变

## 非目标

- **创作工作台 Studio**：路由 `#/studio`、素材/感悟/草稿三栏、Obsidian 导出前端 —— 本次不做
- TTS / 朗读跟随：v2 自己在 `ed90dd0` 已退休
- v2 的搜索加固（`c21fe59`）与 v2 版笔记管理实现
- 当前 `notes-management` 分支上的精致 UI：不采用（该分支原样保留，不删不推）
- 后端 `/api/knowledge/*`：保留代码与数据，仅前端不再调用

## 决策记录

| 决策 | 选择 |
|---|---|
| 笔记管理基线 | `notes-management-implementation` @ 13a58ee |
| 阅读视图 | 整体采用 v2 形态，包含去掉 AI 问答面板、上一页/下一页按钮、进度滑块 |
| 书签归属 | 收敛进"目录与书签"面板，划线面板不再重复展示 |
| book-chat 版本 | 工作区未跟踪副本（更新，含竞态修复） |
| Studio | 暂不做 |

## 来源清单

| 内容 | 来源 |
|---|---|
| 阅读视图标记 / 样式 / JS | `impeccable-reader-distill-v2`（`ed90dd0`、`38d572c`、`504ce8b`、`31cea12`、`bb7f0e1`） |
| book-chat 页面 | 工作区 `frontend/book-chat/`（未跟踪副本）；备份在 `%TEMP%/marginalia-bookchat-backup-20260922/` |
| 阅读侧验收测试 | v2 的 `reader-typography.spec.js`(267 行)、`visual-polish.spec.js`(247 行)、`book-chat.spec.js`(540 行)、`helpers/reader-ui.mjs` |
| `DATABASE_URL` 修复 | `notes-management` 的 `370c98c`（`_resolve_db_path()`） |
| 笔记管理 | 实现线现成，不动 |

## 设计

### 1. 分支与工作方式

- 新分支 `reader-rework` 从实现线 `13a58ee` 切出，在现有 worktree（`.worktrees/notes-management-implementation`）里工作，工作区干净
- 动手前先做两件事：
  1. 把工作区那份未跟踪的 book-chat 纳入版本控制（唯一副本）
  2. 移植 `370c98c`：实现线的 `backend/database.py` 是硬编码 `DB_PATH`，缺了它测试会写到真实书库 `backend/data/marginalia.db`

### 2. 阅读视图替换

**补（v2 有、实现线无）**

- 阅读排版面板：字体（原书排版 / 宋体 / 黑体 / 楷体）、字号、行高、段距，各带 +/−/重置；注入 rendition 样式 `marginalia-reader-typography-style`；持久化键 `marginalia.readerTypography`
- 目录与书签面板：`reader-navigator`、`toc-list`、`bookmarks-heading`、书签列表；开关 `btn-toggle-navigator` / 关闭 `btn-close-navigator`（当前阅读器**连目录都没有**，这是最大缺口）
- 边缘唤起：`btn-reveal-notes`、`btn-reveal-navigator`
- 控制栏自动收起的悬停/揭示细节、面板与选区工具条打磨（取 v2 版本）

**去（实现线有、v2 无）**

- AI 问答面板标记：`ai-panel`、`ai-messages`、`ai-form`、`ai-question-input`、`ai-conversation-select`、`ai-index-status`、`btn-toggle-ai`、`btn-close-ai`、`btn-send-ai`、`btn-new-ai-conversation`、`btn-delete-ai-conversation`、`btn-retry-ai-index`
- AI 相关 JS：`addAiMessage`、`askBookQuestion`、`collectBookQaContext`、`createAiConversation`、`deleteCurrentAiConversation`、`jumpToAiCitation`、`loadAiConversations`、`loadAiMessages`、`renderAiConversationOptions`、`renderAiMessages`、`setAiIndexState`、`toggleAiPanel`、`formatKnowledgeStatus`
- 上一页/下一页按钮（`btn-nav-prev`、`btn-nav-next`）、进度滑块（`progress-slider`）
- `frontend/tests/ai-qa.spec.js`（404 行）
- 同步按钮回到 v2 的工具面板位置（实现线把它放在 toolbar，两者 id 都是 `btn-sync`）

**知识/上传路径的边界（易错点）**

`ensureKnowledgeBook` / `pollKnowledgeStatus` / `recoverMissingKnowledgeBook` 与**导入流程**纠缠：`uploadBookToServer`（`/api/books/upload`，导入时调用）是 book-chat 共享书库所依赖的路径，必须保留；`ensureKnowledgeBook`（`/api/knowledge/books/upload`）既有 AI 问答用途，也挂在打开书籍的流程里（`app.js:1852`）。

处理原则：

- 保留：导入 / 上传到共享书库的完整路径（`uploadBookToServer` → `/api/books/upload`）
- 移除：只服务 AI 问答的调用（面板自身的重试、索引状态轮询、引用跳转）
- 判定：动手前先确认哪些测试依赖索引状态（如 `import-ux.spec.js`、`server-sync.spec.js`），有依赖的保留其索引职责

**拼装规则（关键约束）**

- `#reader-view` 区块的标记整体以 v2 为准
- 143 个同名函数中，凡笔记管理 / 同步身份相关的（`applyNotesBatch`、`applyLocalNoteOperation`、`applyServerBookState`、别名合并、pending 队列）**保留实现线版本**；v2 的阅读器代码改为调用这些接口，而不是自带一套
- 阅读侧独占函数（排版、目录面板、悬停关闭等）取 v2 版本
- 判定方法：同名函数按"是否被笔记管理调用"归类；两套测试是最终裁决

### 3. book-chat 落地

- 工作区副本三文件落到 `frontend/book-chat/`（`index.html` 用 `style.css?v=3` / `app.js?v=4`）
- 书库页入口照 v2 位置：`<a class="btn btn-secondary" id="btn-book-chat" href="/book-chat/">GPT 风格阅读</a>`
- `sw.js`：`APP_SHELL` 加入 `book-chat/index.html`、`book-chat/app.js?v=4`、`book-chat/style.css?v=3`；缓存名 `marginalia-shell-v25` → `v26`；`marginalia-epubs-v1` 不动
- 依赖核对（实现线均已具备）：`/api/books`、`/api/books/upload`、`/api/books/{id}/file`、`/api/books/{id}/sync`
- 存储键前缀 `marginalia.chatReader.*`，实现时复核与主应用键不冲突

### 4. 版本号约束

`index.html` 内引用的 `app.js?v=N` / `style.css?v=N` 必须与 `sw.js` 的 `APP_SHELL` 清单一致（v2 的 `notes-management.spec.js` 就有这条断言）。

## 验收

前置：实测两条基线 —— 实现线前端 `cd frontend && npx playwright test`、后端 `pytest`（记忆中的 25/1 与 98/1 是**当前线**的数字，实现线的未测过）。

- 实现线现有套件继续全绿（笔记管理 30 个用例是主要守卫）
- 搬入并适配 v2 阅读侧测试：`reader-typography.spec.js`、`visual-polish.spec.js`、`book-chat.spec.js` + helpers
- 新增：book-chat 侧栏开合不打断阅读位置与进度上报（09-20 竞态修复无测试覆盖）
- 手工验证：sw 缓存改动后离线加载一次

## 风险与回退

| 风险 | 说明 | 应对 |
|---|---|---|
| 阅读器生命周期加固被换掉 | 实现线 40 个提交里的路由队列、失败恢复、pending 高亮对账随阅读器替换而重写 | 30 个笔记用例作守卫，失败即在此处对齐 |
| 跨边界同名函数归属 | 143 个同名函数中差异微妙的那些 | 逐个判定 + 两套测试裁决 |
| v2 测试按 v2 标记编写 | 阅读视图既定采用 v2，标记匹配度较高；书库/路由断言需适配 | 先跑一遍看失败面再决定逐条适配还是重写 |
| 索引路径误删 | `ensureKnowledgeBook` 同时服务导入与问答 | 保留上传路径，移除前确认测试依赖 |
| sw 缓存版本 | 改错会让 PWA 卡旧缓存 | 版本号同步 + 离线实测 |

**回退**：全部工作在独立分支 `reader-rework`，不影响 `notes-management`、`main` 与实现线的既有提交；随时可弃。