# Marginalia

**电子书阅读 → 划线 / 感悟 / 标签 → 笔记管理 → Markdown**

阅读 EPUB 时划线、写感悟、打标签，在笔记管理中搜索、筛选、批量整理和使用回收站，并将完整筛选结果导出为 Markdown。离线导出会明确标注可能不完整；待同步和回收站视图不可导出。

## 快速开始

### 1. 启动服务

```bash
# 方式一：Docker Compose（含热重载 + 数据持久化）
docker compose up --build

# 方式二：项目级 .venv（Windows 用户可直接双击）
start.bat
```

API 运行在 `http://localhost:8720`，浏览器打开这个地址即可使用阅读器。自动生成文档在 `/docs`。

### 2. 导入 EPUB 开始阅读

- 点击「导入 EPUB」，选择一个 `.epub` 文件。
- 或者把 EPUB 文件放到 `backend/data/books/` 目录，刷新页面即可在书库看到。
- 选中文字进行划线（支持 4 种颜色）。
- 点击划线可以写感悟、加标签。
- 点击「同步」保存到后端素材库。

### 3. 书籍问答 API（后端）

在 `.env` 中配置 OpenAI 兼容的 LLM 接口：

```env
LLM_BASE_URL=https://api.deepseek.com
LLM_API_KEY=sk-xxxxxxxx
LLM_MODEL=deepseek-v4-pro
EMBEDDING_BASE_URL=http://127.0.0.1:11434/v1
EMBEDDING_API_KEY=ollama
EMBEDDING_MODEL=qwen3-embedding:0.6b
```

导入 EPUB 后，后端会异步建立全文向量索引。`/book-chat/` 提供 GPT 风格阅读界面（共享书库、本地全文搜索、阅读进度同步）。`/api/knowledge/*` 接口仅保留在后端、当前没有前端调用方。

也可以通过 API 直接调用历史接口：

```bash
# 基础脚本生成（规则引擎，无需 LLM）
curl -X POST http://localhost:8720/api/generate-script \
  -H "Content-Type: application/json" \
  -d '{"highlight_ids": ["uuid1", "uuid2", "uuid3"]}'

# AI 稿件生成（需要配置 LLM）
curl -X POST http://localhost:8720/api/drafts/generate \
  -H "Content-Type: application/json" \
  -d '{"target": "video", "highlight_ids": ["uuid1", "uuid2"], "topic": "阅读分享"}'
```

### 4. Markdown 导出

在「笔记管理」中使用搜索、书籍、标签、内容类型、颜色和排序筛选；可切换回收站并执行恢复或永久删除。在线导出由服务器生成完整筛选结果，离线导出基于本机可用数据并标注不完整。

历史 Obsidian 导出配置仍可用于兼容后端接口，但当前运行中的前端没有 Obsidian 导出入口。

<!-- 历史兼容配置：不属于当前运行链路 -->
在 `.env` 中设置 Obsidian 仓库路径：

```env
OBSIDIAN_VAULT_PATH=/path/to/your/obsidian/vault
```

历史后端调用仍可将划线素材写入 Obsidian 仓库；当前前端不展示该入口。

## 项目结构

```text
frontend/          PWA 阅读器 (epub.js + IndexedDB + vanilla JS)
  app.js           书库、阅读、笔记管理视图
                   笔记搜索、筛选、批量操作、回收站与 Markdown 导出
                   排版面板、目录与书签
backend/           FastAPI
  main.py          路由：health、highlights CRUD、drafts CRUD、script、obsidian export、books
  models.py        Pydantic 数据模型
  database.py      aiosqlite（highlights + drafts 两张表）
  agent.py         短视频脚本生成器（规则引擎）
  llm.py           OpenAI 兼容 LLM 客户端（稿件生成、书籍问答）
  obsidian.py      Markdown 导出（划线素材 + 稿件）
  books_api.py     服务端 EPUB 管理
  config.py        环境变量配置
docs/              架构文档
```

## 三视图导航

| 视图 | 功能 |
|------|------|
| **书库** | 导入 EPUB、浏览书籍、进入笔记管理 |
| **阅读** | EPUB 阅读、划线标注、写感悟、全文搜索、书签、排版面板、目录 |
| **笔记管理** | 搜索筛选、标签/颜色编辑、批量操作、回收站与 Markdown 导出 |

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `LLM_BASE_URL` | OpenAI 兼容 API 地址 | （空） |
| `LLM_API_KEY` | API 密钥 | （空） |
| `LLM_MODEL` | 模型名称 | （空） |
| `EMBEDDING_BASE_URL` | 本地 OpenAI 兼容向量接口 | `http://127.0.0.1:11434/v1` |
| `EMBEDDING_API_KEY` | 向量接口兼容密钥 | `ollama` |
| `EMBEDDING_MODEL` | EPUB 语义索引使用的向量模型 | `qwen3-embedding:0.6b` |
| `LLM_EMBEDDING_MODEL` | 旧版向量模型变量，仅作兼容回退 | （空） |
| `MAX_EPUB_UPLOAD_MB` | AI 索引接受的 EPUB 大小上限 | `100` |
| `OBSIDIAN_VAULT_PATH` | Obsidian 仓库路径 | （空） |
| `DATABASE_URL` | SQLite 数据库路径 | `backend/data/marginalia.db` |

## MVP 路线

- [x] EPUB 阅读 + 本机离线缓存 + 服务器持久书库
- [x] 阅读进度、书签、划线和笔记跨设备自动同步
- [x] 短视频脚本生成（规则引擎）
- [x] AI 增强稿件生成（LLM，视频号 + 公众号）
- [x] Obsidian Markdown 导出
- [x] 服务端 EPUB 上传、哈希去重、索引与全端删除（`/api/books`）
- [x] 创作面板（素材筛选 → 稿件生成 → 编辑 → 导出）
- [x] Docker Compose 一键部署
- [ ] 自动同步（Service Worker Background Sync）

## 文档

- [架构概览](docs/ARCHITECTURE.md)
