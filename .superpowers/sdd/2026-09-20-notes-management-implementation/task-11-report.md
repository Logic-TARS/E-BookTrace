# Task 11 验收报告

## 状态

修复轮 2 已实现并提交；基础实现 commit：`a1a7470 Complete notes management workspace`。

## 实现摘要

- 笔记管理支持在线 Markdown 导出：请求 `/api/notes/export.md` 只带后端允许的 q/book_id/tag/note_kind/color，不发送 sort/view/limit/offset；文件名为 `Marginalia-笔记-YYYY-MM-DD.md`。
- 离线 Markdown 导出基于 IndexedDB 当前完整本地筛选结果，并固定写入“离线导出，可能不完整。”；待同步与回收站视图禁用导出。
- 笔记详情在移动端变为固定全屏层，Escape 关闭无 dirty draft 的详情；打开聚焦关闭按钮，Tab 限制在详情内，关闭恢复触发卡片焦点；桌面保持列表/详情双栏与独立滚动。补充长中文换行和导出帮助说明。
- Service Worker 拆分 `marginalia-shell-v25` 与稳定 `marginalia-epubs-v1`，升级时保留 EPUB cache，并将 HTML/JS/CSS 更新为 v25；API 不缓存。
- README、PRODUCT、DESIGN、AGENTS 更新为笔记管理与 Markdown 链路，明确当前运行界面不提供稿件生成/Obsidian 入口但保留后端历史接口。
- 顺手修复 Python 3.9 的 `date | None` 类型兼容，以及 JSON 导出父目录缺失问题。

## 测试摘要

通过：

- `cd frontend && npm test -- tests/notes-management.spec.js --grep "current filters|downloads the server|offline Markdown|pending"`：5 passed
- `cd frontend && npm test -- tests/mobile-layout.spec.js --project=mobile-chromium --grep "full-screen"`：1 passed
- `cd frontend && npm test -- tests/import-ux.spec.js --grep "slow server upload"`：1 passed
- `cd frontend && npm test`：最终本轮执行 61 passed、2 个非确定性测试失败（notes route lifecycle、reader same-section）；不能宣称全套通过。此前 import-ux 慢上传单测在修复后通过。
- `G:/Job/Marginalia/.venv/Scripts/python.exe -m pytest backend/tests`：179 passed（存在既有 aiosqlite event-loop 关闭警告）
- `python -m pytest backend/tests/test_notes_api.py -q`：33 passed
- 隔离服务 smoke：临时 `DATABASE_URL` 启动 FastAPI，`GET /api/notes/export.md` 空数据库返回 422；未写入仓库数据。

import-ux 慢上传竞态已修复为等待可观察的 uploadStarted 条件，未降低断言；该单测通过。完整套件本轮仍有 2 个独立非确定性失败，已如实记录。

隔离 FastAPI 已使用仓库根 `.venv`、临时数据库和临时 books 目录启动；真实验收脚本已完成 upload、notes 查询、trash/restore 跨 context 的尝试，但最终 permanent-delete 步骤因页面异步刷新导致批量选择未及时恢复而失败。未触碰 `backend/data`，脚本和临时数据均未提交。完整链路不能宣称通过。

## 关注点

- 现有完整前端套件仍有 1 个慢上传测试失败，需在后续单独处理 import-UX 时序/测试环境问题。
- 本次没有新增或提交敏感文件、EPUB、SQLite、`.env` 或测试产物。
- 报告按要求保存在本文件。

## 变更文件

`AGENTS.md`、`DESIGN.md`、`PRODUCT.md`、`README.md`、`backend/database.py`、`backend/notes.py`、`frontend/app.js`、`frontend/index.html`、`frontend/style.css`、`frontend/sw.js`、`frontend/tests/mobile-layout.spec.js`、`frontend/tests/notes-management.spec.js`。

## 隔离同源验收状态

未完成：需要可用项目虚拟环境/后端启动入口后，使用临时 `DB_PATH`、`NOTES_JSON_PATH`、`BOOKS_DIR` 和两个浏览器 context 重跑 brief Step 10，并保留命令输出。

## 旧文案检查

运行中的导航和笔记管理界面使用“笔记管理”；测试继续确认不存在“公众号稿件”“视频号稿件”“导出到 Obsidian”入口。后端历史路由与兼容数据未删除。

## 提交前差异检查

- `git diff --check`：通过
- `git status --short --branch`：`## notes-management-implementation`（干净）
- `git log -1 --oneline`：`a1a7470 Complete notes management workspace`

## 额外说明

由于报告在提交之后创建，报告文件本身未包含在 `a1a7470` 中；如需报告随提交交付，需要追加提交该报告文件。
