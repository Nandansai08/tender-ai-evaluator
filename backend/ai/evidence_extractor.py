"""
Evidence extractor — given a bidder's document text and a list of criteria,
extracts the relevant values / evidence for each criterion.

Supports OpenAI mode and rule-based mock mode.
"""
from __future__ import annotations

import json
import re
from typing import Optional

from backend.config import settings
from backend.models import Criterion, DocumentType, Evidence


# ─── Public entry point ───────────────────────────────────────────────────────

def extract_evidence(
    document_text: str,
    document_name: str,
    document_type: DocumentType,
    criteria: list[Criterion],
    confidence_hint: float = 0.90,
) -> list[Evidence]:
    """
    Extract evidence for each criterion from a single document.

    Returns a list of Evidence objects (one per criterion that has a hit).
    """
    if settings.use_mock_ai or not settings.openai_api_key:
        return _mock_extract_evidence(document_text, document_name, document_type, criteria, confidence_hint)
    return _openai_extract_evidence(document_text, document_name, document_type, criteria, confidence_hint)


# ─── OpenAI extraction ────────────────────────────────────────────────────────

_SYSTEM_PROMPT = """You are an expert document analyst specialising in government procurement.
Given a document excerpt and a list of eligibility criteria, identify whether and where each
criterion is evidenced in the document.

For each criterion, return a JSON object:
{
  "criterion_id": "<id>",
  "found": true/false,
  "extracted_value": "<the specific value or text found, or null>",
  "source_text": "<the exact sentence/phrase that supports this, or null>",
  "confidence": <0.0 – 1.0>,
  "page_number": <integer or null>
}

Return ONLY a JSON array — no preamble."""


def _openai_extract_evidence(
    document_text: str,
    document_name: str,
    document_type: DocumentType,
    criteria: list[Criterion],
    confidence_hint: float,
) -> list[Evidence]:
    try:
        from openai import OpenAI
        client = OpenAI(api_key=settings.openai_api_key)

        criteria_summary = json.dumps(
            [{"criterion_id": c.criterion_id, "name": c.name, "description": c.description} for c in criteria],
            indent=2,
        )
        text_slice = document_text[:30000]

        response = client.chat.completions.create(
            model=settings.openai_model,
            messages=[
                {"role": "system", "content": _SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": (
                        f"Criteria to check:\n{criteria_summary}\n\n"
                        f"Document ({document_name}):\n{text_slice}"
                    ),
                },
            ],
            temperature=0.1,
            response_format={"type": "json_object"},
        )

        raw = response.choices[0].message.content or "[]"
        data = json.loads(raw)
        if isinstance(data, dict):
            items = list(data.values())[0] if data else []
        else:
            items = data

        evidences = []
        for item in items:
            if item.get("found"):
                evidences.append(
                    Evidence(
                        criterion_id=item["criterion_id"],
                        document_name=document_name,
                        document_type=document_type,
                        extracted_value=item.get("extracted_value"),
                        source_text=item.get("source_text", ""),
                        confidence=min(float(item.get("confidence", 0.8)), confidence_hint),
                        page_number=item.get("page_number"),
                    )
                )
        return evidences

    except Exception:
        return _mock_extract_evidence(document_text, document_name, document_type, criteria, confidence_hint)


# ─── Mock / rule-based evidence extraction ────────────────────────────────────

_TURNOVER_RE = re.compile(
    r"(?:annual\s+)?turnover[^\n]*?(?:₹|rs\.?|inr)\s*([\d,]+(?:\.\d+)?)",
    re.IGNORECASE,
)
_GST_RE = re.compile(r"\b(GSTIN?|GST\s+(?:No|Number|Reg|Registration))[:\s]*([0-9A-Z]{15})\b", re.IGNORECASE)
# PAN: allow any text between "PAN" and the 10-char PAN number on the same line
_PAN_RE = re.compile(r"\bPAN\b[^\n]*?([A-Z]{5}[0-9]{4}[A-Z])\b", re.IGNORECASE)
_ISO_RE = re.compile(r"\bISO\s*[\-]?\s*(9001|14001|27001|45001)[\s:]*(\d{4})?\b", re.IGNORECASE)
# Match "completed X similar projects" or "Total … projects … : X" patterns
_PROJECT_RE = re.compile(
    r"(?:completed|executed|undertaken)\s+(\d+)\s+(?:similar|comparable)?\s*(?:project|work|contract)"
    r"|total\s+completed[^:\d]*[:\s]+(\d+)",
    re.IGNORECASE,
)
_EXPERIENCE_YEARS_RE = re.compile(r"(\d+)\s+years?\s+(?:of\s+)?(?:experience|operation)", re.IGNORECASE)
_MSME_RE = re.compile(r"\b(MSME|Udyam)\b", re.IGNORECASE)
_EPF_RE = re.compile(r"\bEPF\b", re.IGNORECASE)
_ESIC_RE = re.compile(r"\bESIC\b", re.IGNORECASE)


