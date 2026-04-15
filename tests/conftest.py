"""Test configuration and fixtures."""
import os
import sys

import pytest

# Must set env vars before importing backend modules
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite://")

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


@pytest.fixture(scope="session", autouse=True)
async def initialize_test_database():
    """Create all DB tables in the in-memory test database."""
    from backend.database import init_db
    await init_db()


@pytest.fixture(scope="module")
async def client():
    from httpx import AsyncClient, ASGITransport
    from backend.main import app
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac
