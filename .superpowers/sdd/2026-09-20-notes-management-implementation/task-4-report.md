# Task 4 实施报告：事务化批量标签与回收站 API

## 状态

已实现 Task 4，范围严格限于批量标签、回收站数据库操作、四个 API 路由、旧 JSON export 刷新及相应测试；未修改旧 `DELETE /api/highlights/{id}` 的永久删除语义，未实现 sync v2 或前端。

## 实现

- 新增 `backend/notes.py` 的 `normalize_note_tags()`：去除首尾空白、忽略空标签、按首次出现顺序去重。
- 新增数据库接口：
  - `batch_update_note_tags()`
  - `batch_trash_notes()`
  - `batch_restore_notes()`
  - `batch_delete_notes()`
- 每个批量数据库操作均使用单连接、显式 `BEGIN IMMEDIATE`，在同一事务中完成：
  1. 查询 `operation_id` 历史结果；
  2. 校验规范请求的 SHA-256；
  3. 校验全部记录状态；
  4. 修改数据；
  5. 写入 `note_batch_operations.result_json`；
  6. commit；任何异常 rollback。
- 同 `operation_id` 与同规范请求直接返回首次持久化的 `result_json`，不重新执行；请求内容或操作类型不同则抛出 `NoteBatchConflict`。
- 状态规则：
  - tags：只允许全部为 active；不存在或已进回收站的任一 ID 使整批回滚。
  - trash：active 使用同一 UTC `deleted_at`；已删除或不存在计入 `unchanged`。
  - restore：清空回收站记录的 `deleted_at`；active 或不存在计入 `unchanged`。
  - delete：只永久删除回收站记录；存在 active ID 时 409 且整批回滚；不存在计入 `unchanged`。
- 新增四个 `POST /api/notes/batch/{tags,trash,restore,delete}` 路由，统一返回 `operation_id/affected/unchanged/items`，冲突映射为 HTTP 409，Pydantic 请求限制继续负责 422。
- 每个成功批量请求在返回前 `await _export_notes()`，确保旧 JSON export 已刷新。

## 严格 TDD 记录

1. `test_notes.py::test_normalize_note_tags_preserves_first_occurrence`
   - RED：`ModuleNotFoundError: No module named 'notes'`。
   - GREEN：`1 passed in 0.02s`（最终复跑 `1 passed in 0.04s`）。
2. 数据库 batch 测试先写后跑：
   - RED：`11 failed, 22 deselected`，均因缺少 `batch_*` 函数或 `NoteBatchConflict`。
   - GREEN：`11 passed, 22 deselected in 1.15s`；最终复跑 `11 passed, 22 deselected in 1.12s`。
3. API batch 测试先写后跑：
   - RED：`6 failed, 11 deselected`，四条路由均返回 405。
   - GREEN：`6 passed, 11 deselected in 1.16s`；最终复跑 `6 passed, 11 deselected, 1 warning in 1.13s`。

## 精确验证结果

在 `G:/Job/Marginalia/.worktrees/notes-management-implementation` 使用 `G:/Job/Marginalia/.venv/Scripts/python.exe`：

- `python -m pytest backend/tests/test_notes.py -q`
  - `1 passed in 0.04s`
- `python -m pytest backend/tests/test_notes_database.py -k "batch" -q`
  - `11 passed, 22 deselected in 1.12s`
- `python -m pytest backend/tests/test_notes_api.py -k "batch" -q`
  - `6 passed, 11 deselected, 1 warning in 1.13s`
- `python -m pytest backend/tests/test_api.py -k "HighlightCrud or NotesExport" -q`
  - `9 passed, 30 deselected, 11 warnings in 1.56s`
- `python -m pytest backend/tests -q`
  - `157 passed, 21 warnings in 10.45s`
- `git diff --check`
  - 退出码 0，无 whitespace error；仅 Git 提示两个测试文件未来可能由 LF 转为 CRLF。

警告均为既有测试基础设施问题：FastAPI TestClient 的 `httpx` 弃用警告，以及旧路由使用 fire-and-forget export 时出现的 `aiosqlite` worker/event-loop-closed 警告；无测试失败。

## 自审

- 事务边界：数据变更与幂等结果写入同一显式事务；触发 `result_json` 写入失败的测试证明标签变更会回滚。
- 幂等：请求哈希包含操作类型和规范化 payload；同 ID 同请求返回首次结果且不重放数据修改；跨操作类型复用 ID 也冲突。
- 原子性：tags 混入不存在/回收站记录、delete 混入 active 记录均在写入前校验，并由测试确认无部分变更。
- 响应：只在 `items` 中返回实际变更或实际删除的 identity rows；`affected` 与 `unchanged` 符合 brief。
- 兼容：旧永久 DELETE 路由及旧 JSON export 回归通过；未触及 sync v2、前端或其他功能。
- 关注点：当前规范请求保留 `ids` 顺序，因此相同 ID 集合但顺序不同会被视为不同请求；brief 只要求“同规范请求”幂等，现有模型也保留首次顺序，故保持这一选择以确保响应 item 顺序稳定。

## 提交

- 提交消息：`Add batch notes management operations`
- 最终提交哈希见交付回复（哈希无法稳定写入其自身提交内容）。
