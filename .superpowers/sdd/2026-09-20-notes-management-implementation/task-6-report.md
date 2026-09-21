# Task 6 实施报告：服务端 Markdown 下载

## 状态

已实现 Task 6：新增纯函数 Markdown 渲染与带筛选条件的服务端下载接口；旧 JSON export 与 Obsidian 路径保持不变。

## 实现

- `backend/notes.py`
  - 新增 `escape_markdown_inline()`，依次转义反斜杠、反引号、`*`、`_`、`[`、`]`。
  - 新增 `markdown_blockquote()`，逐行输出 blockquote，覆盖多行和空字符串。
  - 新增 `render_notes_markdown()`：按 `(book_title, book_author)` 稳定分组，组内按 `(progress_percent, created_at, id)` 排序；输出文档标题、书名、作者、章节与进度、划线、可选感悟、可选标签、创建/更新时间。
  - 标题和内联元数据先折叠换行再转义，正文和感悟逐行放入 blockquote，避免用户内容生成同级标题或列表。
  - `offline=True` 时在标题下输出不完整提示；服务端下载显式使用 `False`。
  - 新增 `notes_markdown_filename()`，支持注入日期并默认使用 `date.today()`。
- `backend/main.py`
  - 新增 `GET /api/notes/export.md`，仅接受 `q/book_id/tag/note_kind/color`；拒绝分页、回收站、排序及其他额外参数。
  - 复用 `list_notes_for_export()`，因此不分页且只返回 active 笔记，并与列表过滤语义一致。
  - 空结果返回中文 422：`当前筛选条件下没有可导出的笔记`。
  - 使用内存 `Response` 返回 `text/markdown; charset=utf-8`，下载头同时提供 ASCII fallback 和 RFC 5987 UTF-8 文件名；不写磁盘或 Obsidian 目录。
  - 原 `GET /api/notes/export` 未修改，继续返回 JSON 文件。

## 严格 TDD 记录

1. 先新增 Markdown 纯函数测试；首次命令使用 brief 中 worktree 本地路径失败，因为该 worktree 没有独立 `.venv`。改用仓库根目录虚拟环境后得到预期 RED：测试收集因缺失 `escape_markdown_inline` 等函数失败。
2. 最小实现纯函数后，同一测试得到 GREEN：`7 passed`。
3. 先新增 Markdown API 筛选、下载头、空结果和参数边界测试；RED：`3 failed, 29 deselected`，均为端点尚不存在导致的预期 404。
4. 最小实现端点后，同一选择集得到 GREEN：`3 passed, 29 deselected`。

## 验证结果

在 `G:/Job/Marginalia/.worktrees/notes-management-implementation` 使用 `G:/Job/Marginalia/.venv/Scripts/python.exe`：

- `python -m pytest backend/tests/test_notes.py -q`
  - `7 passed`
- `python -m pytest backend/tests/test_notes_api.py -k "markdown" -q`
  - 最终复跑：`3 passed, 29 deselected, 1 warning`
- `python -m pytest backend/tests/test_api.py -k "NotesExport" -q`
  - `2 passed, 37 deselected, 2 warnings`
- `python -m pytest backend/tests/test_notes_api.py -q`
  - `32 passed, 1 warning`
- `python -m pytest backend/tests -q`
  - `178 passed, 21 warnings`
- `git diff --check`
  - 退出码 0；无 whitespace error，仅 Git 提示部分文件未来可能由 LF 转为 CRLF。

警告为既有测试基础设施问题：FastAPI TestClient 的 `httpx` 弃用警告，以及旧 fire-and-forget JSON export 测试中的 `aiosqlite` worker/event-loop-closed 警告；无测试失败。

## 关注点

- 未修改 `backend/tests/test_api.py`，因为现有 `TestNotesExport` 已完整覆盖旧 JSON 数组契约且回归通过。
- API 通过白名单拒绝未声明参数，确保不会悄悄接受 `limit/offset/view/sort` 或本地同步状态参数。
- 输出完全在内存生成；没有调用 `export_all_to_json()`、文件写入或 Obsidian 导出函数。
