# Task 9 报告

状态：修复轮 2/5 已完成并提交。

本轮实现提交：`a15e0c2dd7389da605b4dfba4b320b5669e24c0c` (`a15e0c2`)；上一轮实现提交：`0fc71aecfa54c8b1b7010da0d81d503f7027d89a` (`0fc71ae`)

本轮修复：
- 顶部书库、阅读、返回主界面入口统一经过 `requestNotesNavigation`。
- hashchange/popstate 取消导航时恢复当前 hash 并重新渲染当前 view，避免 URL、currentRoute、view 分裂；后续导航仍可成功。
- 删除感悟检查保存返回值；IDB 保存失败时恢复 dirty 草稿，不显示成功 toast，也不提供撤销按钮。
- 详情补齐 readonly 进度、创建时间、定位信息。
- undo 恢复失败时保留 undo 按钮和状态，支持重试并显示明确失败提示。
- `btnBack` 统一经过 dirty draft 保护；移除 `requestNotesNavigation` 未使用参数。

验证：
- `cd frontend && npm test -- tests/notes-management.spec.js --grep "detail|normalize|unsaved|draft|reflection|undo|history|route"`：14 passed。
- `cd frontend && npm test -- tests/server-sync.spec.js`：1 passed。
- `git diff --check`：通过。

关注点：
- 未实现 Task 10 batch client 或 Task 11 Markdown UI。
