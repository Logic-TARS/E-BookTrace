# Task 5 实施报告：跨设备回收站同步协议 v2

## 状态

已实现 Task 5，范围限于服务端跨设备同步协议、HTTP 冲突映射和后端测试；未修改前端或 Markdown 功能。

## 实现

- `sync_book_state()` 新增可选 `protocol_version`，并支持 `highlight.trash`、`highlight.restore` 与版本化 `highlight.delete`。
- 无 `protocol_version` 的 `highlight.delete` 保持旧版无条件永久删除。
- `protocol_version >= 2` 时：
  - `highlight.trash` 写入 UTC `deleted_at`；
  - `highlight.restore` 清空 `deleted_at`；
  - `highlight.delete` 仅允许永久删除回收站记录；活动记录触发 `ReaderSyncConflict`。
- trash/restore/delete 找不到记录时为幂等 no-op，但首次 `op_id` 仍写入同步操作表并增加 revision。
- 已处理过的相同 `op_id` 继续直接跳过，不增加 revision。
- 任一 v2 永久删除冲突会回滚请求中此前的进度、删除、op_id 记账和 revision 修改；API 将领域冲突映射为 HTTP 409。
- highlight upsert 的 UPDATE 不涉及 `deleted_at`，INSERT 明确写入 NULL，因此 upsert 不会隐式恢复回收站记录。
- 同步快照继续无状态过滤地返回整书所有 highlights，并包含 `deleted_at`，因此 active 与 trash 均可跨设备同步。
- 整书删除路径未改变，仍永久清理该书 highlights 和阅读状态。

## 严格 TDD 记录

1. 先新增协议测试，再运行：
   - 命令：`python -m pytest backend/tests/test_notes_api.py -k "sync_protocol or legacy_sync" -q`
   - RED：`5 failed, 1 passed, 17 deselected`。
   - 失败原因符合预期：新 trash/restore 操作返回 422、v2 active delete 错误返回 200、upsert 测试无法进入 trash 状态；旧协议永久删除测试已通过。
2. 最小实现后复跑：
   - GREEN：`6 passed, 17 deselected`。
3. 补充同一请求先删除 trash、后冲突 active 的原子回滚回归：
   - 该行为由已有事务结构直接满足，单测 `1 passed, 23 deselected`；测试确认 trash 记录未被部分永久删除，状态与 revision 保持请求前值。

## 验证结果

在 `G:/Job/Marginalia/.worktrees/notes-management-implementation` 使用 `G:/Job/Marginalia/.venv/Scripts/python.exe`：

- `python -m pytest backend/tests/test_notes_api.py -k "sync_protocol or legacy_sync or cross_device" -q`
  - `7 passed, 17 deselected, 1 warning`
- `python -m pytest backend/tests/test_api.py -k "cross_device_state_sync_is_idempotent or delete_removes_file_and_reader_state" -q`
  - `2 passed, 37 deselected, 1 warning`
- `python -m pytest backend/tests -q`
  - 最终复跑：`164 passed, 21 warnings`
- `git diff --check`
  - 退出码 0，无 whitespace error；仅 Git 提示测试文件未来可能由 LF 转为 CRLF。

警告均为既有测试基础设施问题：FastAPI TestClient 的 `httpx` 弃用警告，以及旧 fire-and-forget export 测试中的 `aiosqlite` worker/event-loop-closed 警告；无测试失败。

## 自审与关注点

- `BookSyncRequest.protocol_version` 已在当前 HEAD 存在，本任务只需确保路由将其传给 library 层，因此 `backend/models.py` 无需产生 diff。
- v2 冲突发生在 op_id 与 revision 持久化前，外层 rollback 覆盖同批次所有既有写入。
- 快照使用 `SELECT * FROM highlights WHERE book_id = ?`，没有 `deleted_at` 过滤，测试同时验证 active 与 trash 可见。
- 未改变整书删除实现，也未触碰旧 `/api/highlights/{id}` 永久删除行为。
- 提交消息：`Add recoverable highlight sync operations`；最终提交哈希见交付回复。

## 修复轮 1/5：同步实体跨字段碰撞

- 修复 finding：旧实现用 `(id = ? OR client_id = ?)` 直接更新或删除，当一个 `entity_id` 同时等于记录 A 的 `id` 和记录 B 的 `client_id` 时会命中两条记录。
- 新增 `_resolve_synced_highlight_id()`，在同书范围内按“精确 `id` 优先，其次 `client_id`”解析并 `LIMIT 1`；trash、restore、v2 delete 后续只按解析出的主键 `id` 操作单条记录。
- v2 delete 只检查解析目标的 `deleted_at`：目标为 active 时返回 409；目标为 trash 时只永久删除该目标，不影响跨字段碰撞记录。
- 严格 TDD：先加入跨字段碰撞测试，RED 为 `3 failed, 25 deselected, 1 warning`，分别证明 trash、restore、delete 会错误影响两条记录；实现后 GREEN 为 `3 passed, 25 deselected, 1 warning`。active 目标 409 的碰撞测试在旧代码下已满足响应断言，因此未计入 RED 选择集，保留作额外回归。
- 修复轮验证命令与精确结果：
  - `python -m pytest backend/tests/test_notes_api.py -k "sync_protocol or legacy_sync" -q`
    - 最终复跑：`11 passed, 17 deselected, 1 warning in 2.31s`
  - `python -m pytest backend/tests/test_api.py -k "cross_device_state_sync_is_idempotent or delete_removes_file_and_reader_state" -q`
    - 最终复跑：`2 passed, 37 deselected, 1 warning in 1.05s`
- 本轮只修改同步实体解析、对应协议测试和本报告；旧协议 delete、整书删除及其他同步语义未改。

## 修复轮 2/5：旧协议永久删除单目标解析

- 修复 remaining finding：无 `protocol_version` 的 `highlight.delete` 不再直接用 `(id = ? OR client_id = ?)` 删除所有匹配记录。
- legacy delete 复用 `_resolve_synced_highlight_id()` 的“精确 `id` 优先，其次 `client_id`”规则，再由 `_delete_synced_highlight()` 只按解析出的主键永久删除一条；仍不检查 `deleted_at`，保持旧协议无条件永久删除语义。
- 严格 TDD：先新增 legacy 跨字段碰撞测试；RED 为 `1 failed, 28 deselected, 1 warning in 0.80s`，旧实现错误删除两条；最小修复后 GREEN 为 `1 passed, 28 deselected, 1 warning in 0.67s`。
- 修复轮验证命令与精确结果：
  - `python -m pytest backend/tests/test_notes_api.py -k "sync_protocol or legacy_sync" -q`
    - 最终复跑：`12 passed, 17 deselected, 1 warning in 2.47s`
  - `python -m pytest backend/tests/test_api.py -k "cross_device_state_sync_is_idempotent or delete_removes_file_and_reader_state" -q`
    - 最终复跑：`2 passed, 37 deselected, 1 warning in 1.04s`
- 本轮只修改 legacy `highlight.delete` 的目标解析、对应测试和本报告；v2 状态机及整书删除未改。
