# Task 10 report — repair round 4/5

## Status
修复两个 Important：在线 batch legacy 记录兼容，以及 reconnect 测试的 IndexedDB 事务等待。

## 修复内容
- `book_id` 全量预校验仅保留在离线/local fallback 分支；在线 batch API 仍可使用 legacy 记录的 server/client ID。
- 新增在线 legacy batch 测试，验证请求携带 server ID 并成功添加标签。
- server-sync offline reconnect 测试的 `page.evaluate` 现在返回并等待 transaction `oncomplete` Promise，完成后才触发 online。
- 保留 sync 完成后的 `sync_queue` 消费删除断言。
- 未实现 Task 11 Markdown UI。

## 精确验证结果
- `npm test -- tests/notes-management.spec.js --grep "batch|select all|trash|restore|permanent|empty trash|mixed offline"` — 9 passed。
- `npm test -- tests/notes-management.spec.js` — 28 passed。
- `npm test -- tests/server-sync.spec.js` — 4 passed。
- `npm test -- tests/mobile-layout.spec.js --grep "notes|highlight"` — 1 passed。
- `npm test -- tests/notes-management.spec.js --grep "online batch accepts"` — 1 passed。
- `npm test -- tests/server-sync.spec.js --grep "offline trash"` — 1 passed。
- `node --check frontend/app.js` — passed。
- `node --check frontend/tests/server-sync.spec.js` — passed。
- `node --check frontend/tests/notes-management.spec.js` — passed。
- `git diff --check` — clean。

## 后端 pytest
本轮未修改后端；前轮已记录当前 Python 3.9 不支持项目 `date | None` 类型语法，后端 pytest 无法收集。

## Commit
待提交。