def _mock_extract_evidence(
    document_text: str,
    document_name: str,
    document_type: DocumentType,
    criteria: list[Criterion],
    confidence_hint: float,
) -> list[Evidence]:
    """Rule-based mock evidence extraction."""
    evidence_list: list[Evidence] = []

    for criterion in criteria:
        ctype = criterion.criterion_type.value
        cname = criterion.name.lower()

        hit_value: Optional[str] = None
        hit_source: str = ""

        # --- Financial criteria ---
        if ctype == "financial" or "turnover" in cname or "net worth" in cname or "capital" in cname:
            m = _TURNOVER_RE.search(document_text)
            if m:
                hit_value = m.group(1).replace(",", "")
                hit_source = _surrounding(document_text, m)

        # --- Experience criteria ---
        elif ctype == "experience" or "project" in cname or "experience" in cname:
            m = _PROJECT_RE.search(document_text) or _EXPERIENCE_YEARS_RE.search(document_text)
            if m:
                # _PROJECT_RE has two groups; take whichever group matched
                hit_value = next((g for g in m.groups() if g is not None), None)
                hit_source = _surrounding(document_text, m)

        # --- GST ---
        elif "gst" in cname:
            m = _GST_RE.search(document_text)
            if m:
                hit_value = m.group(2) or "GST Registered"
                hit_source = _surrounding(document_text, m)
            elif "gst" in document_text.lower():
                hit_value = "GST mentioned in document"
                idx = document_text.lower().index("gst")
                hit_source = document_text[max(0, idx - 30) : idx + 60]

        # --- PAN ---
        elif "pan" in cname:
            m = _PAN_RE.search(document_text)
            if m:
                hit_value = m.group(1)
                hit_source = _surrounding(document_text, m)

        # --- ISO certifications ---
        elif "iso" in cname or ctype == "certification":
            m = _ISO_RE.search(document_text)
            if m:
                hit_value = f"ISO {m.group(1)}"
                hit_source = _surrounding(document_text, m)

        # --- MSME ---
        elif "msme" in cname:
            m = _MSME_RE.search(document_text)
            if m:
                hit_value = "MSME Registered"
                hit_source = _surrounding(document_text, m)

        # --- EPF ---
        elif "epf" in cname:
            m = _EPF_RE.search(document_text)
            if m:
                hit_value = "EPF Registered"
                hit_source = _surrounding(document_text, m)

        # --- ESIC ---
        elif "esic" in cname:
            m = _ESIC_RE.search(document_text)
            if m:
                hit_value = "ESIC Registered"
                hit_source = _surrounding(document_text, m)

        # --- Generic keyword search ---
        else:
            keywords = criterion.name.lower().split()
            for kw in keywords:
                if len(kw) > 4 and kw in document_text.lower():
                    idx = document_text.lower().index(kw)
                    hit_value = f"Found reference to '{kw}'"
                    hit_source = document_text[max(0, idx - 40) : idx + 80]
                    break

        if hit_value is not None:
            evidence_list.append(
                Evidence(
                    criterion_id=criterion.criterion_id,
                    document_name=document_name,
                    document_type=document_type,
                    extracted_value=hit_value,
                    source_text=hit_source,
                    confidence=confidence_hint * 0.9,
                    page_number=None,
                )
            )

    return evidence_list


def _surrounding(text: str, match: re.Match, before: int = 60, after: int = 120) -> str:
    start = max(0, match.start() - before)
    end = min(len(text), match.end() + after)
    return text[start:end].strip()
