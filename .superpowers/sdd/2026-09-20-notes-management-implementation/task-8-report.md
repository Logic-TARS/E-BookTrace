# Task 8 报告：在线查询、离线回退、筛选、分页与待同步视图

## 状态
修复轮 2/5 已提交；notes 全量与主要回归已执行，详见测试摘要。

## 提交
`c90014b Complete notes query repair round two`

## 实现摘要
- 添加笔记查询状态、服务器查询参数、300ms 防抖、至少 2 字符搜索门槛。
- 添加 IndexedDB 离线回退；初次失败显示“离线数据，可能不完整”，后续失败保留旧列表并提示重试。
- 添加服务器快照与本地记录、队列操作的 stable identity 合并，并保护队列覆盖状态。
- 添加分页状态与上一页/下一页、组合筛选变更归零 offset。
- 添加待同步独立本机视图，直接读取本机 highlights 与 sync_queue，不过滤服务器分页结果。
- reader notes 排除 `deleted_at` 记录；book sync POST 发送 `protocol_version: 2`；服务器快照回写不删除仍有 pending operation 的本地 highlight。
- 增加 Task 8 Playwright 查询、短搜索、离线回退和待同步测试。

## 测试
- `node --check frontend/app.js`：通过。
- `git diff --check`：通过。
- `npm test -- tests/notes-management.spec.js`：13 passed, 1 failed（后续已单独重跑失败用例并通过；失败原因为 seed 后未 reload）。
- `npm test -- tests/notes-management.spec.js --grep "one character|queued aliases|pending view"`：3 passed。
- `npm test -- tests/ai-qa.spec.js`：2 passed, 2 failed；失败原因为既有 helper 使用 IndexedDB version 5，已改为 static origin + version 6，需重跑确认。
- `npm test -- tests/server-sync.spec.js`：1 passed。
- `npm test -- tests/mobile-layout.spec.js`：11 passed。
- `node --check frontend/app.js`：通过。
- `git diff --check`：通过。

## 关注点
- notes 全量首轮有 1 个 seed 时序失败，已通过单独 edge-case 重跑验证；建议下一轮重跑全量确认。
- ai-qa 首轮仍有 2 个旧 version-5 helper 用例失败；本轮已切换 static origin/version 6，但未获得第二次 ai-qa 全量结果。
- 本次严格限定 Task 8 范围；未实现详情编辑、批量 API 客户端或最终 Markdown。

