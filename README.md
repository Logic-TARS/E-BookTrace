# E-书痕 / E-BookTrace

E-书痕是一个本地优先的 EPUB 阅读、划线与笔记管理工具。浏览器负责阅读体验和本地缓存，FastAPI + SQLite 提供服务器书库、跨设备同步、导出，以及可选的知识索引、问答和草稿接口。

项目已使用 E-书痕 / E-BookTrace 品牌；数据库名、IndexedDB 名、日志、Docker 卷、脚本和计划任务中的 `marginalia` 保留为兼容标识，不应直接改名或删除。

## 当前能力

### 主阅读器

入口为 `/`，包括：

- 导入 EPUB；文件先写入浏览器，可立即阅读，联网时再后台上传服务器。
- 分页阅读、目录、书签、本书全文搜索、进度和页码。
- 字体、字号、行距、段距以及桌面/移动端阅读控制。
- 四种颜色划线、感悟、标签和划线定位。
- 服务器书库、阅读进度、书签和笔记同步；主阅读器写入 `protocol v2` 同步操作。
- 笔记搜索、书籍/标签/类型/颜色筛选、排序、分页、批量标签、回收站、恢复、永久删除和 Markdown 导出。

### GPT 风格阅读器

入口为 `/book-chat/`。它是另一套连续滚动阅读布局，提供服务器书库、EPUB 上传、目录、正文搜索、深色/浅色/护眼主题、页码和阅读进度同步。

“GPT 风格”描述界面布局，不代表聊天功能。该页面目前没有问答、划线、笔记或草稿 UI，而且依赖服务器书库，不是独立的离线阅读器。

### 后端可选能力

后端仍实现以下能力，但当前两套前端都没有问答或草稿生成界面：

- `/api/knowledge/`：EPUB 索引、重建、删除、会话和流式消息。
- `/api/books/ask`：基于已就绪索引、划线和感悟的一次性书籍问答。
- `/api/drafts/generate`：调用 OpenAI-compatible 聊天端点生成视频或文章草稿；草稿还可列出、读取、修改和删除。
- `/api/generate-script`：不调用外部模型的规则式短视频脚本生成。
- `/api/obsidian/export`：把书籍素材或草稿写入配置的 Obsidian 仓库。

上传服务器书库时会同时登记知识索引任务；未配置 Embedding 服务时，阅读和普通同步仍可用，但索引会失败。问答和 LLM 草稿还需要聊天模型配置。

## 运行要求

- 原生启动：Python **3.11**。`start.bat` 和 `start.sh` 都会拒绝其他版本的 `.venv`。
- 浏览器：现代 Chromium 浏览器；PWA/Service Worker 需要安全上下文（HTTPS 或浏览器认可的 localhost）。
- 可选 AI：OpenAI-compatible 聊天端点，以及 OpenAI-compatible Embedding 端点；默认示例面向本机 Ollama。
- 测试：Python 3.11、Node.js/npm，以及 Playwright 配置使用的稳定版 Google Chrome。
- Docker 工作流使用仓库内 Dockerfile，当前基础镜像为 Python 3.12；这不改变原生启动脚本的 Python 3.11 要求。

## 快速开始：原生本机启动

启动脚本会创建 `.venv`、在缺少时复制 `.env.example` 为 `.env`、检查并安装 `backend/requirements.txt`，然后固定监听 **`127.0.0.1:8720`**。

Windows：

```bat
start.bat
```

POSIX：

```bash
chmod +x start.sh
./start.sh
```

打开 <http://127.0.0.1:8720>。Windows 脚本还会自动打开浏览器，并在端口已占用时退出；POSIX 脚本直接以前台进程运行。

配置中不存在 `SERVER_HOST` 或 `SERVER_PORT`；原生启动脚本也不会读取这两个变量。

## 其他运行方式

### 手动 Uvicorn

先创建 Python 3.11 虚拟环境并安装依赖，然后从 `backend/` 启动：

