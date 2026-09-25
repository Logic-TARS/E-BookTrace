# Local Operations Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用无 Docker 的一致性备份、恢复演练和 Windows 计划任务替换现有 Docker/Cloudflare 运维路径，删除活跃部署文件，并把所有受支持文档统一到本机 Python 3.11 + ZeroTier 架构。

**Architecture:** 备份脚本调用项目 `.venv` 中的 Python `sqlite3.Connection.backup()` 为每个 SQLite 主数据库创建在线一致副本，再复制其余运行数据并生成/复验 SHA-256 manifest；恢复演练只在临时目录重建并校验，不接触真实 `backend/data/`。计划任务直接调用 `start.bat` 和备份脚本并写日志；Docker、Compose、Cloudflare 文件与生产文档全部删除，部署文档原路径改写为 ZeroTier 本机运维手册以避免悬空链接。

**Tech Stack:** PowerShell 5.1+/7、Python 3.11 标准库 `sqlite3`、Windows Task Scheduler、SHA-256、FastAPI/Uvicorn、pytest、Playwright、ZeroTier。

**Spec:** `docs/superpowers/specs/2026-09-23-local-zerotier-no-ai-design.md`

## Global Constraints

- 执行顺序固定为 `remove-ai-core → zerotier-runtime → local-operations-cleanup`；开始本计划前，前两份计划的全部自动测试和真实 ZeroTier listener 验收必须通过。
- 不读取、打印、迁移、修改或删除 `.env.production`；它是敏感本地文件，只在文档中说明已不再使用、由用户自行归档或删除。
- 删除 `.env.production.example`，但绝不能以此为由操作 `.env.production`。
- 删除活跃 Docker/Cloudflare 路径：`docker-compose.yml`、`docker-compose.prod.yml`、`backend/Dockerfile`、`backend/Dockerfile.prod`、`.dockerignore`、`scripts/Start-MarginaliaProduction.ps1`、`.env.production.example`。
- 不创建 AI 数据删除脚本；历史 `qa_*` 表、legacy `knowledge_book_id` 列和历史数据继续保留。
- 备份源固定为 `backend/data/`，默认目标 `G:\Backups\Marginalia`，默认保留最近 14 份成功备份；失败时不得删除旧成功备份。
- 活跃 SQLite 文件不能裸拷贝：使用 Python `sqlite3.Connection.backup()` 在线备份 API；`-SkipServiceStop` 不再作为绕过一致性的参数。
- 每个备份目录格式为时间戳目录 `yyyyMMdd-HHmmss`，目录内包含完整 `data/` 树和 `manifest.json`；manifest 每个文件含相对 `path`、`bytes`、小写 SHA-256，并记录 `sqliteIntegrity: ok`。
- manifest 写完后必须立即从磁盘重新读取并逐文件复验，再把 staging 目录原子改名为成功备份；只有成功备份计入 retention。
- 恢复演练只复制到系统临时目录，验证 manifest、SQLite `PRAGMA integrity_check`、关键目录/文件，不覆盖真实 `backend/data/`，不创建 Docker volume，finally 清理临时目录。
- 计划任务登录时调用仓库 `start.bat`；每日调用 `Backup-Marginalia.ps1`；不启动 Docker Desktop、Compose 或 Cloudflare Tunnel。
- 不加入 TLS；文档必须明确 HTTP ZeroTier IP 的远端阅读/同步验收和浏览器 Service Worker 安全上下文验收分离。
- 文档不得再把 AI、Docker、Cloudflare、公网、TLS、localhost 默认绑定描述为受支持运行路径；历史设计 spec 可保留原文，不因清理而篡改。
- pytest 使用进程级测试环境隔离真实 `.env`；不自动创建或提交用户真实 `.env`。
- 每个任务严格 TDD：先失败测试/脚本断言，再最小实现，再通过，再独立提交。
- 本计划中的 `git commit` 是未来执行步骤；编写计划时不执行任何提交。

---

## Prerequisite Verification: 建立运维清理前基线与文件清单

**Files:**
- Inspect: `scripts/Backup-Marginalia.ps1`
- Inspect: `scripts/Test-MarginaliaRestore.ps1`
- Inspect: `scripts/Install-MarginaliaScheduledTasks.ps1`
- Inspect: `scripts/Start-MarginaliaProduction.ps1`
- Inspect: Docker/Compose files listed in Global Constraints
- Inspect: `README.md`, `PRODUCT.md`, `DESIGN.md`, `CLAUDE.md`, `AGENTS.md`, `docs/ARCHITECTURE.md`, `docs/PRODUCTION_DEPLOYMENT.md`
- Create during execution: `.git/local-operations-baseline.txt`（本地、不提交）

**Interfaces:**
- Consumes: completed ZeroTier runtime and current tracked file list。
- Produces: immutable execution inventory and green baseline before destructive file deletions。

- [ ] **Step 1: 确认前序 runtime 没有危险 fallback**

Run:

```bash
python -c "from pathlib import Path; t=Path('backend/runtime.py').read_text(encoding='utf-8'); assert 'select_zerotier_ipv4' in t; assert 'startswith(\"10.\")' not in t"
python -c "from pathlib import Path; t=Path('backend/main.py').read_text(encoding='utf-8'); assert 'host=\"0.0.0.0\"' not in t"
```

Expected: exit 0。

- [ ] **Step 2: 记录待删除文件确实被 Git 跟踪**

Run:

```bash
git ls-files .dockerignore .env.production.example backend/Dockerfile backend/Dockerfile.prod docker-compose.yml docker-compose.prod.yml scripts/Start-MarginaliaProduction.ps1
```

Expected: exactly eight paths are listed。Do not inspect `.env.production`。

- [ ] **Step 3: 运行完整自动测试基线**

Run:

```bash
ALLOWED_HOSTS="localhost,127.0.0.1,testserver" CORS_ORIGINS="http://testserver" .venv/Scripts/python.exe -m pytest backend/tests -q
cd frontend && npx playwright test
```

Expected: both suites fully PASS。

- [ ] **Step 4: 记录脚本中当前 Docker 引用但不执行 Docker**

Run:

```bash
python - <<'PY'
from pathlib import Path
for path in Path('scripts').glob('*.ps1'):
    text=path.read_text(encoding='utf-8')
    if 'docker' in text.casefold() or 'cloudflare' in text.casefold():
        print(path)
PY
```

Expected: current output includes backup、restore、scheduled tasks and production startup scripts；this is the removal baseline。

- [ ] **Step 5: 写本地记录且不提交**

Run:

```bash
{
  date -Iseconds
  git rev-parse HEAD
  git ls-files .dockerignore .env.production.example backend/Dockerfile backend/Dockerfile.prod docker-compose.yml docker-compose.prod.yml scripts/Start-MarginaliaProduction.ps1
} > .git/local-operations-baseline.txt
```

Expected: file exists only under `.git/`。

---

### Task 1: 创建 PowerShell 测试 harness 并统一脚本严格模式

**Files:**
- Create: `backend/tests/test_operations_scripts.py`
- Modify: `scripts/Backup-Marginalia.ps1`
- Modify: `scripts/Test-MarginaliaRestore.ps1`
- Modify: `scripts/Install-MarginaliaScheduledTasks.ps1`

**Interfaces:**
- Consumes: repository `scripts/` directory and UTF-8 PowerShell source files。
- Produces: `ROOT: Path`、`SCRIPTS: Path`、`read_script(name: str) -> str` shared by Tasks 2-4；三个现有脚本均启用 `Set-StrictMode -Version Latest`。

- [ ] **Step 1: 写 strict-mode 失败测试与 harness**

Create `backend/tests/test_operations_scripts.py`:

