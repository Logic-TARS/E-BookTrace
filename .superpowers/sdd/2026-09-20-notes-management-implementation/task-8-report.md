# Task 8 报告：在线查询、离线回退、筛选、分页与待同步视图

## 状态
修复轮 1/5 已提交；新增测试仍有环境/fixture 阻塞，详见测试摘要。

## 提交
`8717445 Harden notes query fallback and identity merge`

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
- `npm test -- tests/notes-management.spec.js --grep "online|offline|search|filter|sort|pagination|pending"`：webServer 已可启动；新增用例仍未全绿：在线测试曾因 facets/排序 option 缺失超时，短搜索暴露初始化请求计数时序，pending 测试在无稳定 origin 的 seed 阶段出现 IndexedDB SecurityError。随后已补充 facets 默认值、筛选 option、短搜索本地路径和选择清理逻辑，需在稳定浏览器环境重跑确认。
- `node --check frontend/app.js`：通过。
- `git diff --check`：通过。

## 关注点
- 由于测试 HTTP server 未能启动，新增浏览器用例未完成运行验证；需要在具有可用 `.venv/Scripts/python.exe` 的环境重跑。
- 本次严格限定在 Task 8 brief 指定的数据加载层；未实现详情、批量操作或最终 Markdown 导出逻辑。
- 工作区提交包含 `frontend/app.js`、`frontend/index.html`、`frontend/tests/notes-management.spec.js`；helper 未改动。
. 