```powershell
# Windows PowerShell（仓库根目录）
py -3.11 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r .\backend\requirements.txt
Set-Location .\backend
..\.venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8720
```

```bash
# POSIX（仓库根目录）
python3.11 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.txt
cd backend
../.venv/bin/python -m uvicorn main:app --host 127.0.0.1 --port 8720
```

如需手动绑定局域网或私有网络地址，只能由操作者修改 Uvicorn 的 `--host`，并同步配置 `ALLOWED_HOSTS`、`CORS_ORIGINS`、防火墙和访问控制。启动包装脚本不支持这种绑定，项目也没有内置 ZeroTier 检测或集成。

### 开发 Compose

```bash
docker compose up --build
```

`docker-compose.yml` 把容器的 `0.0.0.0:8720` 发布到主机 8720，并启用 Uvicorn 热重载。它有几个重要差异：

- 只以 `backend/` 为构建上下文，并把 `backend/` 挂载到 `/app`；容器中不包含 `frontend/`，因此主要用于 API 开发，不提供完整网页。
- 数据写入独立的 `marginalia_data` named volume，不是原生运行所用的 `backend/data/`。
- Compose 会把 `EMBEDDING_BASE_URL` 覆盖为 `http://host.docker.internal:11434/v1`。

### 生产 Docker + Cloudflare

生产入口是 `docker-compose.prod.yml` 和 Windows PowerShell 脚本：

```powershell
Copy-Item .env.production.example .env.production
# 填写 TUNNEL_TOKEN、CORS_ORIGINS、ALLOWED_HOSTS 等真实值
.\scripts\Start-MarginaliaProduction.ps1
```

生产镜像同时复制后端和前端，`backend/data/` 绑定到容器 `/app/data`。API 只在 Compose 内部网络暴露 8720，不发布主机端口；`cloudflared` 通过 Cloudflare Tunnel 连接 API。启动脚本会校验 `.env.production`、Docker、Compose、健康状态、生产域名配置和“主机未公开 8720”。公网身份验证由运维配置的 Cloudflare Access 承担，应用本身没有账号系统。

生产细节、当前域名约束和回滚流程见 [生产部署手册](docs/PRODUCTION_DEPLOYMENT.md)。

## 配置

`backend/config.py` 先读取仓库根目录 `.env`，再读取 `backend/.env`。当前应用变量如下：

| 变量 | 用途 | 默认/说明 |
| --- | --- | --- |
| `DATABASE_URL` | SQLite 数据库位置 | `sqlite+aiosqlite:///.../backend/data/marginalia.db`；非该前缀会回退默认路径 |
| `CORS_ORIGINS` | 逗号分隔的浏览器来源 | 默认 `*`；生产应收紧 |
| `ALLOWED_HOSTS` | 逗号分隔的 HTTP Host | 默认 `localhost,127.0.0.1,testserver` |
| `LLM_BASE_URL` | OpenAI-compatible 聊天 API 根地址 | 可选 |
| `LLM_API_KEY` | 聊天 API token | 可选；问答/LLM 草稿需要 |
| `LLM_MODEL` | 聊天模型名 | 可选 |
| `EMBEDDING_BASE_URL` | OpenAI-compatible Embedding 根地址 | 未设置时回退 `LLM_BASE_URL` |
| `EMBEDDING_API_KEY` | Embedding token | 未设置时回退 `LLM_API_KEY` |
| `EMBEDDING_MODEL` | Embedding 模型名 | 未设置时回退旧变量 `LLM_EMBEDDING_MODEL` |
| `MAX_EPUB_UPLOAD_MB` | 服务器书库和知识索引的 EPUB 上限 | 默认 `90` MB |
| `OBSIDIAN_VAULT_PATH` | Obsidian 仓库目录 | 未设置时导出接口不可用 |

生产 Compose 还要求 `.env.production` 中有 `TUNNEL_TOKEN`，并使用其中的 CORS/Host 与可选 AI 配置。不要提交真实 `.env`、`.env.production` 或 token。

