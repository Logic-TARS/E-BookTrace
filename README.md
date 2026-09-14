# Marginalia

**EPUB 阅读 → 划线与感悟 → 本地笔记管理与导出**

阅读 EPUB 时划线、写感悟、打标签，自动同步书签、阅读进度和笔记到本地 FastAPI/SQLite。已缓存的书籍支持离线阅读。书籍笔记可导出为 Markdown，写入服务端配置的 Obsidian 目录；全部笔记 JSON 可通过 API 下载。

## 快速开始

### 1. 启动服务

```bash
# 方式一：Docker Compose（含热重载 + 数据持久化）
docker compose up --build

# 方式二：项目级 .venv（Windows 用户可直接双击）
start.bat

# 或手动安装 Python 依赖并启动
cd backend
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8720 --reload
```

API 运行在 `http://localhost:8720`，浏览器打开这个地址即可使用阅读器。自动生成文档在 `/docs`。

### 2. 导入 EPUB 开始阅读

- 点击「导入 EPUB」，选择一个 `.epub` 文件。
- 或者把 EPUB 文件放到后端实际使用的 `data/books/` 目录，重启后端后刷新书库；手动放入的文件在启动时登记。本地运行对应 `backend/data/books/`，Docker 运行对应容器数据卷中的 `/app/data/books/`。
- 服务器书籍在每台设备首次打开时下载一次，随后保存到浏览器本机；只有文件内容变化或浏览器数据被清理后才重新下载。
- 选中文字进行划线（支持 4 种颜色）。
- 点击划线可以写感悟、加标签。
- 阅读进度、书签、划线和感悟自动同步；离线变更先进入本机队列，联网后重试，也可以点击「同步」。

### 3. 整理与导出笔记

从主界面进入「笔记管理」，按书名、划线、感悟或标签筛选材料，编辑或删除感悟。标签在阅读器的笔记弹窗中编辑，笔记管理页仅支持按标签筛选。`GET /api/notes/export` 可下载后端全部笔记的 `notes.json`。

如需导出书籍笔记 Markdown，在 `.env` 中设置服务端 Obsidian 仓库路径：

```env
OBSIDIAN_VAULT_PATH=/path/to/your/obsidian/vault
```

然后在笔记管理页选中该书的一条素材，点击「导出书籍到 Obsidian」。`POST /api/obsidian/export` 将该书的划线、感悟和标签写入服务端仓库的 `Marginalia/Books/` 目录；浏览器显示导出路径，不下载 Markdown。仓库目录须已存在且可写，Docker 部署还需要挂载目标仓库。

## 项目结构

```text
frontend/          PWA 阅读器 (epub.js + IndexedDB + vanilla JS)
  app.js           主界面、独立阅读页、笔记管理和导出
  book-chat/       另一套 EPUB 阅读界面
  sw.js            应用壳与 EPUB 离线缓存
  tests/           Playwright 浏览器测试
backend/           FastAPI
  main.py          health、划线 CRUD、笔记筛选搜索、书籍同步和导出路由
  models.py        Pydantic 数据模型
  database.py      SQLite 划线笔记、搜索与 JSON 导出
  library.py       EPUB 上传、去重、持久书库和阅读状态同步
  obsidian.py      书籍笔记 Markdown 写入服务端 Obsidian 目录
  books_api.py     EPUB 校验、元数据解析和旧版文件服务
  config.py        环境变量配置
  tests/           pytest 测试
docs/              架构与部署文档
```

## 页面结构

| 页面 | 功能 |
|------|------|
| **主界面** | 导入 EPUB、浏览书籍，并作为阅读和笔记管理的入口 |
| **阅读页** | EPUB 阅读、划线、感悟和标签编辑、全文搜索、书签和进度同步 |
| **笔记管理页** | 素材与标签筛选、感悟编辑和删除、书籍笔记 Markdown 导出到服务端 Obsidian 目录 |
| **book-chat 阅读界面** | 保留 `/book-chat/` EPUB 阅读入口 |

主阅读页与笔记管理页互不直接跳转，均通过“返回主界面”退出。浏览器前进和后退遵循相同的页面层级。

## 环境变量

复制 `.env.example` 为 `.env` 配置本地环境；生产环境参考部署手册。

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `MAX_EPUB_UPLOAD_MB` | 服务端接受的 EPUB 大小上限（MB） | `90` |
| `OBSIDIAN_VAULT_PATH` | Obsidian 仓库路径 | （空） |
| `DATABASE_URL` | SQLite 连接 URL | `sqlite+aiosqlite:///` + `backend/data/marginalia.db` 的绝对路径 |
| `CORS_ORIGINS` | 允许的浏览器来源，逗号分隔 | `*` |
| `ALLOWED_HOSTS` | 允许的 HTTP Host，逗号分隔 | `localhost,127.0.0.1,testserver` |

## 测试

```bash
cd backend
python -m pytest

# 在项目根目录另开终端
cd frontend
npm ci
npm test
```

前端测试使用系统 Chrome 和项目 `.venv` 中的 Python，详细设置见 [浏览器测试说明](frontend/tests/README.md)。静态前端无需构建步骤。

## 功能范围

- EPUB 阅读、全文搜索、本机离线缓存与服务器持久书库
- 阅读进度、书签、划线和笔记跨设备自动同步
- 服务端 EPUB 上传、哈希去重与跨设备删除（`/api/books`）
- 笔记管理、全部笔记 JSON 下载和书籍笔记 Markdown 导出（写入服务端配置的 Obsidian 目录）
- Docker Compose 本地部署与 Cloudflare Tunnel/Access 生产部署

升级时保留现有 `backend/data` 和数据库，不清理历史表、索引或文件。部署与备份沿用现有数据卷。

## 文档

- [架构概览](docs/ARCHITECTURE.md)
- [生产部署](docs/PRODUCTION_DEPLOYMENT.md)
