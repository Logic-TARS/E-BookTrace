# Marginalia 开发指南

## 项目概览与功能边界

Marginalia 是个人／家庭共享使用的本地优先 EPUB 阅读与笔记管理工具：**阅读 EPUB → 划线、感悟和标签 → 笔记管理 → 服务端 Obsidian Markdown 导出或 JSON 下载**。

- 主阅读器支持目录、分页、全文搜索、四色划线、感悟与标签编辑、书签、阅读进度、离线缓存和跨设备同步。
- 主界面是书库入口；阅读页和笔记管理页是独立工作页，二者不直接互相跳转，均通过“返回主界面”退出。浏览器历史需保持这一层级。内部路由仍为 `#/`、`#/reader`、`#/creation`，其中 `creation` 现指笔记管理。
- 标签在阅读器笔记弹窗编辑；笔记管理页负责材料／标签筛选、感悟编辑与删除，以及书籍笔记导出。不要把删除感悟与删除整条划线混为一谈。
- `/book-chat/` 是另一套 EPUB 阅读界面，不是 AI 聊天服务。它使用同一服务器书库和进度同步接口，但有独立的前端状态、主题与阅读实现，不能假定它拥有主阅读器的全部 IndexedDB／笔记功能。
- 当前没有应用内账号体系、LLM 问答、语音朗读或稿件生成服务。历史数据库字段、表和文件可能仍存在，不能据此认定功能仍在运行，更不能擅自清理。

主要产品和设计文档使用中文，界面文字也以中文为主；代码注释、标识符及部分技术文档使用英文。新增项目说明和用户文案保持中文，技术标识符沿用现有命名。

## 目录与关键配置

```text
backend/
  main.py                  FastAPI 入口、生命周期、中间件、全部 HTTP 路由、静态前端挂载
  config.py                环境变量与 Settings 单例
  models.py                Pydantic 请求／响应模型
  database.py              划线笔记 SQLite CRUD、材料筛选、FTS5 搜索、JSON 导出
  library.py               持久 EPUB 书库、哈希去重、阅读状态与幂等同步、书籍删除
  books_api.py             EPUB ZIP 校验、元数据读取、旧版文件名下载接口
  obsidian.py              将书籍笔记写入服务端 Obsidian 仓库
  requirements.txt         Python 运行和测试依赖
  Dockerfile               开发镜像
  Dockerfile.prod          包含后端与静态前端的生产镜像
  tests/                   pytest 测试
  data/                    本机运行数据，不是测试夹具或源码
frontend/
  index.html               主界面、阅读器、笔记工作台和弹窗
  app.js                   主应用 IIFE：存储、阅读、手势、笔记、同步和 PWA
  style.css                主应用样式、中文排版与响应式布局
  sw.js                    应用壳和 EPUB 的独立缓存策略
  manifest.json            PWA 清单
  epub.min.js              仓库内置 epub.js
  jszip.min.js             仓库内置 JSZip
  book-chat/               独立 index.html、app.js、style.css
  package.json             ESM 测试工具项目，仅有 npm test 脚本
  package-lock.json        npm 依赖锁定文件
  playwright.config.mjs    Chrome 桌面／移动测试及 8099 静态服务器配置
  tests/                   Playwright 用例、helpers 和固定 EPUB 夹具
scripts/                   Windows 生产启动、备份、恢复演练和计划任务脚本
docs/                      架构、生产部署及历史翻页问题报告
README.md                  使用说明、启动和功能入口
PRODUCT.md                 产品范围与原则
DESIGN.md                  颜色、字体、布局、控件和中文优先设计规则
CLAUDE.md                  另一份代理上下文说明
.env.example               本地环境配置模板
.env.production.example    生产环境配置模板
.dockerignore              防止环境文件、运行数据和开发依赖进入生产构建上下文
.gitignore                 环境文件、数据、依赖和本地工具产物忽略规则
docker-compose.yml         开发部署
docker-compose.prod.yml    Cloudflare Tunnel 生产部署
start.bat / start.sh        项目 Python 3.11 虚拟环境启动器
```

