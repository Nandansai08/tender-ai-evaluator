"""Pydantic models for the Tender AI Evaluator."""
from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Optional
from pydantic import BaseModel, Field


# ─── Enumerations ────────────────────────────────────────────────────────────

class CriterionType(str, Enum):
    FINANCIAL = "financial"
    TECHNICAL = "technical"
    COMPLIANCE = "compliance"
    CERTIFICATION = "certification"
    EXPERIENCE = "experience"
    OTHER = "other"


class CriterionMandatory(str, Enum):
    MANDATORY = "mandatory"
    OPTIONAL = "optional"


class Verdict(str, Enum):
    ELIGIBLE = "eligible"
    NOT_ELIGIBLE = "not_eligible"
    NEEDS_REVIEW = "needs_review"


class DocumentType(str, Enum):
    PDF = "pdf"
    WORD = "word"
    IMAGE = "image"
    TEXT = "text"
    UNKNOWN = "unknown"


# ─── Criterion Models ─────────────────────────────────────────────────────────

class Criterion(BaseModel):
    criterion_id: str
    name: str
    description: str
    criterion_type: CriterionType
    mandatory: CriterionMandatory
    threshold_value: Optional[str] = None
    unit: Optional[str] = None
    source_text: str = ""


class CriteriaExtractionResult(BaseModel):
    tender_id: str
    tender_name: str
    criteria: list[Criterion]
    extraction_confidence: float
    raw_text_preview: str = ""
    extracted_at: datetime = Field(default_factory=datetime.utcnow)


# ─── Bidder / Evidence Models ─────────────────────────────────────────────────

class Evidence(BaseModel):
    criterion_id: str
    document_name: str
    document_type: DocumentType
    extracted_value: Optional[str] = None
    source_text: str = ""
    confidence: float = 0.0
    page_number: Optional[int] = None


class BidderSubmission(BaseModel):
    bidder_id: str
    bidder_name: str
    documents: list[str]  # file paths
    evidence_map: dict[str, list[Evidence]] = Field(default_factory=dict)


# ─── Evaluation Models ────────────────────────────────────────────────────────

class CriterionEvaluation(BaseModel):
    criterion_id: str
    criterion_name: str
    criterion_type: CriterionType
    mandatory: CriterionMandatory
    verdict: Verdict
    confidence: float
    explanation: str
    evidence: list[Evidence] = Field(default_factory=list)
    review_reason: Optional[str] = None


class BidderEvaluation(BaseModel):
    bidder_id: str
    bidder_name: str
    overall_verdict: Verdict
    overall_confidence: float
    overall_explanation: str
    criterion_evaluations: list[CriterionEvaluation]
    flagged_criteria: list[str] = Field(default_factory=list)
    evaluated_at: datetime = Field(default_factory=datetime.utcnow)


class EvaluationReport(BaseModel):
    report_id: str
    tender_id: str
    tender_name: str
    criteria: list[Criterion]
    bidder_evaluations: list[BidderEvaluation]
    summary: dict[str, Any] = Field(default_factory=dict)
    generated_at: datetime = Field(default_factory=datetime.utcnow)
    audit_log: list[dict[str, Any]] = Field(default_factory=list)


# ─── API Request / Response Models ───────────────────────────────────────────

class TenderUploadResponse(BaseModel):
    tender_id: str
    message: str
    criteria_count: int
    criteria: list[Criterion]
    extraction_confidence: float


class BidderUploadResponse(BaseModel):
    bidder_id: str
    bidder_name: str
    message: str
    documents_parsed: int


class EvaluationRequest(BaseModel):
    tender_id: str
    bidder_ids: list[str]


class EvaluationResponse(BaseModel):
    report_id: str
    message: str
    total_bidders: int
    eligible_count: int
    not_eligible_count: int
    review_count: int


class AuditEntry(BaseModel):
    audit_id: str
    event_type: str
    entity_id: str
    entity_type: str
    details: dict[str, Any]
    actor: str = "system"
    timestamp: datetime = Field(default_factory=datetime.utcnow)