```python
from pathlib import Path


ROOT = Path(__file__).parents[2]
SCRIPTS = ROOT / "scripts"


def read_script(name: str) -> str:
    return (SCRIPTS / name).read_text(encoding="utf-8")


def test_current_operations_scripts_enable_strict_mode():
    for name in (
        "Backup-Marginalia.ps1",
        "Test-MarginaliaRestore.ps1",
        "Install-MarginaliaScheduledTasks.ps1",
    ):
        text = read_script(name)
        assert "[CmdletBinding()]" in text
        assert "Set-StrictMode -Version Latest" in text
```

- [ ] **Step 2: 运行测试并确认 strict mode 缺失**

Run:

```bash
.venv/Scripts/python.exe -m pytest backend/tests/test_operations_scripts.py -q
```

Expected: FAIL because the current scripts do not contain `Set-StrictMode -Version Latest`。

- [ ] **Step 3: 为三个脚本加入最小严格模式实现**

In each listed script, insert immediately after `$ErrorActionPreference = "Stop"`:

```powershell
Set-StrictMode -Version Latest
```

- [ ] **Step 4: 运行 harness test**

Run:

```bash
.venv/Scripts/python.exe -m pytest backend/tests/test_operations_scripts.py -q
```

Expected: `1 passed`。

- [ ] **Step 5: Commit**

```bash
git add backend/tests/test_operations_scripts.py scripts/Backup-Marginalia.ps1 scripts/Test-MarginaliaRestore.ps1 scripts/Install-MarginaliaScheduledTasks.ps1
git commit -m "Enable strict mode in local operations scripts"
```

---

### Task 2: 重写 Backup-Marginalia.ps1 为在线一致性本机备份

**Files:**
- Replace: `scripts/Backup-Marginalia.ps1`
- Test: `backend/tests/test_operations_scripts.py`

**Interfaces:**
- Consumes: `backend/data/`, `.venv\Scripts\python.exe`, `sqlite3.Connection.backup()`, destination and retention parameters。
- Produces: successful timestamp backup directory and manifest；nonzero exception on any failure；old successful backups untouched unless a new backup passes complete post-write verification。

- [ ] **Step 1: 写 backup 专属失败测试**

Append to `backend/tests/test_operations_scripts.py`:

```python
def test_backup_uses_online_sqlite_backup_and_ps51_relative_path_helper():
    text = read_script("Backup-Marginalia.ps1")
    assert "sqlite3.connect(source)" in text
    assert "source_db.backup(destination_db)" in text
    assert "PRAGMA integrity_check" in text
    assert "function Get-RelativePath" in text
    assert "[IO.Path]::GetRelativePath" not in text
    assert ".incomplete" in text
    assert "manifest.json" in text
    assert "Retention = 14" in text
    assert "docker" not in text.casefold()
    assert "cloudflare" not in text.casefold()
    assert "SkipServiceStop" not in text
```

Run:

```bash
.venv/Scripts/python.exe -m pytest backend/tests/test_operations_scripts.py::test_backup_uses_online_sqlite_backup_and_ps51_relative_path_helper -q
```

Expected: FAIL because the current backup script uses Docker and has no online-backup/PowerShell-5.1 relative-path helper。

- [ ] **Step 2: 定义参数、路径边界和 PowerShell 5.1 helper**

Replace script header with:

```powershell
[CmdletBinding()]
param(
    [string]$SourceData,
    [string]$Destination = "G:\Backups\Marginalia",
    [ValidateRange(1, 365)]
    [int]$Retention = 14
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Get-Sha256Hex([string]$Path) {
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Get-RelativePath([string]$Root, [string]$Path) {
    $rootFull = [IO.Path]::GetFullPath($Root).TrimEnd('\') + '\'
    $pathFull = [IO.Path]::GetFullPath($Path)
    if (-not $pathFull.StartsWith($rootFull, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Path is outside root: $pathFull"
    }
    return $pathFull.Substring($rootFull.Length)
}

function Resolve-ChildPath([string]$Root, [string]$RelativePath) {
    if ([IO.Path]::IsPathRooted($RelativePath)) {
        throw "Rooted relative path is not allowed: $RelativePath"
    }
    $rootFull = [IO.Path]::GetFullPath($Root).TrimEnd('\') + '\'
    $candidate = [IO.Path]::GetFullPath((Join-Path $rootFull $RelativePath))
    if (-not $candidate.StartsWith($rootFull, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Path escapes root: $RelativePath"
    }
    return $candidate
}
```

Resolve `$repoRoot`, default `$SourceData = Join-Path $repoRoot "backend\data"`, `.venv\Scripts\python.exe`, destination; reject destination drive root and absent source/Python。No service stop switch or Docker detection remains。

- [ ] **Step 3: 创建 incomplete staging 而不是立即创建成功目录**

Use:

```powershell
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$stagingRoot = Join-Path $destinationPath "$stamp.incomplete"
$backupRoot = Join-Path $destinationPath $stamp
$backupData = Join-Path $stagingRoot "data"
if ((Test-Path $stagingRoot) -or (Test-Path $backupRoot)) {
    throw "Backup path already exists for timestamp $stamp"
}
New-Item -ItemType Directory -Path $backupData -Force | Out-Null
```

- [ ] **Step 4: 用 Python online backup 复制每个 SQLite 主库**

Enumerate `*.db`, `*.sqlite`, `*.sqlite3` files recursively, excluding `-wal`/`-shm` sidecars。For each source database, create destination parent and run exactly this Python snippet through `-c`:

```python
import sqlite3, sys
source, destination = sys.argv[1:3]
source_db = sqlite3.connect(source)
destination_db = sqlite3.connect(destination)
try:
    source_db.backup(destination_db)
    result = destination_db.execute("PRAGMA integrity_check").fetchone()[0]
    if result != "ok":
        raise SystemExit(f"integrity_check={result}")
finally:
    destination_db.close()
    source_db.close()
print("ok")
```

PowerShell must check `$LASTEXITCODE -eq 0` and output equals `ok`; otherwise throw。This is the consistency mechanism while service remains available。

- [ ] **Step 5: 复制所有非 SQLite 运行数据**

For each source file returned by `Get-ChildItem -LiteralPath $sourcePath -Recurse -File`, skip names ending in `-wal` or `-shm` and skip files already handled as primary SQLite databases。Use these exact destination operations:

```powershell
$relative = Get-RelativePath -Root $sourcePath -Path $file.FullName
$target = Resolve-ChildPath -Root $backupData -RelativePath $relative
$targetParent = Split-Path -Parent $target
New-Item -ItemType Directory -Path $targetParent -Force | Out-Null
Copy-Item -LiteralPath $file.FullName -Destination $target -Force
```

This copies EPUBs、`notes.json`、TTS assets、logs and every other non-SQLite runtime file。

- [ ] **Step 6: 生成并从磁盘复验 manifest**

Build sorted records:

```powershell
$files = @(
    Get-ChildItem -LiteralPath $backupData -Recurse -File |
        Sort-Object FullName |
        ForEach-Object {
            $relative = Get-RelativePath -Root $backupData -Path $_.FullName
            [ordered]@{
                path = $relative
                bytes = $_.Length
                sha256 = Get-Sha256Hex $_.FullName
            }
        }
)
$manifest = [ordered]@{
    formatVersion = 2
    createdAt = (Get-Date).ToString("o")
    source = $sourcePath
    sqliteIntegrity = "ok"
    files = $files
}
$manifestPath = Join-Path $stagingRoot "manifest.json"
$manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $manifestPath -Encoding utf8
$verified = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
```

Verify every manifest entry with this exact loop:

