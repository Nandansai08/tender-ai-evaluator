"""SQLAlchemy database setup and audit trail for the Tender AI Evaluator."""
import json
import uuid
from datetime import datetime

from sqlalchemy import Column, DateTime, Integer, String, Text, Float, Boolean
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from backend.config import settings


engine = create_async_engine(settings.database_url, echo=settings.debug)
AsyncSessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


# ─── ORM Models ───────────────────────────────────────────────────────────────

class TenderRecord(Base):
    __tablename__ = "tenders"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String, nullable=False)
    file_path = Column(String, nullable=False)
    criteria_json = Column(Text, nullable=False, default="[]")
    created_at = Column(DateTime, default=datetime.utcnow)
    extraction_confidence = Column(Float, default=0.0)


class BidderRecord(Base):
    __tablename__ = "bidders"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    tender_id = Column(String, nullable=False)
    name = Column(String, nullable=False)
    documents_json = Column(Text, nullable=False, default="[]")
    evidence_json = Column(Text, nullable=False, default="{}")
    created_at = Column(DateTime, default=datetime.utcnow)


class EvaluationRecord(Base):
    __tablename__ = "evaluations"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    tender_id = Column(String, nullable=False)
    report_json = Column(Text, nullable=False, default="{}")
    created_at = Column(DateTime, default=datetime.utcnow)
    report_path = Column(String, nullable=True)


class AuditRecord(Base):
    __tablename__ = "audit_log"

    id = Column(Integer, primary_key=True, autoincrement=True)
    audit_id = Column(String, nullable=False)
    event_type = Column(String, nullable=False)
    entity_id = Column(String, nullable=False)
    entity_type = Column(String, nullable=False)
    details_json = Column(Text, nullable=False, default="{}")
    actor = Column(String, default="system")
    timestamp = Column(DateTime, default=datetime.utcnow)


# ─── Helpers ──────────────────────────────────────────────────────────────────

async def init_db() -> None:
    """Create all tables."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def get_db():
    """Dependency injection: yield a DB session."""
    async with AsyncSessionLocal() as session:
        yield session


async def write_audit(
    session: AsyncSession,
    event_type: str,
    entity_id: str,
    entity_type: str,
    details: dict,
    actor: str = "system",
) -> AuditRecord:
    record = AuditRecord(
        audit_id=str(uuid.uuid4()),
        event_type=event_type,
        entity_id=entity_id,
        entity_type=entity_type,
        details_json=json.dumps(details),
        actor=actor,
    )
    session.add(record)
    await session.commit()
    return record
