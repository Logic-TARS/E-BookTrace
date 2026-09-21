# Task 8 报告：在线查询、离线回退、筛选、分页与待同步视图

## 状态
修复轮 5/5（最终）已完成并提交。

## 最终提交
`dc5ec61 Make IndexedDB upgrade regression stable`

## 本轮变更
- migration 回归恢复真正的 v5 → v6 流程：先创建 v5 old stores 与 `legacy_notes` 数据，再由应用打开并升级到 DB_VERSION 6；断言版本、旧数据、旧 stores 与新 stores 均保留。
- migration fixture 在静态 origin 上完成明确关闭连接，避免 deleteDatabase 被应用连接阻塞或超时。
- 保留 Task 8 的离线 trash 过滤语义、pending 视图合并、preserveDetail hook；未实现 Task 9/10/11。

## 最终精确测试结果
- `npm test -- tests/notes-management.spec.js`：14 passed。
- `npm test -- tests/ai-qa.spec.js`：4 passed。
- `npm test -- tests/server-sync.spec.js`：1 passed。
- `npm test -- tests/mobile-layout.spec.js`：11 passed。
- `node --check frontend/app.js`：通过。
- `git diff --check`：通过。

## 关注点
- Playwright static HTTP server 日志中的 `/api/*` 404/501 是未安装后端 mock 的既有请求，不影响各测试结果。
- 未实现详情编辑、批量 API 客户端或 Markdown UI。
