# Marginalia 本机 ZeroTier 精简设计

日期：2026-09-23
状态：待用户评审

## 背景

Marginalia 当前同时包含三类能力：

1. EPUB 阅读、笔记、书签、阅读进度和跨设备同步；
2. GPT 风格的服务器书库阅读器；
3. Docker/Cloudflare 生产部署，以及 EPUB 向量索引、Embedding、LLM 问答和会话。

实际需求只需要前两类。服务运行在一台本机 Windows 主机上，其他设备通过 ZeroTier 私有网络访问。Docker、Cloudflare 和 AI 问答增加了启动依赖、后台任务、配置项、数据库表与维护成本，但不属于目标产品。

本设计将项目收敛为：原生 PWA + FastAPI + SQLite + 本机文件系统，使用 ZeroTier 作为唯一远程访问边界。

## 目标

- 保留主 EPUB 阅读器及本地优先行为。
- 保留服务器书库、阅读进度、书签、划线和笔记同步。
- 保留笔记管理、回收站、Markdown/JSON 导出及 Obsidian 导出。
- 保留 `frontend/book-chat/` 的 GPT 风格视觉与连续阅读能力，正式命名为“GPT 风格阅读器”。
- 删除 AI 问答、向量索引、Embedding、LLM 会话及 AI 稿件生成运行路径。
- 删除 Docker 与 Cloudflare 部署路径。
- 通过明确配置的 ZeroTier IP 启动服务，不监听普通局域网或所有网卡。
- 保留无 Docker 的本机备份、恢复校验和计划任务。
- 升级时不自动删除已有 AI 数据表，避免破坏既有数据库。

## 非目标

- 不增加账号、密码或应用层登录认证。
- 不支持公网直接访问。
- 不支持普通局域网地址访问。
- 不把 GPT 风格阅读器改成聊天产品，也不增加任何模型调用。
- 不在本次工作中重构主前端的单文件结构。
- 不自动清除历史 AI 数据；历史表清理由用户显式执行独立维护命令。
- 不移除纯规则脚本生成能力；它不调用 LLM，可继续作为兼容后端能力存在。

## 决策记录

| 事项 | 决策 |
|---|---|
| 精简强度 | 按功能边界彻底删除无用运行代码、接口、依赖和部署文件 |
| GPT 风格阅读器 | 保留视觉和阅读功能，删除聊天语义，入口名称为“GPT 风格阅读器” |
| 远程访问 | 仅绑定显式配置的 ZeroTier IP |
| API 认证 | 不新增认证，ZeroTier 网络作为访问边界 |
| 数据迁移 | 停止创建和访问 AI 表，但不自动 DROP 历史表 |
| Docker/Cloudflare | 完全移除 |
| 备份 | 改为直接备份 `backend/data/`，保留完整性与哈希校验、默认保留 14 份 |
| 规则脚本 | 保留 |
| LLM 稿件生成 | 删除生成接口和 `backend/llm.py`；已有草稿 CRUD 若不依赖模型则保留 |

## 目标架构

### 1. 前端主应用

主应用继续由 `frontend/index.html`、`frontend/app.js`、`frontend/style.css` 和 `frontend/sw.js` 组成。

保留：

- IndexedDB 本地书库；
- EPUB 导入、打开、分页、目录和全文搜索；
- 排版、划线、感悟、标签、颜色和书签；
- 阅读位置保存；
- 离线操作队列和 protocol v2 同步；
- 笔记筛选、分页、编辑、批量操作、回收站与导出；
- 向服务器书库上传 EPUB 的 `uploadBookToServer` 路径。

删除：

- 知识书籍注册与 AI 索引状态轮询；
- `ensureKnowledgeBook`、`pollKnowledgeStatus`、索引重试和恢复逻辑；
- 仅供 AI 使用的 UI 状态、提示和 `knowledge_book_id` 客户端关联行为；
- AI 问答面板、会话、消息、引用跳转和 SSE 消费逻辑（若当前工作树仍有残留）。

关键边界：`/api/books/upload` 是服务器书库与 GPT 风格阅读器所需接口，不能与 `/api/knowledge/books/*` 一并删除。

### 2. GPT 风格阅读器

保留 `frontend/book-chat/` 的布局、主题与连续阅读实现。页面正式定位为“采用 GPT 风格布局的 EPUB 阅读器”，而不是聊天或问答界面。

保留：

- 服务器书库列表和 EPUB 上传；
- 连续阅读、目录导航和页码/进度展示；
- 深色、浅色和护眼主题；
- 阅读进度同步；
- 当前 EPUB 的本地全文搜索；
- 现有导航与布局竞态修复。

文案调整：

