# Task 7 报告：笔记管理页面 shell、兼容路由与测试 helper

## 状态

已完成 Task 7，范围严格限制为页面 shell、顶级 hash 路由、IndexedDB v6 无破坏升级、基础响应式样式和测试 helper；未实现笔记数据加载、完整查询、编辑或批量操作。

## 实现

- `frontend/index.html`
  - 将 `#creation-view` 替换为笔记管理静态 shell：页头、筛选、批量操作、列表/分页/详情、回收站操作、两个确认 dialog 与 `aria-live` 状态区。
  - 导航和书库入口改为“笔记管理”。
  - 移除稿件生成、稿件编辑和 Obsidian/JSON 前端入口；后端代码及接口未修改。
  - 阅读侧栏说明改为“展开后可定位原文或编辑感悟”。
- `frontend/app.js`
  - IndexedDB 版本升级为 6；升级过程只补齐 `books/highlights/deleted_highlights/bookmarks/sync_queue` 及现有索引，不删除任何 store。
  - 新增 `getRouteFromHash()`、`navigateToRoute()`、`applyCurrentRoute()`，保留兼容 `showCreation()`。
  - `#/`、`#/reader`、`#/creation` 使用 browser history；监听 `hashchange` 和 `popstate`。
  - 无已打开书籍时访问 `#/reader` 回退 `#/`；打开书籍时写入 `#/reader`。
  - 删除旧创作页对应前端状态、DOM 引用、事件和请求逻辑。
- `frontend/style.css`
  - 增加笔记管理桌面双栏 shell；移动断点隐藏详情区，筛选和批量栏自适应且无横向溢出。
  - 新控件复用现有 token、按钮和 focus 样式，无新字体或依赖。
- `frontend/tests/helpers/notes-management.mjs`
  - 导出 `INDEXED_DB_NAME`、`INDEXED_DB_VERSION = 6`、`makeNote()`。
  - 提供 `seedNotesIndexedDb()`、`readNotesIndexedDb()`、`readSyncQueue()`、`installNotesApiRoutes()`。
  - helper 升级数据库时保留未知旧 store。
- `frontend/tests/notes-management.spec.js`
  - 覆盖管理页 shell、旧入口移除、返回/history、阅读提示、reader 空状态回退与 IDB v6 保留旧 store。
- `frontend/tests/mobile-layout.spec.js`
  - 移动结构断言更新为新 shell，并统一使用 v6 helper 常量。

## TDD 记录

1. 先新增 shell/路由/提示/IDB 测试并执行目标命令。
2. RED：`4 failed`，分别因缺少“笔记管理”标题、URL 未进入 `#/creation`、阅读提示仍为旧文案、数据库仍为 v5。
3. 完成最小实现后目标测试 GREEN。
4. 完整移动回归首次为 `10 passed, 1 failed`；失败定位为测试仍以固定 v5 打开已经升级到 v6 的 IndexedDB。将移动测试改用共享 `INDEXED_DB_VERSION` 后通过，并补充打开书籍必须进入 `#/reader` 的回归断言。

## 测试

- `npm test -- tests/notes-management.spec.js --grep "creation route|history|reader hint"`：`4 passed`
- `npm test -- tests/mobile-layout.spec.js --grep "workspace|creation"`：`1 passed`
- `npm test -- tests/notes-management.spec.js tests/mobile-layout.spec.js`：`15 passed`
- 补充路由回归：`npm test -- tests/notes-management.spec.js --grep "creation route|history|reader route|reader hint"`：`5 passed`
- 补充阅读导入回归：`npm test -- tests/mobile-layout.spec.js --grep "exact highlight"`：`1 passed`
- `node --check app.js && node --check tests/helpers/notes-management.mjs && node --check tests/notes-management.spec.js`：通过
- `git diff --check`：通过

## 关注点

- 页面控件当前为静态 shell，除顶级导航外未绑定查询、导出、编辑、回收站或批量行为；这些明确留给 Task 8 及后续任务。
- 本机 Playwright 配置中的 webServer 相对路径与当前 worktree 层级不匹配；验证时使用仓库根 `.venv` 手动启动 `python -m http.server 8099`，测试本身均通过。

## 修复轮 1/5

- 将 `applyCurrentRoute()` 收窄为读取 hash 并串行调度路由转换；`transitionToRoute()` 以 `currentRoute` 去重，同一路由的 `popstate`/`hashchange` 重复通知不再重复生命周期。
- 将 reader 离开时的保存进度、同步入队、销毁 EPUB 和状态清理拆到 `leaveReader()`，只在路由从 `/reader` 离开时执行一次；`renderRoute()` 只切换顶级 view 及对应导航 UI。
- `openBook()` 仅通过 `navigateToRoute('/reader')` 应用 reader view，不再额外调用 view 更新函数。
- 清理已无 DOM 使用的 `.draft-actions`、`.reflection-actions` CSS selector。
- 测试 helper 只对 JSON 请求解析 `postDataJSON()`，并补充 book sync GET mock，以支持真实 reader history 回归。

