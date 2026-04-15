"""
Evaluation engine — decides whether each bidder is Eligible, Not Eligible,
or Needs Manual Review for each criterion, and overall.

Core non-negotiables:
  - Every verdict is explainable at the criterion level.
  - Ambiguous / uncertain cases are NEVER silently rejected; they are
    flagged for manual review with an explicit reason.
  - Confidence scores drive the three-way verdict:
      confidence >= threshold_eligible  → ELIGIBLE
      confidence >= threshold_review    → NEEDS_REVIEW
      confidence <  threshold_review    → NOT_ELIGIBLE (only if mandatory)
"""
from __future__ import annotations

import re
from typing import Optional

from backend.config import settings
from backend.models import (
    BidderEvaluation,
    Criterion,
    CriterionEvaluation,
    CriterionMandatory,
    CriterionType,
    Evidence,
    Verdict,
)


# ─── Public entry point ───────────────────────────────────────────────────────

def evaluate_bidder(
    bidder_id: str,
    bidder_name: str,
    criteria: list[Criterion],
    evidence_map: dict[str, list[Evidence]],
) -> BidderEvaluation:
    """
    Evaluate a single bidder against all criteria.

    Args:
        bidder_id: Unique identifier of the bidder.
        bidder_name: Display name of the bidder.
        criteria: List of Criterion objects extracted from the tender.
        evidence_map: Dict mapping criterion_id → list[Evidence] from all bidder docs.

    Returns:
        BidderEvaluation with per-criterion verdicts and an overall verdict.
    """
    criterion_evals: list[CriterionEvaluation] = []
    flagged_criteria: list[str] = []

    for criterion in criteria:
        evidences = evidence_map.get(criterion.criterion_id, [])
        ce = _evaluate_criterion(criterion, evidences)
        criterion_evals.append(ce)
        if ce.verdict == Verdict.NEEDS_REVIEW:
            flagged_criteria.append(criterion.criterion_id)

    overall_verdict, overall_confidence, overall_explanation = _overall_verdict(
        criterion_evals, flagged_criteria
    )

    return BidderEvaluation(
        bidder_id=bidder_id,
        bidder_name=bidder_name,
        overall_verdict=overall_verdict,
        overall_confidence=overall_confidence,
        overall_explanation=overall_explanation,
        criterion_evaluations=criterion_evals,
        flagged_criteria=flagged_criteria,
    )


# ─── Per-criterion evaluation ─────────────────────────────────────────────────

def _evaluate_criterion(criterion: Criterion, evidences: list[Evidence]) -> CriterionEvaluation:
    """Produce a CriterionEvaluation for one criterion."""

    is_mandatory = criterion.mandatory == CriterionMandatory.MANDATORY

    if not evidences:
        return _no_evidence_verdict(criterion, is_mandatory)

    # Best evidence = highest confidence
    best = max(evidences, key=lambda e: e.confidence)
    agg_conf = best.confidence

    # For financial / numeric criteria, additionally validate the threshold
    threshold_check = _check_threshold(criterion, best)

    if threshold_check == "fail":
        # Value found but below threshold → Not Eligible (if mandatory)
        if is_mandatory:
            return CriterionEvaluation(
                criterion_id=criterion.criterion_id,
                criterion_name=criterion.name,
                criterion_type=criterion.criterion_type,
                mandatory=criterion.mandatory,
                verdict=Verdict.NOT_ELIGIBLE,
                confidence=agg_conf,
                explanation=(
                    f"Bidder does not meet the required threshold for '{criterion.name}'. "
                    f"Found value '{best.extracted_value}' in '{best.document_name}' but the "
                    f"required threshold is {criterion.threshold_value} {criterion.unit or ''}. "
                    f"Source: \"{best.source_text[:200]}\""
                ),
                evidence=evidences,
            )
        else:
            return CriterionEvaluation(
                criterion_id=criterion.criterion_id,
                criterion_name=criterion.name,
                criterion_type=criterion.criterion_type,
                mandatory=criterion.mandatory,
                verdict=Verdict.ELIGIBLE,
                confidence=agg_conf,
                explanation=(
                    f"Optional criterion '{criterion.name}': value does not meet threshold "
                    f"but criterion is optional — marked eligible."
                ),
                evidence=evidences,
            )

    if threshold_check == "uncertain":
        return CriterionEvaluation(
            criterion_id=criterion.criterion_id,
            criterion_name=criterion.name,
            criterion_type=criterion.criterion_type,
            mandatory=criterion.mandatory,
            verdict=Verdict.NEEDS_REVIEW,
            confidence=agg_conf,
            explanation=(
                f"Evidence found for '{criterion.name}' in '{best.document_name}' "
                f"(value: '{best.extracted_value}') but could not be reliably compared to "
                f"threshold '{criterion.threshold_value}'. Manual review needed."
            ),
            evidence=evidences,
            review_reason="Threshold comparison uncertain — value format may differ from expected.",
        )

    # Threshold passed (or no threshold) — apply confidence tiers
    if agg_conf >= settings.confidence_threshold_eligible:
        return CriterionEvaluation(
            criterion_id=criterion.criterion_id,
            criterion_name=criterion.name,
            criterion_type=criterion.criterion_type,
            mandatory=criterion.mandatory,
            verdict=Verdict.ELIGIBLE,
            confidence=agg_conf,
            explanation=(
                f"Criterion '{criterion.name}' satisfied. "
                f"Evidence found in '{best.document_name}': '{best.extracted_value}'. "
                f"Source: \"{best.source_text[:200]}\""
            ),
            evidence=evidences,
        )

    if agg_conf >= settings.confidence_threshold_review:
        return CriterionEvaluation(
            criterion_id=criterion.criterion_id,
            criterion_name=criterion.name,
            criterion_type=criterion.criterion_type,
            mandatory=criterion.mandatory,
            verdict=Verdict.NEEDS_REVIEW,
            confidence=agg_conf,
            explanation=(
                f"Possible evidence for '{criterion.name}' found in '{best.document_name}' "
                f"but extraction confidence is low ({agg_conf:.0%}). "
                f"Found: '{best.extracted_value}'. Manual review recommended."
            ),
            evidence=evidences,
            review_reason=f"Low extraction confidence ({agg_conf:.0%}) — document may be unclear or the value may be ambiguous.",
        )

    # Very low confidence — treat as no usable evidence
    return _no_evidence_verdict(criterion, is_mandatory, low_conf_evidences=evidences, confidence=agg_conf)