## 页面与 API 概览

页面：

- `/`：主应用；hash 路由 `#/` 为书库、`#/reader` 为当前阅读器、`#/creation` 为笔记管理。
- `/book-chat/`：GPT 风格连续阅读器。
- `/health`：健康检查。
- `/docs`：FastAPI OpenAPI 交互文档。

主要 API：

- 服务器书库：`GET /api/books`、`POST /api/books/upload`、`GET /api/books/{book_id}/file`、`GET/POST /api/books/{book_id}/sync`、`DELETE /api/books/{book_id}`。
- 笔记与素材：`/api/highlights`、`/api/notes`、`/api/notes/batch/*`、`/api/materials`、`/api/notes/export.md`、`/api/notes/export`。
- 知识与问答：`/api/books/ask`、`/api/knowledge/books/*`、`/api/knowledge/conversations/*`。
- 脚本与草稿：`POST /api/generate-script`、`POST /api/drafts/generate`、`GET /api/drafts`、`GET/PATCH/DELETE /api/drafts/{draft_id}`。
- 外部导出：`POST /api/obsidian/export`。

完整请求模型和响应以运行中的 `/docs` 及 `backend/main.py` 为准。

## 数据、同步与离线边界

### 服务器存储

默认运行数据都在 `backend/data/`：

- `marginalia.db`：书库元数据、进度、书签、划线/笔记、草稿、知识索引元数据和问答会话。
- `books/`：服务器 EPUB。
- `knowledge/`：知识索引上传文件。
- `notes.json`：划线同步后生成的兼容 JSON 导出。

生产 Compose 直接绑定该目录；开发 Compose 使用单独 named volume。

### 浏览器存储与 protocol v2

主阅读器使用名为 `marginalia` 的 **IndexedDB v6**，保存书籍记录/本地 EPUB、划线、书签、删除记录和同步队列。服务器书籍状态包括进度、书签和划线；主阅读器以幂等操作同步，并通过 `protocol v2` 区分回收站永久删除语义。

GPT 风格阅读器只在 `localStorage` 保存主题、当前书和阅读位置回退值；书库和 EPUB 来自服务器。

### PWA 与离线限制

Service Worker 对应用壳采用 network-first、对稳定 EPUB 文件采用 cache-first、对 `/api/` 数据请求采用 network-only（离线返回 503）。因此：

- 已经在主阅读器导入并存入 IndexedDB 的 EPUB 可继续本机阅读、划线和排队同步。
- 离线笔记列表和 Markdown 导出只基于当前设备缓存，界面会标注“可能不完整”。
- 服务器 API、跨设备合并、AI 索引/问答、Obsidian 导出都需要联网。
- GPT 风格阅读器没有自己的 IndexedDB 书库或离线操作队列，不能视为完整离线模式。
- 普通远程 HTTP 地址通常不是安全上下文，可能无法注册 Service Worker；生产应使用 HTTPS。

## 备份、恢复演练与计划任务

Windows PowerShell 工具：

```powershell
# 默认从 backend/data 备份到 G:\Backups\Marginalia，保留 14 份
.\scripts\Backup-Marginalia.ps1
.\scripts\Backup-Marginalia.ps1 -Destination G:\Backups\Marginalia -Retention 14

# 验证最近备份；需要 Docker 和一个可用的本地镜像
.\scripts\Test-MarginaliaRestore.ps1

# 安装登录启动生产 Compose、每日 03:00 备份的当前用户计划任务
.\scripts\Install-MarginaliaScheduledTasks.ps1 -BackupAt 03:00
```

`Backup-Marginalia.ps1` 不是在线备份 API：生产容器运行时会短暂停止 `cloudflared` 和 API；若检测到占用数据的原生 Uvicorn，则要求先手动停止。随后脚本递归复制数据、对复制后的 `marginalia.db` 执行 SQLite 完整性检查、为每个文件计算 SHA-256 并写入 `manifest.json`，成功后按保留数清理旧备份并重启生产服务。

