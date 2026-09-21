# Task 11 验收报告

## 状态

修复轮 3 已实现，待提交。本轮覆盖前端筛选协议、Markdown 文件名解析、EPUB 上传竞态，以及两项不稳定 Playwright 测试。

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

- `cd frontend && npm test`：65 passed，exit 0；notes route lifecycle 与 reader same-section 均通过。
- `cd frontend && npm test -- tests/notes-management.spec.js`：35 passed。
- `cd frontend && npm test -- tests/server-sync.spec.js`：4 passed。
- `cd frontend && npm test -- tests/mobile-layout.spec.js --project=mobile-chromium`：12 passed。
- `cd frontend && npm test -- tests/import-ux.spec.js --grep "failed upload|slow server upload"`：2 passed。
- `G:/Job/Marginalia/.venv/Scripts/python.exe -m pytest backend/tests`：179 passed（存在既有 aiosqlite event-loop 关闭警告）。

真实 FastAPI 隔离验收使用仓库根 `.venv`、临时 DB/BOOKS_DIR/Vault 与两个 browser contexts。已验证 upload、reader sync 创建划线、笔记编辑、A trash、B restore、A active、再次 trash，并确认服务端回收站状态。临时脚本在最终永久删除/导出阶段因页面导航竞态中断，故完整端到端链路不能宣称通过；未触碰 `backend/data`，临时脚本已删除。

## 关注点

- 真实同源验收尚未完成最后的永久删除后 Markdown 内容校验；其余跨设备状态步骤已实际走通。
- 本次没有新增或提交敏感文件、EPUB、SQLite、`.env` 或测试产物。
- 报告按要求保存在本文件。

## 变更文件

`AGENTS.md`、`DESIGN.md`、`PRODUCT.md`、`README.md`、`backend/database.py`、`backend/notes.py`、`frontend/app.js`、`frontend/index.html`、`frontend/style.css`、`frontend/sw.js`、`frontend/tests/mobile-layout.spec.js`、`frontend/tests/notes-management.spec.js`。

## 隔离同源验收状态

部分完成：真实 FastAPI 已用 `G:/Job/Marginalia/.venv/Scripts/python.exe` 和临时 DB/BOOKS_DIR/Vault 启动；两个 browser contexts 已完成 upload → sync → 编辑 → trash → restore → active → trash，服务端状态可核验。最终 permanent delete、Markdown 下载内容和回收站排除尚未完成，原因是临时脚本在页面导航竞态中断。

## 旧文案检查

运行中的导航和笔记管理界面使用“笔记管理”；测试继续确认不存在“公众号稿件”“视频号稿件”“导出到 Obsidian”入口。后端历史路由与兼容数据未删除。

## 提交前差异检查

- `git diff --check`：通过。
- `git status --short --branch`：`## notes-management-implementation`（干净）。
- 本轮 commit：`7ea0881 Fix Task 11 notes export and upload races`。

## 额外说明

本报告随 Task 11 修复轮 3 一并提交。
