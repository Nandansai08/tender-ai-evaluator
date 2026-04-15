"""
Criteria extractor — extracts eligibility criteria from a tender document.

Supports two modes:
  1. OpenAI mode  — uses GPT-4o for high-quality structured extraction.
  2. Mock mode    — rule-based extraction used when no API key is present,
                   suitable for testing and demonstration.
"""
from __future__ import annotations

import json
import re
import uuid
from typing import Any

from backend.config import settings
from backend.models import (
    Criterion,
    CriteriaExtractionResult,
    CriterionMandatory,
    CriterionType,
)


# ─── Public entry point ───────────────────────────────────────────────────────

def extract_criteria(tender_text: str, tender_id: str, tender_name: str) -> CriteriaExtractionResult:
    """
    Extract eligibility criteria from tender document text.

    Returns a CriteriaExtractionResult containing a list of Criterion objects.
    """
    if settings.use_mock_ai or not settings.openai_api_key:
        return _mock_extract(tender_text, tender_id, tender_name)
    return _openai_extract(tender_text, tender_id, tender_name)


# ─── OpenAI extraction ────────────────────────────────────────────────────────

_SYSTEM_PROMPT = """You are an expert in government procurement and tender evaluation.
Your job is to extract ALL eligibility criteria from the provided tender document text.
For each criterion, output a JSON object with these fields:
- criterion_id: unique short ID (e.g. "C01", "C02")
- name: short criterion name
- description: full description of the requirement
- criterion_type: one of ["financial", "technical", "compliance", "certification", "experience", "other"]
- mandatory: one of ["mandatory", "optional"]
- threshold_value: numeric or textual threshold if applicable (e.g. "5 crore", "ISO 9001", "3 projects"), else null
- unit: unit of measurement if applicable (e.g. "INR crore", "years", "projects"), else null
- source_text: the exact sentence(s) from the tender that state this criterion

Return ONLY a JSON array of criterion objects — no preamble, no explanation."""

def _openai_extract(tender_text: str, tender_id: str, tender_name: str) -> CriteriaExtractionResult:
    try:
        from openai import OpenAI
        client = OpenAI(api_key=settings.openai_api_key)

        # Truncate to ~12 000 tokens of text to stay within context limits
        text_slice = tender_text[:48000]

        response = client.chat.completions.create(
            model=settings.openai_model,
            messages=[
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user", "content": f"Tender document text:\n\n{text_slice}"},
            ],
            temperature=0.1,
            response_format={"type": "json_object"},
        )

        raw = response.choices[0].message.content or "{}"
        data = json.loads(raw)

        # The model may wrap the array in a key
        if isinstance(data, dict):
            criteria_data = data.get("criteria", data.get("eligibility_criteria", list(data.values())[0] if data else []))
        else:
            criteria_data = data

        criteria = [_dict_to_criterion(c, i) for i, c in enumerate(criteria_data, start=1)]
        confidence = 0.90

    except Exception as exc:
        # Graceful fallback
        return _mock_extract(tender_text, tender_id, tender_name)

    return CriteriaExtractionResult(
        tender_id=tender_id,
        tender_name=tender_name,
        criteria=criteria,
        extraction_confidence=confidence,
        raw_text_preview=tender_text[:500],
    )


def _dict_to_criterion(data: dict, idx: int) -> Criterion:
    return Criterion(
        criterion_id=data.get("criterion_id", f"C{idx:02d}"),
        name=data.get("name", f"Criterion {idx}"),
        description=data.get("description", ""),
        criterion_type=_parse_enum(data.get("criterion_type", "other"), CriterionType, CriterionType.OTHER),
        mandatory=_parse_enum(data.get("mandatory", "mandatory"), CriterionMandatory, CriterionMandatory.MANDATORY),
        threshold_value=data.get("threshold_value"),
        unit=data.get("unit"),
        source_text=data.get("source_text", ""),
    )


def _parse_enum(value: str, enum_cls: Any, default: Any) -> Any:
    try:
        return enum_cls(value.lower())
    except (ValueError, AttributeError):
        return default


# ─── Mock / rule-based extraction ─────────────────────────────────────────────

# Patterns for common tender criteria
_FINANCIAL_PATTERNS = [
    (r"(?:annual\s+)?turnover[^\n.]*?(?:₹|rs\.?|inr)?\s*([\d,.]+)\s*(?:crore|lakh|cr\.?)?", "Minimum Annual Turnover", "financial"),
    (r"net\s+worth[^\n.]*?(?:₹|rs\.?|inr)?\s*([\d,.]+)\s*(?:crore|lakh|cr\.?)?", "Net Worth", "financial"),
    (r"paid[- ]up\s+capital[^\n.]*?(?:₹|rs\.?|inr)?\s*([\d,.]+)", "Paid-up Capital", "financial"),
]

_EXPERIENCE_PATTERNS = [
    (r"(?:at\s+least|minimum|atleast)\s+(\d+)\s+(?:similar|comparable)\s+project", "Similar Projects Experience", "experience"),
    (r"(\d+)\s+years?\s+(?:of\s+)?experience", "Years of Experience", "experience"),
    (r"completed\s+(?:at\s+least\s+)?(\d+)\s+(?:project|work|contract)", "Completed Projects", "experience"),
]

