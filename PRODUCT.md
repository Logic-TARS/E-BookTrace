# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

主要用户是产品所有者本人。Marginalia 服务于在可信的 ZeroTier 私有网络中阅读 EPUB、整理划线与笔记，并把阅读所得持续沉淀为可复用材料的个人工作流。

## Product Purpose

Marginalia 将 EPUB 原文阅读、划线、感悟、标签、书签、阅读进度、笔记管理、跨设备同步和 Markdown/Obsidian 导出连接成一条本地优先的路径。成功意味着用户可以从原文阅读开始，在不搬运上下文的情况下完成整理、恢复和导出。

## Positioning

Marginalia 是主 EPUB 阅读器与 GPT 风格布局阅读器的组合，而不是聊天产品。GPT 风格阅读器保留书库、连续阅读、目录、主题和进度体验；产品不提供问答服务。ZeroTier 私有网络负责远程访问边界，应用本身不提供账号认证。

## Operating Context

- 服务运行在原生 Python 3.11、FastAPI、SQLite 和本机文件系统上。
- Windows 使用 `start.bat`，POSIX 使用 `start.sh`；两者都验证 `.venv`、显式 `SERVER_HOST`、`SERVER_PORT` 和本机 ZeroTier 地址。
- 服务端和客户端加入同一 ZeroTier 网络，通过 HTTP ZeroTier IP 访问。
- 产品不支持公网端口转发、不回退到普通局域网或所有网卡，也不在本范围加入 TLS。
- HTTP ZeroTier 地址通常不属于浏览器安全上下文；远端阅读/同步验收必须与 Service Worker/PWA 离线能力验收分开。

## Capabilities and Constraints

- 支持 EPUB 导入、书库、分页、目录、全文搜索、排版、书签、阅读位置、划线、感悟、标签和颜色。
- 支持 IndexedDB 本地缓存、离线变更队列与 `protocol v2` 跨设备同步。
- 支持笔记搜索、筛选、分页、批量操作、回收站、恢复、永久删除以及 Markdown/JSON 导出。
- 支持服务器书库、EPUB 上传、文件读取、书籍删除与阅读进度同步。
- 保留 GPT 风格阅读器的阅读能力，不把它定位为聊天或问答入口。
- 保留规则式脚本生成能力，作为不依赖外部模型的内容整理工具。
- 保留既有草稿的读取、更新和删除能力，以及 Obsidian 导出能力，服务于历史材料兼容和继续编辑。
- 不提供草稿生成服务；`POST /api/drafts/generate` 不是支持的接口。
- 不提供账号、密码或应用层认证；ZeroTier 网络不是公网安全边界的替代品，端口不得转发到公网。
- 历史数据库中可能保留旧表和旧记录。启动与升级不会自动删除它们；历史数据存在不表示对应能力仍是运行时产品范围。

## Supported Workflow

1. 服务端和客户端安装 ZeroTier 并加入同一私有网络。
2. 在 `.env` 中设置服务端已验证的 `SERVER_HOST`、`SERVER_PORT=8720`、匹配的 `CORS_ORIGINS` 和 `ALLOWED_HOSTS`。
3. 在服务端运行 `start.bat` 或 `./start.sh`。
4. 客户端打开 `http://SERVER_HOST_VALUE:SERVER_PORT_VALUE`，阅读 EPUB、记录笔记并同步。
5. 使用规则式脚本、草稿 CRUD、Markdown 或 Obsidian 导出继续处理材料。
6. 使用本机备份与恢复演练脚本保护和验证 `backend/data/`。

## Operations

- `scripts/Backup-Marginalia.ps1` 创建 SQLite 在线一致性备份和 SHA-256 manifest。
- `scripts/Test-MarginaliaRestore.ps1` 在临时目录校验 manifest、SQLite 完整性和关键文件，不覆盖真实数据。
- `scripts/Install-MarginaliaScheduledTasks.ps1` 安装登录启动与每日备份任务。
- `scripts/Uninstall-MarginaliaScheduledTasks.ps1` 移除这些计划任务。
- 备份默认保留最近 14 份成功备份；失败不会删除旧备份。

## Brand Commitments

- 产品名称保持为 Marginalia。
- 界面简洁、清楚，避免无必要的信息噪声。
- 中文内容稳定易读，不出现乱码、异常串行、挤压或破坏阅读节奏的情况。
- 阅读、记录、同步、恢复和导出状态应明确，帮助用户专注原文与自己的判断。

## Evidence on Hand

- `README.md`：启动、运行边界、能力范围和运维命令。
- `docs/ARCHITECTURE.md`：现有架构和数据流说明。
- `frontend/`：静态 PWA 阅读器、笔记管理、同步和导出界面。
- `backend/`：书库、同步、笔记、规则脚本、草稿 CRUD 和 Obsidian 导出接口。
- `scripts/`：本机启动配套的备份、恢复和计划任务脚本。
- 仓库未提供用户研究、第三方评价、商业数据或公开使用证明；产品文案不虚构这些证据。

## Product Principles

1. 本地优先：阅读和记录不因暂时断网而丢失，联网后可继续同步。
2. 保持从原文到个人理解、规则式整理和导出的连续上下文。
3. 优先服务个人阅读，不用多用户产品的复杂度干扰核心工作流。
4. ZeroTier 访问边界必须清楚；无认证服务不得暴露到公网。
5. 让界面和状态帮助用户专注内容，避免含混、拥挤和无意义装饰。
6. 自动化整理保留人工判断、编辑和沉淀的空间。

## Accessibility & Inclusion

当前没有指定必须遵循的无障碍标准。最低要求是中文内容清楚可读、文字布局稳定，并且核心状态与操作不依赖含混的视觉表达。
