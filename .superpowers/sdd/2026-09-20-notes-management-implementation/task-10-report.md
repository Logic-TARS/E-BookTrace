# Task 10 report — repair round 3/5

## Status
修复最后 open finding：离线混合选择包含 legacy 无 `book_id` 时，整个批量操作在任何本地写入前失败。

## 修复内容
- `applyNotesBatch()` 在离线/本地 fallback 前执行全量 `notes.every(note => note.book_id)` 校验；任一缺失立即失败，不写 IndexedDB、不写 sync_queue。
- `applyLocalNoteOperation()` 仍在任何本地写入/删除前校验 `book_id`。
- 新增混合批量测试，验证正常记录和 legacy 记录均保持原状态且队列为空。
- offline reconnect 测试现在在 protocol v2 sync 完成后读取 IndexedDB，并断言对应 `sync_queue` 已消费删除。
- 未实现 Task 11 Markdown UI。

## 精确验证结果
- `npm test -- tests/notes-management.spec.js --grep "batch|select all|trash|restore|permanent|empty trash|mixed offline"` — 8 passed。
- `npm test -- tests/notes-management.spec.js` — 27 passed。
- `npm test -- tests/server-sync.spec.js` — 4 passed。
- `npm test -- tests/mobile-layout.spec.js --grep "notes|highlight"` — 1 passed。
- `node --check frontend/app.js` — passed。
- `node --check frontend/tests/server-sync.spec.js` — passed。
- `node --check frontend/tests/notes-management.spec.js` — passed。
- `git diff --check` — clean。

## 后端 pytest
本轮未修改后端；前轮已记录后端 pytest 因当前 Python 3.9 不支持项目 `date | None` 类型语法而无法收集。

## Commit
待提交。
