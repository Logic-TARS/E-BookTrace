from pathlib import Path


ROOT = Path(__file__).parents[2]


def text(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def test_readme_describes_current_runtime_features_and_operational_limits():
    content = text("README.md")
    for required in (
        "E-书痕", "E-BookTrace", "Python 3.11", "127.0.0.1:8720",
        "start.bat", "start.sh", "主阅读器", "GPT 风格阅读器",
        "后端可选", "/api/books/upload", "/api/books/ask", "/api/knowledge/",
        "/api/drafts/generate", "/api/generate-script", "/api/obsidian/export",
        "docker compose up --build", "docker-compose.prod.yml", "Cloudflare Tunnel",
        "DATABASE_URL", "CORS_ORIGINS", "ALLOWED_HOSTS", "LLM_BASE_URL",
        "EMBEDDING_BASE_URL", "MAX_EPUB_UPLOAD_MB", "OBSIDIAN_VAULT_PATH",
        "不存在 `SERVER_HOST` 或 `SERVER_PORT`", "IndexedDB v6", "protocol v2",
        "Service Worker", "Backup-Marginalia.ps1", "Test-MarginaliaRestore.ps1",
        "Install-MarginaliaScheduledTasks.ps1", "marginalia",
    ):
        assert required in content
    for forbidden in (
        "SERVER_HOST=你的ZeroTier_IPv4", "SERVER_PORT=8720",
        "必须拥有已验证的 ZeroTier IPv4 地址", "启动不会回退到",
        "SQLite 在线一致性备份", "backend/runtime.py",
        "Uninstall-MarginaliaScheduledTasks.ps1", "已移除的接口",
        "草稿生成端点不受支持",
    ):
        assert forbidden.casefold() not in content.casefold()


def test_product_positions_ai_free_local_reader():
    content = text("PRODUCT.md")
    for required in (
        "E-书痕", "E-BookTrace", "ZeroTier", "GPT 风格阅读器",
        "本地优先", "规则式脚本", "Obsidian",
    ):
        assert required in content
    for forbidden in ("AI 问答", "向量", "Embedding", "LLM", "Cloudflare", "Docker"):
        assert forbidden.casefold() not in content.casefold()



