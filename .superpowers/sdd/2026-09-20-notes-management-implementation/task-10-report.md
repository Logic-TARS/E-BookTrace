# Task 10 report — repair round 5/5 (final)

## Status
修复最终 open finding：在线状态下 batch fetch 失败时，不能对混合 legacy 选择执行本地逐条 fallback，避免部分 IDB/queue 写入。

## 修复内容
- online batch fetch 失败时，若进入任何本地 fallback，先统一校验全部 notes 的 `book_id`。
- 缺少 `book_id` 时整批失败，不修改任何本地记录、不写入 `sync_queue`，显示批量失败提示。
- 在线 batch 正常请求仍允许 legacy 记录使用 server/client ID。
- 保留离线混合选择 atomic 校验。
- 新增 `navigator.onLine=true` 且 batch route abort 的普通+legacy 混合测试，断言 IDB tags 和 sync_queue 均无变化。
- 未实现 Task 11 Markdown UI。

## 精确验证结果
- `npm test -- tests/notes-management.spec.js --grep "batch|select all|trash|restore|permanent|empty trash|mixed offline|fetch failure"` — 10 passed。
- `npm test -- tests/notes-management.spec.js` — 29 passed。
- `npm test -- tests/server-sync.spec.js` — 4 passed。
- `npm test -- tests/mobile-layout.spec.js --grep "notes|highlight"` — 1 passed。
- `node --check frontend/app.js` — passed。
- `node --check frontend/tests/notes-management.spec.js` — passed。
- `node --check frontend/tests/server-sync.spec.js` — passed。
- `git diff --check` — clean。

## 后端 pytest
本轮未修改后端；当前 Python 3.9 不支持项目 `date | None` 类型语法，后端 pytest 收集限制已在前轮报告中记录。

## Commit
待提交。
