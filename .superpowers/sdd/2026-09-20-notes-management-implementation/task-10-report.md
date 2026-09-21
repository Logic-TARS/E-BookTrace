# Task 10 report — repair round 1/5

## Status
修复审查提出的协议、离线队列、在线清空回收站、撤销和跨设备流程问题。

## 修复
- 离线 trash/restore/delete 使用 `highlight.trash`、`highlight.restore`、`highlight.delete`，payload 使用协议字段 `deleted_at`，并按 `book_id` 写入 `sync_queue`。
- 离线 undo 不再无条件调用在线 batch API；本地恢复并按书入队。
- 在线 empty trash 分页请求 `/api/notes?view=trash`，每批最多 100 条；离线才读取本地 IndexedDB。
- undo 校验 `affected`，失败后刷新列表并保留可重试状态；批量操作完成/失败都会刷新列表和选择状态。
- 修正测试 helper restore 行为为 `deleted_at = null`。
- 扩展 server-sync mock，断言 protocol v2，并增加两个 browser context 的跨设备 trash/restore 实际状态传播测试。
- 增加离线协议队列与 undo 回归测试。
- 未实现 Task 11 Markdown UI。

## 验证结果
- `node --check frontend/app.js frontend/tests/server-sync.spec.js frontend/tests/notes-management.spec.js` — 通过。
- `npm test -- tests/notes-management.spec.js --grep "batch|select all|trash|restore|permanent|empty trash"` — 6 passed。
- `npm test -- tests/notes-management.spec.js` — 24 passed。
- `npm test -- tests/server-sync.spec.js` — 2 passed。
- `npm test -- tests/mobile-layout.spec.js --grep "notes|highlight"` — 1 passed。
- `git diff --check` — clean。
- 后端回归未能运行：当前系统 Python 3.9 不支持项目使用的 `date | None` 类型语法；工作区未找到可用的 `.venv` Python 解释器。原始命令收集阶段失败，未修改后端代码。

## Commit
待提交。

## 关注点
- `applyLocalNoteOperation()` 保留现有同步协议类型，由 reader sync v2 后端实际接受并应用。
- server-sync 测试通过 mock 的真实状态快照验证设备 A trash、设备 B restore，而不是只检查请求类型。
