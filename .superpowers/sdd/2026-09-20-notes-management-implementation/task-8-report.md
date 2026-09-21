# Task 8 报告：在线查询、离线回退、筛选、分页与待同步视图

## 状态
修复轮 3/5 已提交。

## 提交
`be0b8ea Preserve pending highlights during server reconcile`

## 本轮实现
- `applyServerBookState()` 改为基于本地记录、服务器快照和 sync_queue 的 aliases（server_id/client_id/local id）协调；pending upsert/trash/restore/delete 不被旧服务器快照清理或覆盖，queued 状态随后重放。
- 离线搜索补充书名、作者、章节；本地 tags 使用 AND；支持书籍、颜色、类型、回收站和多种排序；离线 facets 从匹配集计算。
- 所有审查到的本地 highlights 读取路径排除 `deleted_at`，包括计数、reader notes、视觉恢复、问答上下文、合并/迁移来源。
- 保留 `loadNotesManagement({ preserveDetail })` hook，并记录 managedNoteKey/draftState 数据属性供 Task 9 使用。
- AI QA 与 notes migration 直接 IndexedDB 打开统一为 v6，并使用 static origin seed/reload。

## 精确测试结果
- `node --check frontend/app.js`：通过。
- `git diff --check`：通过。
- `npm test -- tests/notes-management.spec.js`：首轮 13 passed、1 failed（IndexedDB migration test 超时）；其余 notes 用例通过。
- `npm test -- tests/ai-qa.spec.js`：4 passed。
- `npm test -- tests/server-sync.spec.js`：1 passed。
- `npm test -- tests/mobile-layout.spec.js`：11 passed。

## 关注点
- notes migration 用例偶发/稳定出现 `indexedDB.deleteDatabase` 超时，原因是前序页面连接仍保持打开；这属于测试 fixture 生命周期问题，待后续修复轮处理。
- 本轮未实现详情编辑、批量 API 客户端或 Markdown UI。