```powershell
foreach ($file in $verified.files) {
    $candidate = Resolve-ChildPath -Root $backupData -RelativePath ([string]$file.path)
    if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
        throw "Manifest file is missing: $($file.path)"
    }
    $item = Get-Item -LiteralPath $candidate
    if ($item.Length -ne [long]$file.bytes) {
        throw "Size mismatch: $($file.path)"
    }
    if ((Get-Sha256Hex $candidate) -ne [string]$file.sha256) {
        throw "Hash mismatch: $($file.path)"
    }
}
if ((Test-Path -LiteralPath (Join-Path $sourcePath "marginalia.db")) -and
    -not ($verified.files.path -contains "marginalia.db")) {
    throw "Manifest is missing marginalia.db"
}
```

- [ ] **Step 7: 原子发布成功备份后才执行 retention**

Use:

```powershell
Move-Item -LiteralPath $stagingRoot -Destination $backupRoot
$expired = @(Get-ChildItem -LiteralPath $destinationPath -Directory |
    Where-Object { $_.Name -match '^\d{8}-\d{6}$' } |
    Sort-Object Name -Descending |
    Select-Object -Skip $Retention)
```

Use this exact removal and failure cleanup:

```powershell
foreach ($directory in $expired) {
    $resolved = [IO.Path]::GetFullPath($directory.FullName)
    if ([IO.Path]::GetDirectoryName($resolved) -ne $destinationPath) {
        throw "Refusing to remove a backup outside $destinationPath"
    }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
```

Wrap staging work in `try/catch`; in `catch`, remove `$stagingRoot` only when its full-path parent equals `$destinationPath` and its name ends with `.incomplete`, then `throw`。Never remove `$backupRoot` or an older timestamp directory on failure。

- [ ] **Step 8: 运行静态契约测试**

Run:

```bash
ALLOWED_HOSTS="localhost,127.0.0.1,testserver" CORS_ORIGINS="http://testserver" .venv/Scripts/python.exe -m pytest backend/tests/test_operations_scripts.py::test_backup_uses_online_sqlite_backup_and_ps51_relative_path_helper -q
```

Expected: PASS。

- [ ] **Step 9: 在临时数据上执行真实备份，包括 WAL 写入场景**

Run in PowerShell:

```powershell
$root = Join-Path $env:TEMP ("marginalia-backup-test-" + [guid]::NewGuid())
$data = Join-Path $root "data"
$backups = Join-Path $root "backups"
New-Item -ItemType Directory -Path (Join-Path $data "books") -Force | Out-Null
& .\.venv\Scripts\python.exe -c "import sqlite3,sys; p=sys.argv[1]; c=sqlite3.connect(p); c.execute('PRAGMA journal_mode=WAL'); c.execute('create table notes(id integer primary key, text text)'); c.execute('insert into notes(text) values (?)',('kept',)); c.commit(); c.close()" (Join-Path $data "marginalia.db")
Set-Content -LiteralPath (Join-Path $data "notes.json") -Value '[{"id":1}]' -Encoding utf8
Set-Content -LiteralPath (Join-Path $data "books\fixture.epub") -Value 'fixture' -Encoding utf8
& .\scripts\Backup-Marginalia.ps1 -SourceData $data -Destination $backups -Retention 14
if ($LASTEXITCODE -ne 0) { throw "Backup command failed" }
$latest = Get-ChildItem $backups -Directory | Where-Object Name -Match '^\d{8}-\d{6}$' | Sort-Object Name -Descending | Select-Object -First 1
if (-not (Test-Path (Join-Path $latest.FullName "manifest.json"))) { throw "Manifest missing" }
Remove-Item -LiteralPath $root -Recurse -Force
```

Expected: output includes `Backup complete` and `SQLite integrity: ok`; no `.incomplete` remains。

- [ ] **Step 10: Commit**

```bash
git add scripts/Backup-Marginalia.ps1 backend/tests/test_operations_scripts.py
git commit -m "Back up local data without Docker"
```

---

### Task 3: 重写 Test-MarginaliaRestore.ps1 为临时目录恢复演练

**Files:**
- Replace: `scripts/Test-MarginaliaRestore.ps1`
- Test: `backend/tests/test_operations_scripts.py`

**Interfaces:**
- Consumes: formatVersion 2 manifest and backup `data/` tree。
- Produces: hash-verified temporary restore copy、SQLite integrity checks、critical file assertions；always cleans temp directory；never references repository `backend/data` as destination。

- [ ] **Step 1: 写 restore 专属失败测试**

Append to `backend/tests/test_operations_scripts.py`:

```python
def test_restore_uses_safe_temp_paths_without_docker():
    text = read_script("Test-MarginaliaRestore.ps1")
    assert "GetTempPath" in text
    assert "function Resolve-ChildPath" in text
    assert "PRAGMA integrity_check" in text
    assert "manifest.json" in text
    assert "backend\\data" not in text
    assert "docker" not in text.casefold()
    assert "volume" not in text.casefold()
    assert "Remove-Item -LiteralPath $restoreRoot -Recurse -Force" in text
```

Run:

```bash
.venv/Scripts/python.exe -m pytest backend/tests/test_operations_scripts.py::test_restore_uses_safe_temp_paths_without_docker -q
```

Expected: FAIL because the current restore drill requires Docker volumes and has no safe-path helper。

- [ ] **Step 2: 定义无 Docker 参数与路径约束**

Use:

```powershell
[CmdletBinding()]
param(
    [string]$BackupRoot = "G:\Backups\Marginalia",
    [string]$Backup
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Get-Sha256Hex([string]$Path) {
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Resolve-ChildPath([string]$Root, [string]$RelativePath) {
    if ([IO.Path]::IsPathRooted($RelativePath)) {
        throw "Rooted relative path is not allowed: $RelativePath"
    }
    $rootFull = [IO.Path]::GetFullPath($Root).TrimEnd('\') + '\'
    $candidate = [IO.Path]::GetFullPath((Join-Path $rootFull $RelativePath))
    if (-not $candidate.StartsWith($rootFull, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Path escapes root: $RelativePath"
    }
    return $candidate
}
```

Remove `HelperImage`, `KeepVolume`, all Docker commands and volume/container variables。

- [ ] **Step 3: 选择备份并安全解析 manifest**

If `-Backup` is absent, select the latest directory matching `^\d{8}-\d{6}$` that contains `manifest.json`。Require `formatVersion -eq 2`, `manifest.json`, `data/`, and at least one manifest file record。Resolve every source with `Resolve-ChildPath -Root $dataPath -RelativePath ([string]$file.path)` before reading it。

- [ ] **Step 4: 创建唯一临时恢复目录并复制 manifest 列出的文件**

Use:

```powershell
$restoreRoot = Join-Path ([IO.Path]::GetTempPath()) ("marginalia-restore-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $restoreRoot -Force | Out-Null
foreach ($file in $manifest.files) {
    $source = Resolve-ChildPath -Root $dataPath -RelativePath ([string]$file.path)
    $destination = Resolve-ChildPath -Root $restoreRoot -RelativePath ([string]$file.path)
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
        throw "Backup file is missing: $($file.path)"
    }
    New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
    Copy-Item -LiteralPath $source -Destination $destination -Force
}
```

Do not call `Copy-Item` with `backend/data` as destination。

- [ ] **Step 5: 复验所有 hash/size 和关键文件**

Use:

```powershell
foreach ($file in $manifest.files) {
    $restored = Resolve-ChildPath -Root $restoreRoot -RelativePath ([string]$file.path)
    $item = Get-Item -LiteralPath $restored
    if ($item.Length -ne [long]$file.bytes) {
        throw "Restored size mismatch: $($file.path)"
    }
    if ((Get-Sha256Hex $restored) -ne [string]$file.sha256) {
        throw "Restored hash mismatch: $($file.path)"
    }
}
if (-not (Test-Path -LiteralPath (Join-Path $restoreRoot "marginalia.db") -PathType Leaf)) {
    throw "Restored marginalia.db is missing"
}
$bookEntries = @($manifest.files | Where-Object { ([string]$_.path) -like "books\\*" })
foreach ($bookEntry in $bookEntries) {
    $bookPath = Resolve-ChildPath -Root $restoreRoot -RelativePath ([string]$bookEntry.path)
    if (-not (Test-Path -LiteralPath $bookPath -PathType Leaf)) {
        throw "Restored book is missing: $($bookEntry.path)"
    }
}
if (($manifest.files.path -contains "notes.json") -and
    -not (Test-Path -LiteralPath (Join-Path $restoreRoot "notes.json") -PathType Leaf)) {
    throw "Restored notes.json is missing"
}
```