def _no_evidence_verdict(
    criterion: Criterion,
    is_mandatory: bool,
    low_conf_evidences: Optional[list[Evidence]] = None,
    confidence: float = 0.0,
) -> CriterionEvaluation:
    """Return a verdict when no usable evidence is available."""
    evidences = low_conf_evidences or []

    if is_mandatory:
        return CriterionEvaluation(
            criterion_id=criterion.criterion_id,
            criterion_name=criterion.name,
            criterion_type=criterion.criterion_type,
            mandatory=criterion.mandatory,
            verdict=Verdict.NOT_ELIGIBLE,
            confidence=confidence,
            explanation=(
                f"No evidence found for mandatory criterion '{criterion.name}'. "
                "The bidder's submitted documents do not contain the required information."
            ),
            evidence=evidences,
        )
    else:
        return CriterionEvaluation(
            criterion_id=criterion.criterion_id,
            criterion_name=criterion.name,
            criterion_type=criterion.criterion_type,
            mandatory=criterion.mandatory,
            verdict=Verdict.ELIGIBLE,
            confidence=1.0,
            explanation=(
                f"Optional criterion '{criterion.name}' — no evidence required. Marked eligible."
            ),
            evidence=evidences,
        )


def _check_threshold(criterion: Criterion, evidence: Evidence) -> str:
    """
    Compare the extracted value against the criterion threshold.

    Returns:
        "pass"      — value meets threshold
        "fail"      — value is below threshold
        "uncertain" — comparison could not be determined
        "skip"      — no threshold defined
    """
    if not criterion.threshold_value:
        return "skip"

    extracted = evidence.extracted_value
    if not extracted:
        return "uncertain"

    # Try numeric comparison for financial / experience criteria only
    # (skip for certification/compliance where values like "ISO 9001" contain numbers)
    _numeric_types = {CriterionType.FINANCIAL, CriterionType.EXPERIENCE, CriterionType.TECHNICAL}
    threshold_num = _parse_number(criterion.threshold_value) if criterion.criterion_type in _numeric_types else None
    extracted_num = _parse_number(extracted) if criterion.criterion_type in _numeric_types else None

    if threshold_num is not None and extracted_num is not None:
        # Convert lakhs to crore if needed
        if criterion.unit and "crore" in criterion.unit.lower():
            if "lakh" in (evidence.source_text or "").lower():
                extracted_num /= 100.0

        if extracted_num >= threshold_num:
            return "pass"
        else:
            return "fail"

    # Non-numeric: check for keyword presence (certifications etc.)
    threshold_lower = criterion.threshold_value.lower()
    extracted_lower = extracted.lower()
    source_lower = (evidence.source_text or "").lower()

    if threshold_lower in extracted_lower or threshold_lower in source_lower:
        return "pass"

    # Can't determine
    return "uncertain"


def _parse_number(text: str) -> Optional[float]:
    """Extract a floating-point number from a string."""
    if not text:
        return None
    clean = re.sub(r"[^\d.]", "", text.replace(",", ""))
    try:
        return float(clean)
    except ValueError:
        return None


# ─── Overall verdict ──────────────────────────────────────────────────────────

def _overall_verdict(
    criterion_evals: list[CriterionEvaluation],
    flagged_criteria: list[str],
) -> tuple[Verdict, float, str]:
    """Aggregate per-criterion verdicts into a single overall verdict."""

    if not criterion_evals:
        return Verdict.NEEDS_REVIEW, 0.0, "No criteria were evaluated."

    mandatory_evals = [ce for ce in criterion_evals if ce.mandatory == CriterionMandatory.MANDATORY]
    failed_mandatory = [ce for ce in mandatory_evals if ce.verdict == Verdict.NOT_ELIGIBLE]
    review_mandatory = [ce for ce in mandatory_evals if ce.verdict == Verdict.NEEDS_REVIEW]

    avg_confidence = sum(ce.confidence for ce in criterion_evals) / len(criterion_evals)

    if failed_mandatory:
        failed_names = ", ".join(ce.criterion_name for ce in failed_mandatory)
        return (
            Verdict.NOT_ELIGIBLE,
            avg_confidence,
            f"Bidder does not meet the following mandatory criteria: {failed_names}.",
        )

    if review_mandatory or flagged_criteria:
        flagged_names = ", ".join(
            ce.criterion_name for ce in criterion_evals if ce.criterion_id in flagged_criteria
        )
        return (
            Verdict.NEEDS_REVIEW,
            avg_confidence,
            f"Manual review required for the following criteria: {flagged_names}.",
        )

    return (
        Verdict.ELIGIBLE,
        avg_confidence,
        "Bidder meets all mandatory eligibility criteria.",
    )