`Test-MarginaliaRestore.ps1` 校验 manifest/hash，把备份复制进临时 Docker 卷，再复制回临时目录复核 hash 和 SQLite；它只是恢复演练，不会把数据恢复到真实 `backend/data/`。`-KeepVolume` 可保留临时卷供检查。

计划任务脚本创建当前用户的 `Marginalia Production Startup` 和 `Marginalia Daily Backup` 两项任务；任务名保留旧标识。它可选修改交流电睡眠设置，并假定 Docker Desktop 已配置为登录时启动。仓库目前未提供自动移除这些任务的脚本，需由操作者使用 Windows 计划任务工具管理。

## 开发与测试

安装后端依赖并运行：

```powershell
# Windows
py -3.11 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r .\backend\requirements.txt
$env:ALLOWED_HOSTS = "localhost,127.0.0.1,testserver"
$env:CORS_ORIGINS = "http://testserver"
.\.venv\Scripts\python.exe -m pytest backend/tests -q
```

```bash
# POSIX
python3.11 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.txt
ALLOWED_HOSTS='localhost,127.0.0.1,testserver' \
CORS_ORIGINS='http://testserver' \
.venv/bin/python -m pytest backend/tests -q
```

前端是静态 HTML/CSS/JavaScript，没有构建步骤。测试使用 Playwright：

```bash
cd frontend
npm ci
npm test
```

`playwright.config.mjs` 通过 `python -m http.server 8099` 提供静态文件，并以稳定版 Google Chrome 运行桌面和移动项目。若系统没有 Chrome，测试不会自动改用捆绑 Chromium。

## 项目结构

```text
backend/
  main.py                 FastAPI 路由、静态前端挂载
  config.py               环境配置
  database.py             SQLite 划线、笔记和草稿
  library.py              服务器书库与跨设备阅读状态
  knowledge.py            EPUB 索引、检索、会话与问答
  llm.py                  OpenAI-compatible 草稿生成
  notes.py                Markdown 笔记导出
  data/                   运行数据（Git 忽略）
  tests/                  pytest 测试
frontend/
  index.html, app.js      主阅读器和笔记管理
  book-chat/              GPT 风格连续阅读器
  sw.js, manifest.json    PWA 应用壳与缓存策略
  tests/                  Playwright 测试
scripts/
  Start-MarginaliaProduction.ps1
  Backup-Marginalia.ps1
  Test-MarginaliaRestore.ps1
  Install-MarginaliaScheduledTasks.ps1
docker-compose.yml        API 开发容器
docker-compose.prod.yml   API + Cloudflare Tunnel 生产编排
start.bat, start.sh        Python 3.11 本机启动
```

## 安全与已知限制

- 应用本身没有登录、用户隔离或权限模型。原生默认只监听 loopback；不要直接把 8720 暴露到公网。
- CORS 不是身份验证。生产部署必须在外层配置 Cloudflare Access 或等效访问控制，并使用 HTTPS。
- API 响应带 private/no-store 缓存头；设备上的 IndexedDB、Cache Storage 和下载文件仍需由设备使用者自行保护和清理。
- EPUB 内容会在浏览器中渲染，并可进入服务器存储及可选索引；只导入可信文件并限制服务访问者。
- AI 结果依赖外部或本地模型端点；索引状态“就绪”不保证回答正确。问答提示要求引用书内材料，但仍应人工核对。
- 服务面向个人/家庭使用，SQLite 和单进程后台索引并非高并发、多租户架构。
- `PRODUCT.md` 记录产品范围，其中的目标状态不一定等同于当前实现；本 README 以当前代码为准。

## 相关文档

- [产品范围](PRODUCT.md)
- [架构概览](docs/ARCHITECTURE.md)
- [生产部署手册](docs/PRODUCTION_DEPLOYMENT.md)