- 页面标题、description、品牌和空状态统一为“GPT 风格阅读器”；
- “聊天”改为“书库”；
- “新聊天”改为“导入书籍”；
- “聊天历史”改为“书籍”；
- “对话数量”改为“书籍数量”；
- “选择对话”改为“选择书籍”；
- 搜索框占位符改为“搜索本书内容”；
- 删除“询问”“回答”“对话”等会让用户误以为存在 AI 的文字。

视觉仍可保留 GPT 风格，包括侧栏、顶部栏、内容区和底部搜索框的布局。文案语义改变不要求重做视觉设计。

### 3. FastAPI 服务

保留以下接口族：

- `/health`；
- `/api/books`、上传、文件读取、同步和删除；
- `/api/highlights` 兼容接口；
- `/api/notes` 查询、facets、编辑、批量操作和导出；
- `/api/materials`；
- 规则式脚本接口；
- 不依赖模型的草稿读取、更新和删除接口；
- `/api/obsidian/export`；
- 静态前端挂载。

删除以下运行路径：

- `/api/books/ask`；
- `/api/knowledge/*`；
- `/api/conversations/*` 及消息、会话和 SSE 接口；
- LLM 稿件生成接口；
- `backend/knowledge.py`；
- `backend/llm.py`；
- FastAPI lifespan 中的知识库初始化、旧 EPUB 知识迁移和索引 worker；
- 只服务上述接口的 Pydantic 模型、辅助函数、导入和测试。

`backend/library.py` 的服务器书库、文件校验、进度与同步逻辑必须保留。若它当前调用知识索引注册或删除逻辑，只移除该调用，不改变 canonical 书库的 ID、文件路径或同步协议。

### 4. 数据库兼容策略

新版本：

- 不再初始化或访问 `qa_books`、`qa_chunks`、`qa_chunks_fts`、`qa_conversations`、`qa_messages` 等 AI 表；
- 不再写入新的知识索引、向量或会话数据；
- 不自动执行 `DROP TABLE`、删除旧索引文件或重写用户数据库；
- 保留笔记、草稿、批量操作、服务器书库、阅读状态、书签和同步幂等表。

可提供独立维护脚本，例如 `scripts/Remove-MarginaliaAiData.ps1`，但必须满足：

- 默认只显示将删除的表和预计影响；
- 需要显式确认参数才执行；
- 执行前创建数据库备份；
- 不作为安装、启动或升级流程的一部分。

该清理脚本是可选交付，不影响本次精简成功标准。

### 5. 配置与依赖

从 `backend/config.py`、`.env.example` 及其他示例配置删除：

- `LLM_BASE_URL`；
- `LLM_API_KEY`；
- `LLM_MODEL`；
- `LLM_EMBEDDING_MODEL`；
- `EMBEDDING_BASE_URL`；
- `EMBEDDING_API_KEY`；
- `EMBEDDING_MODEL`。

新增或正式启用：

```env
SERVER_HOST=10.x.x.x
SERVER_PORT=8720
```

`SERVER_HOST` 必须是本机当前拥有的 ZeroTier IPv4 地址。启动脚本不得在配置缺失、格式错误或地址不属于本机时回退到 `0.0.0.0`、普通局域网地址或 localhost。

`CORS_ORIGINS` 和 `ALLOWED_HOSTS` 继续支持显式配置。示例配置应展示 ZeroTier URL，例如：

```env
CORS_ORIGINS=http://10.x.x.x:8720
ALLOWED_HOSTS=10.x.x.x,localhost,127.0.0.1
```

依赖清理以实际引用为准：删除只被 AI 代码使用的依赖；保留 FastAPI、Uvicorn、Pydantic、aiosqlite、dotenv、multipart、EbookLib、BeautifulSoup 和测试依赖。若 `httpx` 仍被测试或非 AI 功能使用则保留，否则删除。

### 6. ZeroTier 启动边界

`start.bat` 是 Windows 主入口；`start.sh` 保持等价配置规则。

启动流程：

1. 创建或验证 Python 3.11 `.venv`；
2. 从 `.env.example` 创建缺失的 `.env`；
3. 读取 `SERVER_HOST` 与 `SERVER_PORT`；
4. 验证 host 是合法 IPv4，且存在于本机网络接口；
5. 验证目标端口未被占用；
6. 以 `uvicorn main:app --host <SERVER_HOST> --port <SERVER_PORT>` 启动；
7. Windows 启动脚本打开 `http://<SERVER_HOST>:<SERVER_PORT>`。

安全约束：

- 禁止默认使用 `0.0.0.0`；
- 禁止在校验失败时静默改用其他地址；
- 文档明确要求主机和访问设备加入同一 ZeroTier 网络；
- Windows 防火墙规则仅允许 ZeroTier 网卡/配置地址与服务端口；
- API 保持无账号认证，因此不能将该端口转发到公网。

