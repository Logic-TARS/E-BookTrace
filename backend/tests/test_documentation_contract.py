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