- [ ] **Step 6: 对每个恢复 SQLite 主库运行 integrity_check**

Use project `.venv\Scripts\python.exe` and:

```python
import sqlite3, sys
connection = sqlite3.connect(sys.argv[1])
try:
    print(connection.execute("PRAGMA integrity_check").fetchone()[0])
finally:
    connection.close()
```

Require exactly `ok` and zero exit for every `.db/.sqlite/.sqlite3` listed in manifest。

- [ ] **Step 7: finally 清理临时目录**

Use exact block:

```powershell
finally {
    if (Test-Path -LiteralPath $restoreRoot) {
        Remove-Item -LiteralPath $restoreRoot -Recurse -Force
    }
}
```

Success output must include `Restore drill passed` and `SQLite integrity: ok`。

- [ ] **Step 8: 运行静态契约测试**

Run:

```bash
ALLOWED_HOSTS="localhost,127.0.0.1,testserver" CORS_ORIGINS="http://testserver" .venv/Scripts/python.exe -m pytest backend/tests/test_operations_scripts.py::test_restore_uses_safe_temp_paths_without_docker -q
```

Expected: PASS。

- [ ] **Step 9: 创建独立临时 fixture 并执行恢复演练**

Run in PowerShell:

```powershell
$root = Join-Path $env:TEMP ("marginalia-restore-test-" + [guid]::NewGuid())
$data = Join-Path $root "data"
$backups = Join-Path $root "backups"
New-Item -ItemType Directory -Path (Join-Path $data "books") -Force | Out-Null
& .\.venv\Scripts\python.exe -c "import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.execute('create table x(id integer)'); c.execute('insert into x values (1)'); c.commit(); c.close()" (Join-Path $data "marginalia.db")
Set-Content -LiteralPath (Join-Path $data "notes.json") -Value '[]' -Encoding utf8
Set-Content -LiteralPath (Join-Path $data "books\fixture.epub") -Value 'fixture' -Encoding utf8
& .\scripts\Backup-Marginalia.ps1 -SourceData $data -Destination $backups
& .\scripts\Test-MarginaliaRestore.ps1 -BackupRoot $backups
if ($LASTEXITCODE -ne 0) { throw "Restore drill failed" }
Remove-Item -LiteralPath $root -Recurse -Force
```

Expected: output includes `Restore drill passed` and no `marginalia-restore-*` directory remains for this run。

- [ ] **Step 10: Commit**

```bash
git add scripts/Test-MarginaliaRestore.ps1 backend/tests/test_operations_scripts.py
git commit -m "Test restores in a local temporary directory"
```

---

### Task 4: 重写计划任务安装并新增卸载脚本

**Files:**
- Replace: `scripts/Install-MarginaliaScheduledTasks.ps1`
- Create: `scripts/Uninstall-MarginaliaScheduledTasks.ps1`
- Modify: `backend/tests/test_operations_scripts.py`

**Interfaces:**
- Consumes: `start.bat`, `Backup-Marginalia.ps1`, current interactive user, Task Scheduler。
- Produces: tasks `Marginalia Local Startup` and `Marginalia Daily Backup`；logs under `backend/data/logs`；uninstaller removes exactly those two tasks。

- [ ] **Step 1: 写 scheduled-task 专属失败测试**

Append:

```python
def test_scheduled_tasks_use_noninteractive_start_and_separate_limits():
    text = read_script("Install-MarginaliaScheduledTasks.ps1")
    assert 'Marginalia Local Startup' in text
    assert 'Marginalia Daily Backup' in text
    assert 'start.bat --no-browser --non-interactive' in text
    assert '$startupSettings.ExecutionTimeLimit = [TimeSpan]::Zero' in text
    assert '$backupSettings.ExecutionTimeLimit = New-TimeSpan -Hours 1' in text
    assert 'backend\\data\\logs' in text
    assert 'Backup-Marginalia.ps1' in text
    assert 'Uninstall-MarginaliaScheduledTasks.ps1' in text
    assert "docker" not in text.casefold()
    assert "cloudflare" not in text.casefold()


def test_uninstall_script_removes_only_named_marginalia_tasks():
    path = SCRIPTS / "Uninstall-MarginaliaScheduledTasks.ps1"
    assert path.exists()
    text = path.read_text(encoding="utf-8")
    assert 'Marginalia Local Startup' in text
    assert 'Marginalia Daily Backup' in text
    assert "Unregister-ScheduledTask" in text
    assert "docker" not in text.casefold()
```

- [ ] **Step 2: 运行测试并确认卸载文件不存在**

Run:

```bash
ALLOWED_HOSTS="localhost,127.0.0.1,testserver" CORS_ORIGINS="http://testserver" .venv/Scripts/python.exe -m pytest backend/tests/test_operations_scripts.py -q
```

Expected: collection/test FAIL with missing `Uninstall-MarginaliaScheduledTasks.ps1` and scheduled-task old production references。

- [ ] **Step 3: 实现本机计划任务安装**

Use parameters:

```powershell
[CmdletBinding()]
param(
    [string]$BackupAt = "03:00",
    [string]$BackupDestination = "G:\Backups\Marginalia",
    [switch]$DisableSleepOnAC
)
```

Set `$repoRoot`, `$logs = Join-Path $repoRoot "backend\data\logs"`, create logs。Use task names exactly `Marginalia Local Startup` and `Marginalia Daily Backup`。

Build startup action arguments from resolved paths:

```powershell
$startBat = Join-Path $repoRoot "start.bat"
$startupLog = Join-Path $logs "startup.log"
$startupArguments = '/d /c ""{0}" --no-browser --non-interactive >> "{1}" 2>&1"' -f $startBat, $startupLog
$startAction = New-ScheduledTaskAction -Execute $env:COMSPEC -Argument $startupArguments
```

Build backup action arguments without path placeholders:

```powershell
$backupScript = Join-Path $PSScriptRoot "Backup-Marginalia.ps1"
$backupLog = Join-Path $logs "backup.log"
$escapedScript = $backupScript.Replace("'", "''")
$escapedDestination = ([IO.Path]::GetFullPath($BackupDestination)).Replace("'", "''")
$backupCommand = "& '$escapedScript' -Destination '$escapedDestination'; exit `$LASTEXITCODE"
$backupArguments = '-NoProfile -ExecutionPolicy Bypass -Command "{0}" >> "{1}" 2>&1' -f $backupCommand, $backupLog
$backupAction = New-ScheduledTaskAction -Execute $pwsh -Argument $backupArguments
```

Create separate task settings:

```powershell
$startupSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable
$startupSettings.ExecutionTimeLimit = [TimeSpan]::Zero
$backupSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable
$backupSettings.ExecutionTimeLimit = New-TimeSpan -Hours 1
```

Register the logon task with `$startupSettings` and the daily parsed `HH:mm` backup task with `$backupSettings`。Do not mention Docker Desktop。

- [ ] **Step 4: 实现精确卸载脚本**

Create:

```powershell
[CmdletBinding(SupportsShouldProcess)]
param()

