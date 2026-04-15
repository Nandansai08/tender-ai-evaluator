"""Configuration settings for the Tender AI Evaluator."""
import os
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    app_name: str = "Tender AI Evaluator"
    app_version: str = "1.0.0"
    debug: bool = False

    # File storage
    upload_dir: str = "uploads"
    reports_dir: str = "reports_output"
    max_upload_size_mb: int = 50

    # Database
    database_url: str = "sqlite+aiosqlite:///./tender_evaluator.db"

    # AI / LLM
    openai_api_key: str = ""
    openai_model: str = "gpt-4o"
    use_mock_ai: bool = True  # Use mock AI when no API key is provided

    # OCR
    tesseract_cmd: str = ""  # Leave empty to use system default

    # Confidence thresholds
    confidence_threshold_eligible: float = 0.75
    confidence_threshold_review: float = 0.40

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()

# Auto-detect if we should use mock AI
if not settings.openai_api_key:
    settings.use_mock_ai = True
