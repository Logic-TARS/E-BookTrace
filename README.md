# Marginalia

Marginalia 是一个本地优先的 EPUB 阅读与知识整理工具：在书籍原文中阅读、划线、记录感悟和标签，再通过笔记管理、同步和 Markdown/Obsidian 导出把内容沉淀下来。它运行在一台原生 Python 3.11 主机上，远程设备通过同一 ZeroTier 私有网络访问。

## 快速开始

### 1. 准备 ZeroTier

在服务端和客户端安装 ZeroTier，并加入同一个私有网络。服务端必须拥有已验证的 ZeroTier IPv4 地址；客户端使用该网络地址访问服务。

### 2. 配置服务

按需手动复制配置模板：

```bash
copy .env.example .env      # Windows
cp .env.example .env        # POSIX
```

在 `.env` 中设置服务端的 ZeroTier IPv4、端口以及允许的来源：

```env
SERVER_HOST=你的ZeroTier_IPv4
SERVER_PORT=8720
CORS_ORIGINS=http://你的ZeroTier_IPv4:8720
ALLOWED_HOSTS=你的ZeroTier_IPv4,localhost,127.0.0.1
```

`SERVER_HOST` 必须是本机当前拥有并经 ZeroTier 网卡确认的地址。启动不会回退到普通局域网地址、localhost 或所有网卡。

### 3. 启动

```text
Windows：双击 start.bat
POSIX：./start.sh
```

启动入口会创建或验证 Python 3.11 `.venv`、安装缺失依赖，并使用配置的 `SERVER_HOST` 和 `SERVER_PORT` 启动 FastAPI 服务。也可以直接运行后端测试：

```bash
ALLOWED_HOSTS="localhost,127.0.0.1,testserver" CORS_ORIGINS="http://testserver" .venv/Scripts/python.exe -m pytest backend/tests -q
```

### 4. 访问

在同一 ZeroTier 网络中的客户端打开：

```text
http://SERVER_HOST_VALUE:SERVER_PORT_VALUE
```

本项目不提供账号认证，不应进行公网端口转发，也不包含 TLS。HTTP 的 ZeroTier 地址通常不是浏览器的安全上下文：远端 EPUB 阅读、笔记和同步验收，与本机安全上下文下的 PWA/Service Worker 验收是两件事。若浏览器拒绝安装或运行 Service Worker，应在安全上下文中单独验证离线能力，不要把它误判为 ZeroTier 阅读或同步失败。

## 保留的产品能力

- 主阅读器：EPUB 导入、书库、分页、目录、全文搜索、排版、书签、阅读位置和四种颜色划线。
- 笔记：感悟、标签、颜色编辑、搜索、筛选、分页、批量加标签、回收站、恢复和永久删除。
- 本地优先：IndexedDB 本地缓存、离线变更队列和 `protocol v2` 跨设备同步。
- GPT 风格阅读器：保留 `frontend/book-chat/` 的书库、连续阅读、主题、目录、页码和阅读进度能力；这里是阅读布局，不提供问答服务。
- 服务器书库：`/api/books`、`/api/books/upload`、文件读取、阅读进度同步和书籍删除。
- 笔记与素材：`/api/notes`、`/api/materials`、划线 CRUD、Markdown/JSON 导出和在线筛选导出。
- 规则式脚本：`/api/generate-script` 保留，按选定划线生成脚本，不依赖外部模型服务。
- 历史稿件：`GET/PATCH/DELETE /api/drafts/{draft_id}` 保留，用于读取、编辑和删除既有草稿；草稿生成端点不受支持。
- Obsidian：`/api/obsidian/export` 保留，可把素材导出到配置的 Obsidian 仓库。

支持的基础接口还包括 `/health`。已移除的接口不会被文档、启动流程或前端调用。

## 备份、恢复和计划任务

运行数据位于 `backend/data/`。备份使用 SQLite 在线一致性备份，并为每个文件生成 SHA-256 manifest；默认目标为 `G:\Backups\Marginalia`，默认保留最近 14 份成功备份。

```powershell
# 创建备份（可选 -Destination 和 -Retention）
.\scripts\Backup-Marginalia.ps1
.\scripts\Backup-Marginalia.ps1 -Destination G:\Backups\Marginalia -Retention 14

# 在临时目录做 manifest、SQLite 完整性和关键文件恢复演练
.\scripts\Test-MarginaliaRestore.ps1

# 安装登录启动和每日备份计划任务
.\scripts\Install-MarginaliaScheduledTasks.ps1

# 卸载计划任务（按脚本参数说明执行）
.\scripts\Uninstall-MarginaliaScheduledTasks.ps1
```

恢复演练不会覆盖真实 `backend/data/`。备份失败时保留旧的成功备份；计划任务只调用本机启动和备份脚本。

## 项目结构

```text
frontend/          静态 PWA 阅读器、IndexedDB 与同步
  app.js           书库、阅读、笔记管理、筛选、回收站与导出
  book-chat/       GPT 风格阅读器布局
backend/           FastAPI、SQLite、书库、同步、规则脚本与导出
  main.py          API 路由
  models.py        Pydantic 数据模型
  database.py      SQLite 访问
  runtime.py       ZeroTier 地址与端口运行时校验
data/              backend/data/ 下的书籍、数据库和运行数据
scripts/           本机备份、恢复和计划任务
```

## 数据与边界

服务是面向个人的无账号工具，ZeroTier 私有网络是访问边界。不要把服务端口暴露到公网。`.env.production` 是本地敏感文件，不属于本启动路径；请由用户自行归档或处理，项目不会读取、修改或删除它。

历史数据库中可能仍存在旧表和旧数据；它们不会被启动流程自动删除，也不代表当前运行时能力。

## 文档

- [产品范围](PRODUCT.md)
- [架构概览](docs/ARCHITECTURE.md)
