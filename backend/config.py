"""Application configuration loaded from environment variables."""

import os
from pathlib import Path

from dotenv import load_dotenv


load_dotenv(Path(__file__).parent.parent / ".env")
load_dotenv(Path(__file__).parent / ".env")


class Settings:
    """Settings with defaults, reads from .env via os.environ."""

    # Database
    database_url: str = os.getenv(
        "DATABASE_URL",
        f"sqlite+aiosqlite:///{Path(__file__).parent / 'data' / 'marginalia.db'}"
    )

    # CORS
    cors_origins: str = os.getenv("CORS_ORIGINS", "*")
    allowed_hosts: str = os.getenv(
        "ALLOWED_HOSTS", "localhost,127.0.0.1,testserver"
    )

    max_epub_upload_mb: int = int(os.getenv("MAX_EPUB_UPLOAD_MB", "90"))

    # Obsidian export
    obsidian_vault_path: str = os.getenv("OBSIDIAN_VAULT_PATH", "")

    @property
    def cors_origin_list(self) -> list[str]:
        if self.cors_origins == "*":
            return ["*"]
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def allowed_host_list(self) -> list[str]:
        return [host.strip() for host in self.allowed_hosts.split(",") if host.strip()]


settings = Settings()
