# Task 8 报告：在线查询、离线回退、筛选、分页与待同步视图

## 状态
已完成并提交。

## 提交
`3f3858c Load notes with offline fallback`

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
- `npm test -- tests/notes-management.spec.js --grep "online|offline|search|filter|sort|pagination|pending"`：未能启动，Playwright webServer 配置引用 `..\\.venv\\Scripts\\python.exe`，当前 Windows 工作区该路径不存在（系统报告找不到路径）。

## 关注点
- 由于测试 HTTP server 未能启动，新增浏览器用例未完成运行验证；需要在具有可用 `.venv/Scripts/python.exe` 的环境重跑。
- 本次严格限定在 Task 8 brief 指定的数据加载层；未实现详情、批量操作或最终 Markdown 导出逻辑。
- 工作区提交包含 `frontend/app.js`、`frontend/index.html`、`frontend/tests/notes-management.spec.js`；helper 未改动。
. 