$ErrorActionPreference = "Stop"
$taskNames = @("Marginalia Local Startup", "Marginalia Daily Backup")
foreach ($taskName in $taskNames) {
    $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if ($task -and $PSCmdlet.ShouldProcess($taskName, "Unregister scheduled task")) {
        Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    }
}
Write-Output "Marginalia scheduled tasks removed."
```

- [ ] **Step 5: 运行静态契约和 PowerShell parser 检查**

Run:

```bash
ALLOWED_HOSTS="localhost,127.0.0.1,testserver" CORS_ORIGINS="http://testserver" .venv/Scripts/python.exe -m pytest backend/tests/test_operations_scripts.py -q
powershell.exe -NoProfile -Command '$files=@("scripts/Backup-Marginalia.ps1","scripts/Test-MarginaliaRestore.ps1","scripts/Install-MarginaliaScheduledTasks.ps1","scripts/Uninstall-MarginaliaScheduledTasks.ps1"); foreach($f in $files){$errors=$null; [void][System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path $f),[ref]$null,[ref]$errors); if($errors){$errors|ForEach-Object{Write-Error $_}; exit 1}}'
```

Expected: tests PASS and parser exits 0。

- [ ] **Step 6: 在 Windows 测试主机安装、查询、再卸载任务**

Run in PowerShell (administrator only if local policy requires):

```powershell
& .\scripts\Install-MarginaliaScheduledTasks.ps1 -BackupAt "03:17" -BackupDestination "$env:TEMP\MarginaliaBackups"
Get-ScheduledTask -TaskName "Marginalia Local Startup","Marginalia Daily Backup" | Select-Object TaskName,State
& .\scripts\Uninstall-MarginaliaScheduledTasks.ps1 -Confirm:$false
if (Get-ScheduledTask -TaskName "Marginalia Local Startup","Marginalia Daily Backup" -ErrorAction SilentlyContinue) { throw "Tasks still installed" }
```

Expected: exactly two tasks appear, then neither remains。Use 03:17 to avoid herd-prone exact half-hour in this test; documentation may retain user-selected daily time。

- [ ] **Step 7: Commit**

```bash
git add scripts/Install-MarginaliaScheduledTasks.ps1 scripts/Uninstall-MarginaliaScheduledTasks.ps1 backend/tests/test_operations_scripts.py
git commit -m "Run local startup and backup as scheduled tasks"
```

---

### Task 5: 删除 Docker/Cloudflare 活跃文件且保护 .env.production

**Files:**
- Delete: `.dockerignore`
- Delete: `.env.production.example`
- Delete: `backend/Dockerfile`
- Delete: `backend/Dockerfile.prod`
- Delete: `docker-compose.yml`
- Delete: `docker-compose.prod.yml`
- Delete: `scripts/Start-MarginaliaProduction.ps1`
- Modify: `backend/main.py:110-119`
- Modify: `backend/tests/test_api.py:86-99`
- Modify: `backend/tests/test_operations_scripts.py`

**Interfaces:**
- Consumes: rewritten native scripts from Tasks 3-5。
- Produces: no tracked Docker/Cloudflare execution entry points；API cache policy remains `private, no-store` + `Pragma: no-cache` without vendor-specific headers；`.env.production` remains untouched/unread local state。

- [ ] **Step 1: 写待删除文件失败测试**

Add:

```python
def test_docker_and_cloudflare_runtime_files_are_absent():
    forbidden = (
        ".dockerignore",
        ".env.production.example",
        "backend/Dockerfile",
        "backend/Dockerfile.prod",
        "docker-compose.yml",
        "docker-compose.prod.yml",
        "scripts/Start-MarginaliaProduction.ps1",
    )
    assert [path for path in forbidden if (ROOT / path).exists()] == []
```

- [ ] **Step 2: 运行测试并确认七个 tracked paths 存在**

Run:

```bash
ALLOWED_HOSTS="localhost,127.0.0.1,testserver" CORS_ORIGINS="http://testserver" .venv/Scripts/python.exe -m pytest backend/tests/test_operations_scripts.py::test_docker_and_cloudflare_runtime_files_are_absent -q
```

Expected: FAIL listing all seven paths。

- [ ] **Step 3: 删除精确文件列表**

Run:

```bash
git rm .dockerignore .env.production.example backend/Dockerfile backend/Dockerfile.prod docker-compose.yml docker-compose.prod.yml scripts/Start-MarginaliaProduction.ps1
```

Expected: only the seven listed files are staged for deletion。

- [ ] **Step 4: 明确证明没有触碰敏感本地文件**

Run:

```bash
git status --short
git ls-files .env.production
```

Expected: `.env.production` 不在 tracked list，也不在 staged/modified output。Do not run commands that read its contents。

- [ ] **Step 5: 写 vendor-neutral cache-header 失败测试**

Replace the header assertions in `backend/tests/test_api.py::TestHealth::test_api_responses_are_not_cacheable` with:

```python
assert resp.headers["cache-control"] == "private, no-store"
assert resp.headers["pragma"] == "no-cache"
assert "cdn-cache-control" not in resp.headers
assert "cloudflare-cdn-cache-control" not in resp.headers
```

Also add to `test_static_assets_keep_pwa_cache_policy`:

```python
assert "cdn-cache-control" not in resp.headers
assert "cloudflare-cdn-cache-control" not in resp.headers
```

Run:

```bash
ALLOWED_HOSTS="localhost,127.0.0.1,testserver" CORS_ORIGINS="http://testserver" .venv/Scripts/python.exe -m pytest backend/tests/test_api.py::TestHealth::test_api_responses_are_not_cacheable -q
```

Expected: FAIL because current middleware still emits both vendor-specific CDN headers。

- [ ] **Step 6: 删除 Cloudflare-specific response headers**

In `backend/main.py:add_private_api_cache_headers`, keep:

```python
response.headers["Cache-Control"] = "private, no-store"
response.headers["Pragma"] = "no-cache"
```

Delete only the `CDN-Cache-Control` and `Cloudflare-CDN-Cache-Control` assignments。The Service Worker API network-only behavior remains unchanged。

- [ ] **Step 7: 运行 operations 和 API cache tests**

Run:

```bash
ALLOWED_HOSTS="localhost,127.0.0.1,testserver" CORS_ORIGINS="http://testserver" .venv/Scripts/python.exe -m pytest backend/tests/test_operations_scripts.py backend/tests/test_api.py::TestHealth -q
```

Expected: all tests PASS。

- [ ] **Step 8: Commit**

```bash
git add backend/main.py backend/tests/test_api.py backend/tests/test_operations_scripts.py
git commit -m "Remove Docker and Cloudflare runtime files"
```

---

### Task 6: 更新 README 与 PRODUCT 为支持中的产品/运行边界

**Files:**
- Modify: `README.md`
- Modify: `PRODUCT.md`
- Create: `backend/tests/test_documentation_contract.py`

**Interfaces:**
- Consumes: current APIs、ZeroTier runtime、native operations scripts。
- Produces: user-facing quick start and product scope with no AI/Docker/Cloudflare claims；retained drafts CRUD/rules/Obsidian described accurately。

- [ ] **Step 1: 写 README/PRODUCT 文档失败测试**

Create `backend/tests/test_documentation_contract.py`:

```python
from pathlib import Path


ROOT = Path(__file__).parents[2]