应用内直接执行 `python backend/main.py` 时也应读取同一配置，避免绕过启动脚本后意外监听所有网卡。

### 7. Docker 与 Cloudflare 删除范围

删除：

- `docker-compose.yml`；
- `docker-compose.prod.yml`；
- `backend/Dockerfile`；
- `backend/Dockerfile.prod`；
- `.dockerignore`；
- `.env.production.example`；
- Cloudflare Tunnel 服务、token 和生产 Compose 说明；
- `scripts/Start-MarginaliaProduction.ps1`；
- 仅用于 Docker/Cloudflare 的检查和文档段落。

`.env.production` 是本地敏感配置，不读取、不迁移，也不由实现流程尝试删除；文档只说明它已不再使用，用户可自行归档或删除。

### 8. 本机备份、恢复与计划任务

#### 备份

重写 `scripts/Backup-Marginalia.ps1`，直接处理 `backend/data/`：

1. 确认数据目录存在；
2. 在服务安全停止或进入一致性备份路径后复制数据；
3. 对 SQLite 数据库执行 `PRAGMA integrity_check`；
4. 复制所有数据库、EPUB、`notes.json` 和其他运行数据；
5. 为备份内每个文件生成 SHA-256 manifest；
6. 校验 manifest 完整；
7. 默认仅保留最近 14 份成功备份；
8. 失败时不删除旧备份，并返回非零状态。

优先采用 SQLite 在线备份 API 或短暂停止由计划任务启动的服务，不能在数据库可能写入时直接裸拷贝主数据库。具体实现选择在实施计划中根据当前脚本和服务启动方式确定。

#### 恢复演练

重写 `scripts/Test-MarginaliaRestore.ps1`：

- 解压或复制备份到临时目录；
- 校验 SHA-256 manifest；
- 对恢复副本执行 SQLite integrity check；
- 验证关键目录与文件存在；
- 不覆盖真实 `backend/data/`；
- 不创建 Docker volume；
- 完成后清理临时目录。

#### 计划任务

重写 `scripts/Install-MarginaliaScheduledTasks.ps1`：

- 登录时通过本机 Python/`start.bat` 启动服务；
- 每日调用本机备份脚本；
- 不再启动 Docker Desktop、Compose 或 Cloudflare Tunnel；
- 保留明确的任务名称、日志路径和卸载说明。

## 文件变更边界

### 删除候选

- `backend/knowledge.py`
- `backend/llm.py`
- `backend/tests/test_knowledge.py`
- Docker、Compose、Cloudflare 生产启动文件
- 只覆盖 AI 问答或 LLM 生成的测试

### 修改候选

- `backend/main.py`
- `backend/config.py`
- `backend/models.py`
- `backend/library.py`
- `backend/requirements.txt`
- `backend/tests/test_api.py`
- `backend/tests/test_config.py`
- `frontend/app.js`
- `frontend/index.html`
- `frontend/sw.js`
- `frontend/book-chat/index.html`
- `frontend/book-chat/app.js`
- `frontend/book-chat/style.css`
- 对应 Playwright 测试
- `start.bat`
- `start.sh`
- `.env.example`
- 三个本机 PowerShell 运维脚本
- `README.md`、`PRODUCT.md`、`DESIGN.md`、`CLAUDE.md`、`AGENTS.md` 和 `docs/ARCHITECTURE.md`

删除或修改前必须按引用关系核对，不能仅按文件名判断。例如 `backend/library.py` 和 `/api/books/*` 属于保留功能。

## 错误处理

- ZeroTier 地址未配置：启动失败并提示在 `.env` 设置 `SERVER_HOST`。
- ZeroTier 地址不属于本机：启动失败，列出可用网络地址供用户核对，但不自动选择。
- 端口占用：启动失败并显示地址与端口。
- ZeroTier 离线：服务仍可绑定已有地址时正常启动；客户端连接失败由页面显示离线状态，本地阅读与离线队列继续可用。
- 服务器同步失败：沿用现有队列重试，不丢弃本地操作。
- 备份失败：保留旧备份，退出码非零并写入清晰错误信息。
- 恢复校验失败：不触碰真实数据目录。
- 历史数据库存在 AI 表：忽略并继续启动，不视为错误。

## 测试设计

### 后端自动测试

- 删除 AI 索引、检索、会话、SSE 和 LLM 生成测试。
- 保留并通过书库、上传、文件读取、同步、笔记、回收站、导出、Obsidian 和规则脚本测试。
- 增加启动配置测试：有效 ZeroTier host/port、缺失配置、非法 IP、禁止 `0.0.0.0`。
- 增加数据库兼容测试：已有 AI 表时初始化成功且表未被删除。
- 验证所有被删除 API 返回 404，而不是留下半失效入口。