本项目没有 `pyproject.toml`、Python 打包构建流程、Rust/Cargo 工程或前端打包器。后端依赖以 `backend/requirements.txt` 为准；前端 npm 依赖用于测试，不是浏览器运行所必需。当前仓库未提供独立 lint／format 命令或 CI 工作流。

`.codegraph/`、`.omo/`、`.impeccable/` 是本地代码分析／任务／设计辅助目录，不是运行服务。已有 `Marginalia/` 空目录不是第二套应用入口。

## 技术栈与运行架构

- 后端：Python、FastAPI（依赖范围 `>=0.115.0,<1.0.0`）、Uvicorn、Pydantic 2、aiosqlite、python-dotenv、python-multipart、EbookLib；依赖文件还包含 httpx、BeautifulSoup4 和 pytest。
- 前端：原生 HTML/CSS/JavaScript、epub.js、JSZip、IndexedDB、localStorage 和 Service Worker，无 React/Vue/TypeScript 或编译构建步骤。
- 测试：pytest／FastAPI `TestClient`；Playwright `@playwright/test` 与 `adm-zip`。
- 本机启动脚本要求 **Python 3.11**；两个 Dockerfile 使用 **Python 3.12-slim**，不要把二者误写成同一版本要求。
- 正常应用端口是 **8720**。FastAPI 先注册 API，再将 `frontend/` 挂载到 `/`，自动 API 文档位于 `/docs`，健康检查为 `/health`。
- 主应用 `API_BASE = ''`，另一阅读器也使用相对 API 路径。通过后端或正确配置的同源代理访问，不能用 `file://` 打开 HTML 代替应用运行。
- 启动生命周期依次初始化笔记数据库、书库数据库，然后登记 `data/books/*.epub` 中尚未登记的文件。手工放入 EPUB 后需重启；单个无效文件不会阻止整个应用启动。

### 数据与同步

- 实际 SQLite 文件由 `backend/database.py` 的 `DB_PATH` 指定，默认 `backend/data/marginalia.db`；EPUB 位于 `backend/data/books/`；JSON 导出位于 `backend/data/notes.json`。
- `config.py` 虽然读取 `DATABASE_URL`，但当前数据库访问直接使用 `database.DB_PATH`，**仅设置 `DATABASE_URL` 不会改变实际数据库位置**。文档或配置变更不要假设这里已有 SQLAlchemy 连接层。
- 主要表为 `highlights`、`library_books`、`reading_states`、`reader_bookmarks`、`reader_sync_operations`；FTS5 通过触发器同步划线索引。Schema 升级在初始化代码中以建表、增列、建索引完成，没有 Alembic 迁移工具。
- 笔记搜索涵盖书名、作者、章节、划线、感悟与标签。可用时使用 FTS5 trigram（至少 3 字符），短查询或无 trigram 支持时回退 `LIKE`；不足 2 字符返回空结果。阅读器全文搜索则在浏览器中搜索 EPUB 章节，不是调用笔记搜索替代全文搜索。
- 主应用 IndexedDB 名为 `marginalia`，当前版本 5，包含 `books`、`highlights`、`deleted_highlights`、`bookmarks`、`sync_queue`。排版和阅读控件等偏好使用 localStorage。
- **实际导入流程是先本机就绪，再后台上传**：读取文件、解析元数据、尽可能写入 IndexedDB、打开正文，然后迁移到服务器规范书籍 ID。上传慢或失败不应阻止当前本机阅读；存储配额不足时应反馈无法保存离线副本，而非直接放弃当前阅读。
- 服务器上传以 SHA-256 去重，生成 UUID 文件名，并用临时文件和原子替换持久化；同内容再次上传返回已有记录。浏览器依据 `content_hash`／`cached_content_hash` 复用或更新 EPUB 副本。
- 主阅读器将进度、书签、划线变更写入持久操作队列，联网后自动重试，保留手动同步。服务端通过 `op_id` 去重并返回规范快照和 revision，操作类型为 `progress.set`、`bookmark.upsert/delete`、`highlight.upsert/delete`。
- `book-chat` 单独使用 localStorage 记录主题、选中书籍和备用位置，防抖提交 `progress.set`。修改共享 API 时必须检查两个阅读入口。