### 修复轮 TDD 与测试

- 新增 `one history navigation leaves reader once`：通过拦截真实 IndexedDB `sync_queue.put()`，验证一次 browser history 离开 reader 只写入一次 `progress.set`。修复前 RED 为 `Expected: 1, Received: 2`；修复后 `1 passed`。
- `npm test -- tests/notes-management.spec.js --grep "creation route|history|reader hint"`：`5 passed`。
- `npm test -- tests/mobile-layout.spec.js --grep "workspace|creation"`：`1 passed`。
- `npm test -- tests/mobile-layout.spec.js --grep "exact highlight"`：`1 passed`。
- `npm test -- tests/mobile-layout.spec.js --grep "exact highlight|uses a full-height reader|turns exactly one page"`：`3 passed`。
- `npm test -- tests/import-ux.spec.js`：`3 passed`。
- `node --check app.js && node --check tests/helpers/notes-management.mjs && node --check tests/notes-management.spec.js && git diff --check`：通过。
- 死 selector 搜索 `draft-actions|reflection-actions`：无匹配。

## 修复轮 2/5

- 路由队列现在分别保留调用者可观察的 `transition` 与内部恢复后的 `routeTransition`；单次转换 reject 会向调用者暴露，同时内部队列通过 catch 恢复，后续请求仍可执行。
- `transitionToRoute()` 仅在 reader 离开、目标 view 渲染和书库渲染全部成功后提交 `currentRoute`。
- 转换失败时恢复到上一条已提交路由的 hash 与顶级 view，并通过 error toast 与 console error 暴露失败；不会留下 hash/view/currentRoute 分裂状态。
- 保留修复轮 1 的同路由去重：重复 `popstate`/`hashchange` 仍不会重复 reader 离开生命周期。

### 修复轮 TDD 与测试

- 新增 `route queue recovers after a failed reader lifecycle`：首轮通过 IndexedDB hook 强制 reader 保存进度失败，验证错误可见且恢复为 `#/reader`/reader view；再次导航成功进入 `#/creation`。修复前 RED 为找不到“页面切换失败”且队列保持 rejected；修复后 `1 passed`。
- `npm test -- tests/notes-management.spec.js --grep "route queue recovers|one history navigation|reader route without"`：`3 passed`。
- `npm test -- tests/notes-management.spec.js --grep "creation route|history|reader hint|route queue"`：`6 passed`。
- `npm test -- tests/import-ux.spec.js`：`3 passed`。
- `npm test -- tests/mobile-layout.spec.js --grep "workspace|creation|exact highlight|uses a full-height reader|turns exactly one page"`：`4 passed`。
- `node --check app.js && node --check tests/notes-management.spec.js && git diff --check`：通过。

## 修复轮 3/5

- `applyCurrentRoute()` 记录当前执行中或待处理的 `pendingRoute` 与对应 promise；相同目标的 `popstate`/`hashchange` 通知直接复用同一个转换，不再追加陈旧副本。
- 转换 promise settle 后仅在仍对应当前 pending transition 时清理去重状态，因此失败恢复后的新用户导航意图仍会创建并执行新的转换。
- 保留修复轮 1 的单次生命周期去重及修复轮 2 的失败恢复、队列不 poisoning、hash/view/currentRoute 一致性。

### 修复轮 TDD 与测试

- 新增 `duplicate history notifications do not replay a failed route target`：真实同步派发 `popstate` 与 `hashchange`，首次 reader lifecycle 强制失败；修复前 RED 为 reader view 丢失，证明陈旧重复目标被重放；修复后保持 `#/reader`/reader view，随后新导航成功进入 `#/creation`，`1 passed`。
- `npm test -- tests/notes-management.spec.js --grep "one history navigation|route queue recovers|duplicate history notifications"`：`3 passed`。
- `npm test -- tests/notes-management.spec.js --grep "creation route|history|reader hint|route queue|duplicate history"`：`7 passed`。
- `npm test -- tests/import-ux.spec.js`：`3 passed`。
- `npm test -- tests/mobile-layout.spec.js --grep "workspace|creation|exact highlight|uses a full-height reader|turns exactly one page"`：`4 passed`。
- `node --check app.js && node --check tests/notes-management.spec.js && git diff --check`：通过。
