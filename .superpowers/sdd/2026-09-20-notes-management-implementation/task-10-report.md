# Task 10 report — repair round 2/5

## Status
修复 Important/Minor 复审项，补齐失败刷新、legacy 校验、真实跨设备 UI 和离线重连同步回归。

## 修复内容
- 普通 batch 现在检查 `affected`/`unchanged`，`affected=0` 或结果覆盖不完整会视为失败；失败立即重新加载真实列表并保留选择以便重试。
- `applyLocalNoteOperation()` 在任何 IndexedDB 写入/删除前校验 `book_id`；legacy 记录不会被修改，批量失败会显示失败提示。
- empty-trash 已保留逐批处理逻辑：每批失败停止，并通过后续列表刷新读取真实状态。
- 新增两个 browser context 的 notes management UI 测试：设备 A trash，设备 B 进入回收站确认可见并 restore，设备 A reload 后 active view 可见。
- 新增离线 trash 恢复在线后的实际 sync 回归，断言 protocol v2、操作类型、payload 和队列消费链路。
- 清理并修正 helper 的 restore 语义为 `deleted_at = null`。
- 未实现 Task 11 Markdown UI。

## 精确验证结果
- `npm test -- tests/notes-management.spec.js --grep "failed batch|legacy offline"` — 2 passed。
- `npm test -- tests/notes-management.spec.js` — 26 passed。
- `npm test -- tests/server-sync.spec.js --grep "offline trash"` — 1 passed。
- `npm test -- tests/server-sync.spec.js --grep "visible through notes"` — 1 passed。
- `npm test -- tests/server-sync.spec.js` — 4 passed。
- `npm test -- tests/mobile-layout.spec.js --grep "notes|highlight"` — 1 passed。
- `node --check frontend/app.js` — passed。
- `node --check frontend/tests/server-sync.spec.js` — passed。
- `node --check frontend/tests/notes-management.spec.js` — passed。
- `git diff --check` — clean。
- 后端 pytest：`python -m pytest backend/tests/test_notes_api.py backend/tests/test_notes_database.py` 收集失败，环境 Python 3.9 不支持项目使用的 `date | None` 类型语法；该环境限制已如实记录。

## Commit
待提交。