### API 与导出契约

- `POST /api/highlights`：批量划线同步；`GET /api/highlights` 和 `GET/PATCH/DELETE /api/highlights/{id}`：笔记读写。
- `GET /api/materials`：材料筛选；`GET /api/search?q=...`：笔记全文搜索。
- `GET /api/books`、`POST /api/books/upload`：规范书库和 multipart 上传。上传响应为 HTTP 202，内容为 `{book, created}`；这不是后台 AI 处理任务。
- `GET /api/books/{id}/file`、`GET/POST /api/books/{id}/sync`、`DELETE /api/books/{id}`：书籍文件、阅读同步和删除。保留 `GET /api/books/{filename:path}` 旧版文件下载兼容接口，注意路由注册顺序。
- `GET /api/notes/export`：从 SQLite 重新生成并下载 `notes.json`。旧版划线写接口会异步刷新该文件；不要假定每次书籍同步都会立即刷新磁盘 JSON。
- `POST /api/obsidian/export` 请求包含 `{"kind":"book","book_title":"书名"}`，将该书材料写入 `OBSIDIAN_VAULT_PATH/Marginalia/Books/<安全书名>.md`，返回 `{exported, path}`。**Markdown 是服务端文件，不是浏览器下载**；同名文件会覆盖，目标仓库须已存在且可写。

## 配置与开发命令

`config.py` 依次加载根目录 `.env`、`backend/.env`，python-dotenv 默认不覆盖已存在的环境变量；Settings 在导入时读取配置，修改后重启服务。开发复制 `.env.example`，生产使用单独 `.env.production`，不要读取或提交真实环境文件。

- `CORS_ORIGINS`：逗号分隔，默认 `*`。
- `ALLOWED_HOSTS`：逗号分隔，默认 `localhost,127.0.0.1,testserver`；局域网访问需加入实际 LAN Host。
- `MAX_EPUB_UPLOAD_MB`：后端默认 90；主前端还有独立的 90 MB 常量，调整限制时同时检查前后端，不能只改环境变量。
- `OBSIDIAN_VAULT_PATH`：默认空，未配置时不能导出 Markdown；Docker 需额外挂载仓库，当前 Compose 未预置该挂载。
- `DATABASE_URL`：目前仅被读取，实际路径限制见上文。

在项目根目录运行 `start.bat`（Windows）或 `bash start.sh`（Unix）。它们检查／创建 `.venv`、在缺少依赖时安装 requirements、在缺少 `.env` 时复制模板，并启动 8720；**脚本本身不启用热重载**。

手动开发（先激活项目虚拟环境）：

```bash
cd backend
python -m pip install -r requirements.txt
python -m uvicorn main:app --host 0.0.0.0 --port 8720 --reload
# 或 python main.py：同样使用 8720 和热重载
```

开发容器（根目录，先准备 `.env`）：

```bash
docker compose up --build
```

开发 Compose 发布 `8720:8720`，挂载后端源码至 `/app`、只读前端至 `/frontend`，使用命名卷 `marginalia_data` 持久化 `/app/data`。**该命名卷不是本机 `backend/data`**；开发／生产切换时先确认数据来源。

## 测试策略与命令

后端（使用项目虚拟环境）：

```bash
cd backend
python -m pytest
python -m pytest tests/test_api.py
```

Windows Git Bash 未激活虚拟环境时，在根目录可运行：

```bash
./.venv/Scripts/python.exe -m pytest backend/tests
```