_COMPLIANCE_PATTERNS = [
    (r"gst\s*(?:registration|number|certificate)?", "GST Registration", "compliance"),
    (r"pan\s*(?:card|number)?", "PAN Card", "compliance"),
    (r"epf\s*(?:registration)?", "EPF Registration", "compliance"),
    (r"esic\s*(?:registration)?", "ESIC Registration", "compliance"),
    (r"msme\s*(?:certificate|registration)?", "MSME Certificate", "compliance"),
]

_CERTIFICATION_PATTERNS = [
    (r"iso\s*9001", "ISO 9001 Certification", "certification"),
    (r"iso\s*14001", "ISO 14001 Certification", "certification"),
    (r"iso\s*27001", "ISO 27001 Certification", "certification"),
    (r"bis\s*(?:certification|mark)?", "BIS Certification", "certification"),
    (r"nabcb\s*(?:accreditation)?", "NABCB Accreditation", "certification"),
]

_TECHNICAL_PATTERNS = [
    (r"(?:technical|manpower|staff)[^\n.]*?(?:qualified|certified|experienced)", "Technical Manpower", "technical"),
    (r"(?:machinery|equipment|plant)[^\n.]*?(?:owned|available|deployed)", "Machinery/Equipment", "technical"),
]


def _mock_extract(tender_text: str, tender_id: str, tender_name: str) -> CriteriaExtractionResult:
    """Rule-based mock criteria extraction — works without an LLM."""
    text_lower = tender_text.lower()
    criteria: list[Criterion] = []
    idx = 1

    # Check each pattern group
    all_patterns = (
        _FINANCIAL_PATTERNS
        + _EXPERIENCE_PATTERNS
        + _COMPLIANCE_PATTERNS
        + _CERTIFICATION_PATTERNS
        + _TECHNICAL_PATTERNS
    )

    seen_names: set[str] = set()

    for pattern, name, c_type in all_patterns:
        if name in seen_names:
            continue
        match = re.search(pattern, text_lower, re.IGNORECASE)
        if match:
            seen_names.add(name)
            threshold = match.group(1) if match.lastindex and match.lastindex >= 1 else None

            # Extract surrounding sentence as source text
            start = max(0, match.start() - 50)
            end = min(len(tender_text), match.end() + 200)
            source_text = tender_text[start:end].strip()

            # Determine mandatory vs optional:
            # If "optional" or "encouraged" appears in the surrounding context, mark optional
            context_window = text_lower[max(0, match.start() - 100) : min(len(text_lower), match.end() + 100)]
            if re.search(r"\b(optional|encouraged|if applicable)\b", context_window):
                mandatory = CriterionMandatory.OPTIONAL
            else:
                mandatory = CriterionMandatory.MANDATORY

            criteria.append(
                Criterion(
                    criterion_id=f"C{idx:02d}",
                    name=name,
                    description=_build_description(name, threshold, c_type),
                    criterion_type=CriterionType(c_type),
                    mandatory=mandatory,
                    threshold_value=threshold,
                    unit=_infer_unit(name, c_type),
                    source_text=source_text,
                )
            )
            idx += 1

    # If nothing found, add a generic placeholder so the system always produces output
    if not criteria:
        criteria = _default_criteria(tender_name)

    confidence = 0.65 if criteria else 0.30
    return CriteriaExtractionResult(
        tender_id=tender_id,
        tender_name=tender_name,
        criteria=criteria,
        extraction_confidence=confidence,
        raw_text_preview=tender_text[:500],
    )


def _build_description(name: str, threshold: str | None, c_type: str) -> str:
    if threshold:
        return f"{name} requirement: {threshold}"
    return f"{name} is required as part of the eligibility criteria."


def _infer_unit(name: str, c_type: str) -> str | None:
    unit_map = {
        "financial": "INR Crore",
        "experience": "projects / years",
        "compliance": None,
        "certification": None,
        "technical": None,
    }
    return unit_map.get(c_type)


def _default_criteria(tender_name: str) -> list[Criterion]:
    """Return a minimal set of default criteria when none can be extracted."""
    return [
        Criterion(
            criterion_id="C01",
            name="Minimum Annual Turnover",
            description="Bidder must have a minimum annual turnover of ₹5 Crore in the last 3 financial years.",
            criterion_type=CriterionType.FINANCIAL,
            mandatory=CriterionMandatory.MANDATORY,
            threshold_value="5",
            unit="INR Crore",
            source_text="",
        ),
        Criterion(
            criterion_id="C02",
            name="Similar Project Experience",
            description="Bidder must have completed at least 3 similar projects in the last 5 years.",
            criterion_type=CriterionType.EXPERIENCE,
            mandatory=CriterionMandatory.MANDATORY,
            threshold_value="3",
            unit="projects",
            source_text="",
        ),
        Criterion(
            criterion_id="C03",
            name="GST Registration",
            description="Bidder must possess a valid GST registration certificate.",
            criterion_type=CriterionType.COMPLIANCE,
            mandatory=CriterionMandatory.MANDATORY,
            threshold_value=None,
            unit=None,
            source_text="",
        ),
        Criterion(
            criterion_id="C04",
            name="ISO 9001 Certification",
            description="Bidder must hold a valid ISO 9001 quality management certification.",
            criterion_type=CriterionType.CERTIFICATION,
            mandatory=CriterionMandatory.MANDATORY,
            threshold_value="ISO 9001",
            unit=None,
            source_text="",
        ),
    ]