def text(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def test_readme_describes_native_zerotier_runtime_and_retained_features():
    content = text("README.md")
    for required in (
        "start.bat", "SERVER_HOST", "SERVER_PORT", "ZeroTier",
        "/api/books/upload", "protocol v2", "GPT 风格阅读器",
        "/api/generate-script", "/api/obsidian/export",
        "GET/PATCH/DELETE /api/drafts/{draft_id}",
        "Backup-Marginalia.ps1", "Test-MarginaliaRestore.ps1",
    ):
        assert required in content
    for forbidden in ("docker compose", "Cloudflare", "/api/books/ask", "/api/knowledge/", "/api/drafts/generate", "LLM_BASE_URL", "EMBEDDING_MODEL"):
        assert forbidden.casefold() not in content.casefold()


def test_product_positions_ai_free_local_reader():
    content = text("PRODUCT.md")
    for required in ("ZeroTier", "GPT 风格阅读器", "本地优先", "规则式脚本", "Obsidian"):
        assert required in content
    for forbidden in ("AI 问答", "向量", "Embedding", "LLM", "Cloudflare", "Docker"):
        assert forbidden.casefold() not in content.casefold()
```

- [ ] **Step 2: 运行文档测试并确认旧内容失败**

Run:

```bash
ALLOWED_HOSTS="localhost,127.0.0.1,testserver" CORS_ORIGINS="http://testserver" .venv/Scripts/python.exe -m pytest backend/tests/test_documentation_contract.py -q
```

Expected: two tests FAIL on old Docker/AI text and missing ZeroTier instructions。

- [ ] **Step 3: 重写 README 快速开始与架构**

README must include exact supported flow:

```markdown
1. Install ZeroTier on the server and client, join the same private network.
2. Copy `.env.example` to `.env` manually if desired; set the server's verified ZeroTier IPv4 in `SERVER_HOST`, `SERVER_PORT=8720`, matching `CORS_ORIGINS` and `ALLOWED_HOSTS`.
3. Run `start.bat` on Windows or `./start.sh` on POSIX.
4. Open `http://SERVER_HOST_VALUE:SERVER_PORT_VALUE` from a ZeroTier member device.
```

State explicitly: no account auth, no public port forwarding, no LAN/all-interface fallback, no TLS in this scope。Describe HTTP ZeroTier IP secure-context limitation separately from reading/sync。List retained endpoint families and say `POST /api/drafts/generate` is absent while `GET/PATCH/DELETE /api/drafts/{draft_id}` remains for historical drafts。Document backup/restore/install/uninstall commands and default 14 retention。

- [ ] **Step 4: 重写 PRODUCT 范围与原则**

Position product as main EPUB reader + GPT-style layout reader + notes/sync/exports over trusted ZeroTier。Remove all AI Q&A/vector/model dependency claims。Keep rules-based script generation and Obsidian/draft CRUD as compatibility capabilities。State historical AI tables may remain but are not runtime product capabilities and are never automatically removed。

- [ ] **Step 5: 运行文档 tests**

Run:

```bash
ALLOWED_HOSTS="localhost,127.0.0.1,testserver" CORS_ORIGINS="http://testserver" .venv/Scripts/python.exe -m pytest backend/tests/test_documentation_contract.py -q
```

Expected: README and PRODUCT tests PASS。

- [ ] **Step 6: Commit**

```bash
git add README.md PRODUCT.md backend/tests/test_documentation_contract.py
git commit -m "Document the local ZeroTier product scope"
```

---

### Task 7: 更新 DESIGN、CLAUDE、AGENTS 与架构文档

**Files:**
- Modify: `DESIGN.md`
- Modify: `CLAUDE.md`
- Modify: `AGENTS.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `backend/tests/test_documentation_contract.py`

**Interfaces:**
- Consumes: actual modules `main.py`, `runtime.py`, `epub_utils.py`, `library.py`, `database.py`, `agent.py`, `obsidian.py` and current tests。
- Produces: developer/design guidance aligned with no-AI/no-Docker architecture, current commands and reader layout terminology。

- [ ] **Step 1: 扩充四文档契约测试**

Add:

```python
def test_developer_and_architecture_docs_match_current_runtime():
    paths = ("DESIGN.md", "CLAUDE.md", "AGENTS.md", "docs/ARCHITECTURE.md")
    combined = "\n".join(text(path) for path in paths)
    for required in ("runtime.py", "epub_utils.py", "ZeroTier", "pytest", "Playwright", "protocol v2"):
        assert required in combined
    for forbidden in ("backend/llm.py", "backend/knowledge.py", "docker compose", "Cloudflare Tunnel", "/api/books/ask", "/api/knowledge/"):
        assert forbidden.casefold() not in combined.casefold()
```

- [ ] **Step 2: 运行测试并确认旧开发/架构文档失败**

Run:

```bash
ALLOWED_HOSTS="localhost,127.0.0.1,testserver" CORS_ORIGINS="http://testserver" .venv/Scripts/python.exe -m pytest backend/tests/test_documentation_contract.py::test_developer_and_architecture_docs_match_current_runtime -q
```

Expected: FAIL on old `knowledge.py`/`llm.py`/Docker/Cloudflare descriptions。

- [ ] **Step 3: 更新 DESIGN.md 的布局术语但保留视觉 token**

Keep color、typography、spacing、component tokens。Replace `AI 面板` layout wording with main reader navigator + reading area + highlights/notes panel；describe `/book-chat/` as GPT-style visual layout without chat/AI semantics。Do not redesign visual values。

- [ ] **Step 4: 更新 CLAUDE.md 的命令、模块和数据流**

Use supported commands:

```bash
start.bat
./start.sh
ALLOWED_HOSTS="localhost,127.0.0.1,testserver" CORS_ORIGINS="http://testserver" .venv/Scripts/python.exe -m pytest backend/tests -q
cd frontend && npx playwright test
```

Module map must include `runtime.py` and `epub_utils.py`, remove Docker/knowledge/llm。Data flow ends at rules script、draft CRUD、Markdown/JSON/Obsidian exports；no model call。

- [ ] **Step 5: 更新 AGENTS.md 与实际测试现实**

Correct stale statements: automated backend/frontend suites do exist；backend default port is configured by `SERVER_PORT` (template 8720) and binding by verified `SERVER_HOST`; backend serves frontend same-origin。Build/run commands must not mention Docker or localhost:8000。Security section forbids public forwarding and requires same ZeroTier network。

- [ ] **Step 6: 重写 docs/ARCHITECTURE.md**

Include components:

```text
ZeroTier member browser -> FastAPI/Uvicorn bound to verified ZeroTier IPv4
  -> static PWA + /book-chat/
  -> SQLite (notes, drafts, library, reader sync)
  -> backend/data/books
  -> rules agent / Obsidian export
```

List retained API families precisely；describe `runtime.py` adapter validation and `epub_utils.py` extraction；state historical AI tables/columns are ignored and preserved。Document Service Worker limitation on raw HTTP ZeroTier IP as a browser secure-context issue, not an API sync issue。

- [ ] **Step 7: 运行文档 tests**

Run:

```bash
ALLOWED_HOSTS="localhost,127.0.0.1,testserver" CORS_ORIGINS="http://testserver" .venv/Scripts/python.exe -m pytest backend/tests/test_documentation_contract.py -q
```

Expected: all current documentation tests PASS。

- [ ] **Step 8: Commit**

```bash
git add DESIGN.md CLAUDE.md AGENTS.md docs/ARCHITECTURE.md backend/tests/test_documentation_contract.py
git commit -m "Align developer docs with the local runtime"
```

---

### Task 8: 将生产部署文档改写为本机 ZeroTier 运维手册

**Files:**
- Replace: `docs/PRODUCTION_DEPLOYMENT.md`
- Modify: `backend/tests/test_documentation_contract.py`

**Interfaces:**
- Consumes: runtime validator/start scripts、native backup/restore/scheduled-task scripts。
- Produces: same stable docs path with supported local deployment, firewall, backup, recovery, task uninstall, remote reader/sync and separate secure-context acceptance。

- [ ] **Step 1: 添加部署文档精确契约测试**

Add:

```python
def test_deployment_manual_is_zerotier_only_and_separates_secure_context_acceptance():
    content = text("docs/PRODUCTION_DEPLOYMENT.md")
    for required in (
        "SERVER_HOST", "SERVER_PORT", "ZeroTier 网卡", "start.bat",
        "Backup-Marginalia.ps1", "Test-MarginaliaRestore.ps1",
        "Install-MarginaliaScheduledTasks.ps1", "Uninstall-MarginaliaScheduledTasks.ps1",
        "HTTP ZeroTier IP", "安全上下文", "Service Worker",
        "普通局域网地址无法访问", "禁止端口转发",
    ):
        assert required in content
    for forbidden in ("Cloudflare", "docker compose", "Tunnel token", "Access policy", "TLS 证书"):
        assert forbidden.casefold() not in content.casefold()
```

- [ ] **Step 2: 运行测试并确认 Cloudflare 手册失败**

Run:

```bash
ALLOWED_HOSTS="localhost,127.0.0.1,testserver" CORS_ORIGINS="http://testserver" .venv/Scripts/python.exe -m pytest backend/tests/test_documentation_contract.py::test_deployment_manual_is_zerotier_only_and_separates_secure_context_acceptance -q
```

Expected: FAIL on current Cloudflare/Docker content。

- [ ] **Step 3: 重写安装、配置与启动章节**

Document:

- server/client join same ZeroTier network；
- identify adapter by ZeroTier identity, not `10.*`；
- manually copy `.env.example` to `.env` and replace placeholders；
- validator failure cases；
- `start.bat` and `python backend/main.py` same validation；
- no TLS and no public forwarding；
- narrow Windows Firewall rule scoped to configured port and ZeroTier adapter/address。

Do not show a real private address; use `<ZEROTIER_IPV4>`。

- [ ] **Step 4: 重写备份/恢复/计划任务章节**

Include exact commands:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Backup-Marginalia.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Test-MarginaliaRestore.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Install-MarginaliaScheduledTasks.ps1 -BackupAt 03:17
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Uninstall-MarginaliaScheduledTasks.ps1 -Confirm:$false
```

Explain online SQLite backup、SHA-256 manifest、14 successes retention、failure preserves old backups、restore temp isolation and logs under `backend/data/logs`。

- [ ] **Step 5: 写两个分离的验收清单**

Section A “远端阅读与同步验收” must require ZeroTier remote upload/open/progress/bookmark/highlight/note/protocol v2 and ordinary LAN refusal。

Section B “Service Worker 安全上下文验收” must say raw `http://<ZEROTIER_IPV4>:<PORT>` is usually not a secure context, so Service Worker may be unavailable; test Service Worker separately on browser-recognized loopback/secure context。Do not mark remote reading/sync failed solely because SW cannot register and do not prescribe TLS in this scope。

- [ ] **Step 6: 说明 `.env.production` 遗留处理而不读取文件**

Use exact policy text: “`.env.production` 已不再使用；它是敏感本地文件，本项目不会读取、迁移或删除。用户确认不再需要后可自行归档或删除。” Do not include its values。

- [ ] **Step 7: 运行完整文档 tests**

Run:

```bash
ALLOWED_HOSTS="localhost,127.0.0.1,testserver" CORS_ORIGINS="http://testserver" .venv/Scripts/python.exe -m pytest backend/tests/test_documentation_contract.py -q
```

Expected: all tests PASS。

- [ ] **Step 8: Commit**

```bash
git add docs/PRODUCTION_DEPLOYMENT.md backend/tests/test_documentation_contract.py
git commit -m "Replace production deployment with ZeroTier operations"
```

---

### Task 9: 全仓活跃路径清理守卫

**Files:**
- Modify: `backend/tests/test_documentation_contract.py`
- Verify unchanged: `frontend/tests/README.md`
- Exclude from active scan: `docs/superpowers/specs/**`, `docs/superpowers/plans/**`

**Interfaces:**
- Consumes: active source, scripts, root docs and `docs/ARCHITECTURE.md`/`docs/PRODUCTION_DEPLOYMENT.md`。
- Produces: no active AI/Docker/Cloudflare path while historical design evidence remains intact。

- [ ] **Step 1: 添加 active-file allowlist 扫描测试**

Add:

```python
def test_active_source_and_docs_have_no_removed_runtime_paths():
    active = [
        ROOT / "README.md",
        ROOT / "PRODUCT.md",
        ROOT / "DESIGN.md",
        ROOT / "CLAUDE.md",
        ROOT / "AGENTS.md",
        ROOT / ".env.example",
        *ROOT.glob("start.*"),
        *ROOT.glob("scripts/*.ps1"),
        *ROOT.glob("backend/*.py"),
        *ROOT.glob("frontend/*.js"),
        *ROOT.glob("frontend/*.html"),
        ROOT / "docs/ARCHITECTURE.md",
        ROOT / "docs/PRODUCTION_DEPLOYMENT.md",
    ]
    forbidden = (
        "docker compose", "Cloudflare Tunnel", "/api/books/ask",
        "/api/knowledge/", "/api/drafts/generate", "LLM_BASE_URL", "EMBEDDING_MODEL",
        "Start-MarginaliaProduction.ps1", "backend/knowledge.py", "backend/llm.py",
    )
    hits = {}
    for path in active:
        if not path.is_file():
            continue
        content = path.read_text(encoding="utf-8")
        found = [term for term in forbidden if term.casefold() in content.casefold()]
        if found:
            hits[str(path.relative_to(ROOT))] = found
    assert hits == {}
```

- [ ] **Step 2: 运行扫描并查看精确 stale files**

Run:

```bash
ALLOWED_HOSTS="localhost,127.0.0.1,testserver" CORS_ORIGINS="http://testserver" .venv/Scripts/python.exe -m pytest backend/tests/test_documentation_contract.py::test_active_source_and_docs_have_no_removed_runtime_paths -q
```

Expected: PASS。Tasks 6-9 have already removed every forbidden term from the explicit active list；historical specs/plans are outside the list by construction。If this test fails, return to the task that owns the reported file rather than committing Task 10 red。

- [ ] **Step 3: 验证 frontend test README 无过期运行路径**

Run:

```bash
python - <<'PY'
from pathlib import Path
text = Path('frontend/tests/README.md').read_text(encoding='utf-8').casefold()
for term in ('docker compose', 'cloudflare tunnel', '/api/books/ask', '/api/knowledge/', '/api/drafts/generate'):
    assert term not in text, term
PY
```

Expected: exit 0；`frontend/tests/README.md` 无需修改。

- [ ] **Step 4: 运行扫描与静态 file absence checks**

Run:

```bash
ALLOWED_HOSTS="localhost,127.0.0.1,testserver" CORS_ORIGINS="http://testserver" .venv/Scripts/python.exe -m pytest backend/tests/test_documentation_contract.py backend/tests/test_operations_scripts.py -q
git ls-files | python -c "import sys; files=set(line.strip() for line in sys.stdin); forbidden={'.dockerignore','.env.production.example','backend/Dockerfile','backend/Dockerfile.prod','docker-compose.yml','docker-compose.prod.yml','scripts/Start-MarginaliaProduction.ps1'}; assert not (files & forbidden), files & forbidden"
```

Expected: all tests PASS and no forbidden path tracked。

- [ ] **Step 5: Commit**

```bash
git add backend/tests/test_documentation_contract.py
git commit -m "Guard against obsolete runtime references"
```

---

## Final Verification: 全量自动验证

**Files:**
- Verify: all backend tests and active Python modules
- Verify: all frontend Playwright specs
- Verify: all PowerShell scripts
- Verify only: no tracked source file is modified in this section

**Interfaces:**
- Consumes: completed implementation from all three plans。
- Produces: green automated evidence across backend、frontend、scripts、docs。

- [ ] **Step 1: 运行完整隔离 pytest**

Run:

```bash
ALLOWED_HOSTS="localhost,127.0.0.1,testserver" CORS_ORIGINS="http://testserver" .venv/Scripts/python.exe -m pytest backend/tests -q
```

Expected: all collected tests PASS；no TrustedHost env failure。

- [ ] **Step 2: 运行完整 Playwright**

Run:

```bash
cd frontend && npx playwright test
```

Expected: all collected tests PASS，包括 notes/mobile/server-sync/book-chat/import/app-shell。

- [ ] **Step 3: 编译所有 backend Python**

Run:

```bash
.venv/Scripts/python.exe -m compileall -q backend
```

Expected: exit 0。

- [ ] **Step 4: 解析全部 PowerShell 脚本**

Run:

```bash
powershell.exe -NoProfile -Command '$files=Get-ChildItem scripts -Filter *.ps1; foreach($f in $files){$errors=$null; [void][System.Management.Automation.Language.Parser]::ParseFile($f.FullName,[ref]$null,[ref]$errors); if($errors){$errors|ForEach-Object{Write-Error $_}; exit 1}}'
```

Expected: exit 0。

- [ ] **Step 5: 检查 Bash/Batch source contracts**

Run:

```bash
bash -n start.sh
ALLOWED_HOSTS="localhost,127.0.0.1,testserver" CORS_ORIGINS="http://testserver" .venv/Scripts/python.exe -m pytest backend/tests/test_start_scripts.py -q
```

Expected: shell syntax and source tests PASS。

- [ ] **Step 6: 验证依赖安装在干净临时 venv 可解析**

Run:

```bash
TMP_VENV="$(mktemp -d)/venv"
py -3.11 -m venv "$TMP_VENV"
"$TMP_VENV/Scripts/python.exe" -m pip install -r backend/requirements.txt
"$TMP_VENV/Scripts/python.exe" -c "import fastapi, uvicorn, pydantic, aiosqlite, dotenv, multipart, ebooklib, httpx, pytest"
rm -rf "$(dirname "$TMP_VENV")"
```

Expected: install/import succeeds；no AI-specific dependency is needed。

- [ ] **Step 7: 不为验证结果创建额外 commit**

Run:

```bash
git status --short
```

Expected: no generated test artifacts or temp venv staged/tracked。

---

## Manual Acceptance: 无 Docker 真实备份/恢复、ZeroTier E2E 与最终交接

**Files:**
- Verify only: `scripts/*.ps1`, `backend/runtime.py`, `frontend/sw.js`, docs
- No tracked changes expected

**Interfaces:**
- Consumes: real local `.env` already configured by user, real `backend/data/`, a temporary backup destination, one or more ZeroTier client devices。
- Produces: final acceptance evidence for listener scope、remote reading/sync、secure-context separation、backup/restore integrity and clean working tree。

- [ ] **Step 1: 证明运维脚本不依赖 docker executable**

Temporarily run a PowerShell process with a PATH containing Windows system directories and project `.venv\Scripts` but no Docker installation directory:

```powershell
$root = Join-Path $env:TEMP ("marginalia-no-docker-" + [guid]::NewGuid())
$data = Join-Path $root "data"
$backups = Join-Path $root "backups"
New-Item -ItemType Directory -Path (Join-Path $data "books") -Force | Out-Null
& .\.venv\Scripts\python.exe -c "import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.execute('create table x(id integer)'); c.execute('insert into x values (1)'); c.commit(); c.close()" (Join-Path $data "marginalia.db")
Set-Content -LiteralPath (Join-Path $data "notes.json") -Value '[]' -Encoding utf8
Set-Content -LiteralPath (Join-Path $data "books\fixture.epub") -Value 'fixture' -Encoding utf8
$oldPath = $env:PATH
try {
    $env:PATH = "$env:SystemRoot\System32;$env:SystemRoot;$PWD\.venv\Scripts"
    if (Get-Command docker -ErrorAction SilentlyContinue) { throw "Docker unexpectedly visible" }
    & .\scripts\Backup-Marginalia.ps1 -SourceData $data -Destination $backups
    if ($LASTEXITCODE -ne 0) { throw "No-Docker fixture backup failed" }
} finally {
    $env:PATH = $oldPath
    Remove-Item -LiteralPath $root -Recurse -Force
}
```

Expected: backup succeeds without a Docker executable and the temporary fixture root is removed。

- [ ] **Step 2: 对真实 backend/data 执行一次在线备份到临时验收目录**

Run:

```powershell
$acceptance = Join-Path $env:TEMP ("MarginaliaAcceptanceBackups-" + [guid]::NewGuid())
& .\scripts\Backup-Marginalia.ps1 -SourceData .\backend\data -Destination $acceptance -Retention 14
if ($LASTEXITCODE -ne 0) { throw "Real data backup failed" }
& .\scripts\Test-MarginaliaRestore.ps1 -BackupRoot $acceptance
if ($LASTEXITCODE -ne 0) { throw "Real data restore drill failed" }
```

Expected: `Backup complete`, `Restore drill passed`, `SQLite integrity: ok`；real `backend/data/` remains unchanged except normal live service activity。Keep acceptance backup until all checks finish, then remove only the temporary acceptance root。

- [ ] **Step 3: 验证 manifest 完整性与 retention 失败安全**

Corrupt a copy of the acceptance backup—not the successful original—by changing one copied file, then run restore against the corrupted copy。

Expected: restore exits nonzero with `Hash mismatch` and does not touch `backend/data/`。Then force a backup failure with an unwritable/invalid destination and confirm pre-existing successful backup directories remain。

- [ ] **Step 4: 验证计划任务日志和卸载说明**

Install tasks with a near-future test backup time, run each task manually via `Start-ScheduledTask`, then inspect `backend/data/logs/startup.log` and `backup.log` for nonempty output。Uninstall through `Uninstall-MarginaliaScheduledTasks.ps1`。

Expected: startup uses `start.bat`; backup creates a valid timestamp backup; both logs exist; uninstall removes exactly two Marginalia tasks。

- [ ] **Step 5: 重复 ZeroTier listener 与普通 LAN 拒绝验收**

Use the exact validator/listener commands from the ZeroTier runtime plan。From a ZeroTier client, `/health` succeeds at configured IP；from ordinary LAN IP it fails；no `0.0.0.0`/loopback listener and no router port forwarding exists。

- [ ] **Step 6: 完成真实跨设备阅读同步验收**

On two ZeroTier devices, exercise:

1. main reader import/open/search/reading position；
2. bookmark/highlight/note create and protocol v2 trash/restore/delete；
3. GPT 风格阅读器 library/open/TOC/full-text search/theme/sidebar position preservation；
4. Markdown/JSON export、Obsidian export with a disposable configured vault、rule script endpoint；
5. historical draft GET/PATCH/DELETE；
6. removed `/api/books/ask`、`/api/knowledge/*`、`/api/drafts/generate` return 404。

Expected: retained features work and removed features remain absent。

- [ ] **Step 7: 分开记录 Service Worker 安全上下文验收**

For remote raw HTTP ZeroTier IP, record `window.isSecureContext` and SW availability; expected typical result is insecure/no controller。Separately run existing Service Worker/app-shell Playwright tests on loopback fixture and record PASS。Do not add TLS and do not conflate remote sync with SW availability。

- [ ] **Step 8: 最终敏感文件与删除范围检查**

Run without reading `.env.production`:

```bash
git status --short
git diff --name-status
git ls-files .env .env.production .env.production.example
```

Expected: `.env` and `.env.production` are not tracked/modified；`.env.production.example` absent；only intended source/docs/script/test changes appear。

- [ ] **Step 9: 最终 commit 序列与工作树检查**

Run:

```bash
git log --oneline -20
git status --short
```

Expected: frequent independently reviewable commits for backup、restore、tasks、file removal and docs；no unfinished business code、test artifact or temporary backup in Git。All three plans are complete in the mandated order。
