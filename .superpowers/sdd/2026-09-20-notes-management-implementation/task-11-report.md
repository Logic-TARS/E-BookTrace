# Task 11 验收报告

## 状态

最终统一修复波次已实现，待提交。本轮修正排序、颜色与 facets 契约，补齐在线 batch 的 IndexedDB 持久更新、pending trash/restore 视图语义和所有 identity aliases 清理。

## 实现摘要

- 笔记管理支持在线 Markdown 导出：请求 `/api/notes/export.md` 只带后端允许的 q/book_id/tag/note_kind/color，不发送 sort/view/limit/offset；响应的 `filename*` 优先于 `filename`，均缺失时才使用日期 fallback。
- UI 的 `highlight` 筛选映射为后端的 `highlight_only`，在线与本地筛选均覆盖仅划线笔记。
- EPUB 导入在 `openBook()` 未完成期间立即为后台上传 Promise 注册 catch；上传失败仍保持正文可读并提供重试。
- 离线 Markdown 导出基于 IndexedDB 当前完整本地筛选结果，并固定写入“离线导出，可能不完整。”；待同步与回收站视图禁用导出。
- 笔记详情在移动端变为固定全屏层，Escape 关闭无 dirty draft 的详情；打开聚焦关闭按钮，Tab 限制在详情内，关闭恢复触发卡片焦点；桌面保持列表/详情双栏与独立滚动。补充长中文换行和导出帮助说明。
- Service Worker 拆分 `marginalia-shell-v25` 与稳定 `marginalia-epubs-v1`，升级时保留 EPUB cache，并将 HTML/JS/CSS 更新为 v25；API 不缓存。
- README、PRODUCT、DESIGN、AGENTS 更新为笔记管理与 Markdown 链路，明确当前运行界面不提供稿件生成/Obsidian 入口但保留后端历史接口。
- 顺手修复 Python 3.9 的 `date | None` 类型兼容，以及 JSON 导出父目录缺失问题。

## 测试摘要

通过：

- `cd frontend && npm test -- tests/notes-management.spec.js`：41 passed。
- `cd frontend && npm test -- tests/server-sync.spec.js`：4 passed。
- `cd frontend && npm test -- tests/mobile-layout.spec.js --project=mobile-chromium`：12 passed。
- `cd frontend && npm test -- tests/import-ux.spec.js --grep "failed upload|slow server upload"`：2 passed。
- `G:/Job/Marginalia/.venv/Scripts/python.exe -m pytest backend/tests`：179 passed，21 个既有 aiosqlite/event-loop 警告。
- `cd frontend && npm test`：70 passed，1 个既有 AI citation 跳转测试失败（静态服务器收到 sync 501 后仍停留 Chapter 1），与本波次改动无关；不得宣称全套通过。

真实 FastAPI 隔离验收使用仓库根 `.venv`、临时 DB/BOOKS_DIR/Vault 与两个 browser contexts。轮 5 脚本已完成 upload、reader sync、A 编辑、双 context trash/restore、permanent delete、API active/trash 空记录、IndexedDB identity/queue 清理和重复删除幂等请求验证；但最终脚本在 export 下载事件阶段因脚本导航状态不正确中断，未取得下载文件内容证据，因此报告不宣称完整链路全部通过。未触碰 `backend/data`，临时脚本已删除。

## 关注点

- 真实同源验收尚未取得最终下载文件读取证据；其余永久删除、双 context UI/API/IDB 清理和重复删除步骤已执行。
- 本次没有新增或提交敏感文件、EPUB、SQLite、`.env` 或测试产物。
- 报告按要求保存在本文件。

## 变更文件

`AGENTS.md`、`DESIGN.md`、`PRODUCT.md`、`README.md`、`backend/database.py`、`backend/notes.py`、`frontend/app.js`、`frontend/index.html`、`frontend/style.css`、`frontend/sw.js`、`frontend/tests/mobile-layout.spec.js`、`frontend/tests/notes-management.spec.js`。

## 隔离同源验收状态

部分完成：真实 FastAPI 已用 `G:/Job/Marginalia/.venv/Scripts/python.exe` 和临时 DB/BOOKS_DIR/Vault 启动；两个 browser contexts 已完成 upload → sync → 编辑 → trash → restore → active → trash → permanent delete，并核验双 context UI/API/IDB 清理及重复删除幂等。Markdown 下载按钮和真实下载文件读取尚未取得证据。

## 旧文案检查

运行中的导航和笔记管理界面使用“笔记管理”；测试继续确认不存在“公众号稿件”“视频号稿件”“导出到 Obsidian”入口。后端历史路由与兼容数据未删除。

## 提交前差异检查

- `git diff --check`：通过。
- `git status --short --branch`：`## notes-management-implementation`（干净）。
- `git diff --check`：通过。
- `git status --short --branch`：`## notes-management-implementation`（干净）。
- 本轮 commit：待提交；最终哈希以交付回复为准。

## 额外说明

本报告记录当前最终统一修复波次；不删除历史后端接口、稿件数据或兼容代码。