### 前端自动测试

- 保留主阅读器、导入、阅读导航、笔记管理、离线 fallback 和 server-sync 测试。
- 删除或重写仅针对 AI 面板和知识索引状态的测试。
- GPT 风格阅读器测试必须验证：
  - 主入口文案为“GPT 风格阅读器”；
  - 页面不存在聊天/提问/回答语义；
  - 书库加载、书籍打开、目录导航和进度上报可用；
  - 搜索框只执行本书全文搜索；
  - 切换侧栏和主题不会破坏阅读位置。
- 保持 `index.html` 静态资源版本与 `sw.js` APP_SHELL 完全一致。

### 运维验证

- 在无 Docker 命令的环境中运行启动、备份和恢复演练。
- 验证服务仅监听配置的 ZeroTier 地址和端口。
- 从同一 ZeroTier 网络中的另一台设备打开应用并完成一次进度/书签/划线同步。
- 从普通局域网地址无法访问服务。
- 备份 manifest、SQLite integrity check 和临时恢复演练均成功。

## 验收标准

完成必须同时满足：

1. 项目中不存在 Docker 或 Cloudflare 的有效运行路径和受支持文档。
2. 项目中不存在 LLM、Embedding、知识索引、AI 问答、AI 会话或 SSE 问答的有效运行路径。
3. 主阅读器可导入、打开和阅读 EPUB，并可离线保存操作。
4. GPT 风格阅读器可加载服务器书库、连续阅读、导航目录、同步进度并搜索本书。
5. 划线、书签、进度和笔记可通过 ZeroTier 地址同步。
6. 笔记管理、回收站、Markdown/JSON 导出、Obsidian 导出和规则脚本保持可用。
7. 服务只绑定配置的本机 ZeroTier IP，不绑定 `0.0.0.0` 或普通局域网地址。
8. 本机备份和恢复校验在无 Docker 环境运行成功。
9. 后端 pytest 全部通过。
10. 前端 Playwright 全部通过。
11. 真实 FastAPI + 浏览器 + Service Worker 的关键场景完成一次端到端验证。
12. 旧数据库中的 AI 表未被启动或升级过程自动删除。
13. 文档与实现对功能、启动方式、端口、测试和安全边界的描述一致。

## 实施顺序建议

1. 建立基线：记录当前 pytest、Playwright 和工作树状态。
2. 用测试锁定保留能力，先调整/新增删除后的预期测试。
3. 解开 `library.py`、主前端导入流程与知识索引的耦合。
4. 删除后端 AI 路由、初始化、模型、模块和依赖。
5. 删除前端 AI 索引与问答残留，重命名 GPT 风格阅读器文案。
6. 引入 ZeroTier host/port 配置并改造启动脚本。
7. 删除 Docker/Cloudflare 文件与生产配置。
8. 重写备份、恢复演练和计划任务脚本。
9. 更新所有用户与架构文档。
10. 运行后端、前端、运维及真实 ZeroTier 端到端验收。

## 风险与控制

| 风险 | 控制措施 |
|---|---|
| 把服务器书库上传误当作 AI 上传删除 | 以 `/api/books/*` 与 `/api/knowledge/*` 为明确边界，并用 book-chat/server-sync 测试守卫 |
| 删除知识模块时破坏书籍删除流程 | 先解除 `library.py` 的知识索引调用，再删除模块 |
| 历史数据库升级时丢数据 | 不执行自动 DROP；用兼容测试验证 AI 表原样存在 |
| ZeroTier 地址变化导致服务不能启动 | 明确失败并要求更新 `.env`，不做不安全回退 |
| 无认证 API 被暴露 | 仅绑定 ZeroTier IP，文档禁止端口转发，防火墙仅允许 ZeroTier |
| 备份时 SQLite 不一致 | 使用 SQLite 在线备份或短暂停服，不裸拷贝活跃数据库 |
| Service Worker 缓存旧页面 | 同步升级资源查询版本与 cache 名，并执行真实更新/离线验收 |
| 删除 AI 测试后覆盖下降 | 保留所有非 AI 测试，并增加“接口已移除”和数据库兼容测试 |

## 回退策略

- 实施前记录工作树和测试基线，不覆盖用户未提交修改。
- 分阶段修改，每阶段均可通过版本控制回退。
- 不修改历史数据库中的 AI 表，因此代码回退后历史 AI 数据仍可被旧版本读取。
- 运维脚本替换前保留现有脚本内容于版本历史；不创建额外的未跟踪备份文件。
