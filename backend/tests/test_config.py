"""Tests for reader configuration and removed-feature isolation."""

from __future__ import annotations

import importlib.util
from pathlib import Path

import dotenv


CONFIG_PATH = Path(__file__).parents[1] / "config.py"


def _load_settings(monkeypatch, values: dict[str, str]):
    names = {
        "LLM_BASE_URL",
        "LLM_API_KEY",
        "LLM_MODEL",
        "LLM_EMBEDDING_MODEL",
        "EMBEDDING_BASE_URL",
        "EMBEDDING_API_KEY",
        "EMBEDDING_MODEL",
        "CORS_ORIGINS",
        "ALLOWED_HOSTS",
        "MAX_EPUB_UPLOAD_MB",
        "TTS_ENABLED",
        "TTS_PROVIDER",
        "TTS_STORAGE_PATH",
        "TTS_DEFAULT_VOICE",
        "TTS_MAX_CONCURRENCY",
        "TTS_MAX_RETRIES",
        "TTS_SEGMENT_MAX_CHARS",
        "TTS_REQUEST_TIMEOUT",
        "TTS_CACHE_RETENTION_DAYS",
        "TTS_MAX_TASKS_PER_CLIENT",
        "TTS_CREATE_RATE_LIMIT_PER_MINUTE",
        "TTS_MIN_AUDIO_BYTES",
    }
    for name in names:
        monkeypatch.delenv(name, raising=False)
    for name, value in values.items():
        monkeypatch.setenv(name, value)
    monkeypatch.setattr(dotenv, "load_dotenv", lambda *_args, **_kwargs: False)

    spec = importlib.util.spec_from_file_location("config_under_test", CONFIG_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module.settings


def test_removed_feature_settings_are_ignored(monkeypatch):
    settings = _load_settings(monkeypatch, {
        "LLM_BASE_URL": "https://unused.example/v1",
        "EMBEDDING_MODEL": "unused-model",
        "TTS_ENABLED": "true",
    })
    assert not any(
        name.startswith(("llm_", "embedding_", "tts_"))
        for name in dir(settings)
    )


def test_production_security_settings_are_parsed(monkeypatch):
    settings = _load_settings(
        monkeypatch,
        {
            "CORS_ORIGINS": "https://read.zengziyang.com",
            "ALLOWED_HOSTS": "read.zengziyang.com, localhost,127.0.0.1",
            "MAX_EPUB_UPLOAD_MB": "90",
        },
    )

    assert settings.cors_origin_list == ["https://read.zengziyang.com"]
    assert settings.allowed_host_list == [
        "read.zengziyang.com",
        "localhost",
        "127.0.0.1",
    ]
    assert settings.max_epub_upload_mb == 90


def test_security_defaults_are_local_only(monkeypatch):
    settings = _load_settings(monkeypatch, {})

    assert settings.allowed_host_list == ["localhost", "127.0.0.1", "testserver"]
    assert settings.max_epub_upload_mb == 90


def test_upload_limit_and_vault_override(monkeypatch):
    settings = _load_settings(monkeypatch, {
        "MAX_EPUB_UPLOAD_MB": "12",
        "OBSIDIAN_VAULT_PATH": "test-vault",
    })
    assert settings.max_epub_upload_mb == 12
    assert settings.obsidian_vault_path == "test-vault"