- 用例位于 `backend/tests/test_*.py`，覆盖 API、配置、模型、数据库与搜索；API 测试使用真实 FastAPI `TestClient`、生成的 EPUB、隔离 SQLite 和临时 Obsidian 目录。
- `conftest.py` 禁用 dotenv 加载，避免测试读取开发者密钥。隔离时应替换 `database.DB_PATH`、`database.NOTES_JSON_PATH`，以及 `books_api.BOOKS_DIR`／`library.BOOKS_DIR`，不要依赖 `DATABASE_URL` 隔离数据。
- 异步数据库测试已有同步运行 coroutine 的辅助函数，不依赖 pytest-asyncio。
- 保留上传→同步→材料筛选→搜索→JSON／Markdown 导出的集成覆盖，以及历史表、索引、文件在启动与删除操作后仍保留的回归测试。

前端：

```bash
cd frontend
npm ci
npm test
npm test -- --grep '@smoke'
npm test -- tests/notes-management.spec.js
npm test -- --project=mobile-chromium
```

- Playwright 配置固定单 worker、不完全并行，桌面项目 `chromium-stable`，移动项目 `mobile-chromium`（Pixel 5，仅匹配 `mobile-layout.spec.js`）。
- 必须安装系统 Google Chrome，配置使用 `channel: 'chrome'`；仅安装 Playwright Chromium 不够。
- 自动测试服务器使用项目 `.venv/Scripts/python.exe` 在 **8099** 提供静态前端，并可复用已有服务器。当前命令是 Windows 路径，其他平台需适配 `.venv/bin/python`。8099 不是正常应用端口。
- 浏览器测试用固定 EPUB 和模拟 API，不应连接用户书库。双设备同步测试也是共享模拟服务器状态，不等于完成真实生产链路验收。
- `tests/fixtures/multichapter.epub` 是已提交的固定二进制夹具（3 个长章节）；除非内容确需变化，不要重新生成。生成器 `build-fixture.mjs` 使用固定 ZIP 时间保证可复现。
- 翻页覆盖 `@boundary.forward`、`@boundary.backward`、`@boundary.intra`；跨章前进应落在新章第一页，后退落在前章最后一页，同章移动严格 ±1 页。`helpers/section-assertions.mjs` 按章节 href 判断，不能仅比较原始 CFI。
- 前端回归还包括导入失败与配额降级、哈希缓存失效、笔记未保存保护／异步编辑竞争、页面历史、两套阅读器、搜索、排版重排保留 CFI、移动手势、中文溢出与 Service Worker 缓存策略。修改对应功能时运行相关用例，再运行全套。
- 详细夹具与翻页排查规则见 `frontend/tests/README.md`。优先修应用层翻页逻辑；修改内置 `epub.min.js` 属于升级排查手段，不作为普通修复第一步。

没有前端 build 步骤。测试通过后，涉及实际同步、离线或导出的变更还应在隔离数据环境中通过后端同源页面验收；不能把模拟 API 测试说成真实生产端到端验证。

## 编码与界面约定

- Python 使用 4 空格、snake_case、必要的类型标注，路由与数据库操作沿用 async 方式；请求模型集中在 `models.py`，SQL 存取放在数据模块，不把 UI 契约散落到路由之外。
- 主应用和另一阅读器均为严格模式 IIFE，使用 `const`／`let`、2 空格、camelCase；常量、状态、DOM 引用和功能区分组沿用已有结构。测试采用 ESM。
- 不为了小改动引入前端框架、打包器或额外依赖；epub.js 和 JSZip 从仓库文件加载。
- 阅读器布局、手势和排版变化需保持当前 CFI、分页稳定性以及进度恢复顺序。目录／工具面板浮层不应意外缩放正文或触发重分页。
- 保存、删除、关闭弹窗、浏览器返回和 Service Worker 更新都可能与未保存编辑并发，保留现有草稿保护与重试语义。
- 遵循 `DESIGN.md` 的暖纸色、墨松绿、小圆角、克制层次和中文优先排版；主界面、阅读页、笔记管理页的结构约束见 `PRODUCT.md` 与 `DESIGN.md`。
- 修改主应用 JS/CSS 时，同步检查 `index.html` 的资源查询版本与 `sw.js` 的 `APP_SHELL`，按需更新应用缓存版本。不要因发布应用壳而清掉稳定 EPUB 缓存。
- Service Worker 对应用 HTML/JS/CSS 使用网络优先，对 EPUB 使用独立稳定缓存，其他 API 不缓存；升级时迁移旧 EPUB 缓存。保留这些策略的分工。
- 旧指南约定提交信息使用简洁祈使式，例如 `Add highlight sync validation`；PR 写明改动、测试、关联问题，界面修改附截图／录屏。不要把任务完成等同于授权提交或推送。
- 若使用本地 CodeGraph，可用 `codegraph status` 查看索引，较大源码变更后执行 `codegraph sync`；它不是构建前置条件。

## 生产部署、备份与安全

生产入口是 `docker-compose.prod.yml` 和 `scripts/Start-MarginaliaProduction.ps1`，详细切换、验收和回滚步骤见 `docs/PRODUCTION_DEPLOYMENT.md`。

- 生产镜像复制后端至 `/app`、前端至 `/frontend`，无源码热重载；绑定现有 `backend/data` 至 `/app/data`，不换成空卷。
- API 仅在内部 `app` 网络 expose 8720，**不得增加宿主机 ports 发布**。`cloudflared` 同时连接内部 app 网络和外部 tunnel 网络，等 API 健康后启动，当前镜像固定 `cloudflare/cloudflared:2026.7.2`。
- 当前部署入口为 `https://read.zengziyang.com`，Tunnel 转发至 `http://api:8720`。启动脚本校验固定生产 CORS／Host、Docker 状态、Compose 配置、健康检查以及没有非 loopback 8720 监听；迁移域名时需同时检查脚本，不只是改 env。
- 身份验证完全由 Cloudflare Access 邮箱白名单承担，应用内部仍共享同一套数据。CORS 和 TrustedHost 不是身份验证，禁止绕过 Access 直接公开 API。
- `/api/` 响应设置 `Cache-Control: private, no-store` 和 CDN no-store 头。浏览器 IndexedDB／显式 EPUB Service Worker 缓存是独立的设备离线数据；退出 Access 不会自动清除它们。
- 上传同时限制文件大小、ZIP 条目数（10,000）和声明的解压总大小（500 MB），验证 EPUB 容器与元数据；保留文件路径检查、上传失败清理、去重及删除回滚逻辑。

维护脚本职责：

- `Backup-Marginalia.ps1`：默认备份整个 `backend/data` 到 `G:\Backups\Marginalia`，保留 14 份；运行中的生产 API／Tunnel 会短暂停止并恢复，检查 SQLite integrity，生成 SHA-256 manifest。原生 Uvicorn 正占用数据时需先停止；不要随意用 `-SkipServiceStop` 绕过一致性保护。
- `Test-MarginaliaRestore.ps1`：校验 manifest，将备份复制到临时 Docker 卷并读回，复验哈希与 SQLite；默认清理临时卷，`-KeepVolume` 可保留。不是直接覆盖正式数据的恢复命令。
- `Install-MarginaliaScheduledTasks.ps1`：注册当前用户登录启动与每日备份（默认 03:00）；仅显式传入 `-DisableSleepOnAC` 才修改交流电休眠设置。Docker Desktop 的登录启动需另行启用。

生产启动、备份会影响服务与磁盘，计划任务、DNS、Tunnel 和系统电源设置也有外部副作用；普通代码探索／测试不要执行这些操作。

永远保留用户原有数据库、历史表和索引、书籍、历史音频／稿件及完整备份；删除功能不等于删除历史数据。不要提交真实 `.env`／`.env.production`、Tunnel token、Cloudflare 凭据、家庭邮箱、用户 EPUB、SQLite、Obsidian 内容或 `.codegraph` 数据。测试只能使用隔离存储与生成／固定夹具，不使用用户真实书库。
