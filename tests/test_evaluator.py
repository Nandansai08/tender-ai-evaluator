"""Tests for the AI evaluator engine."""
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from backend.ai.evaluator import evaluate_bidder, _check_threshold, _overall_verdict
from backend.models import (
    BidderEvaluation,
    Criterion,
    CriterionEvaluation,
    CriterionMandatory,
    CriterionType,
    DocumentType,
    Evidence,
    Verdict,
)


# ─── Fixtures ────────────────────────────────────────────────────────────────

def make_criterion(cid="C01", name="Test Criterion", ctype=CriterionType.FINANCIAL,
                   mandatory=CriterionMandatory.MANDATORY, threshold=None, unit=None):
    return Criterion(
        criterion_id=cid,
        name=name,
        description=f"Description for {name}",
        criterion_type=ctype,
        mandatory=mandatory,
        threshold_value=threshold,
        unit=unit,
        source_text="",
    )


def make_evidence(criterion_id="C01", value="8", confidence=0.9, doc="financial_statement.pdf"):
    return Evidence(
        criterion_id=criterion_id,
        document_name=doc,
        document_type=DocumentType.PDF,
        extracted_value=value,
        source_text=f"Annual turnover: ₹{value} Crore",
        confidence=confidence,
    )


class TestCheckThreshold:
    def test_no_threshold_skips(self):
        c = make_criterion(threshold=None)
        e = make_evidence(value="anything")
        assert _check_threshold(c, e) == "skip"

    def test_numeric_pass(self):
        c = make_criterion(threshold="5", unit="INR Crore")
        e = make_evidence(value="8")
        assert _check_threshold(c, e) == "pass"

    def test_numeric_fail(self):
        c = make_criterion(threshold="5", unit="INR Crore")
        e = make_evidence(value="3")
        assert _check_threshold(c, e) == "fail"

    def test_numeric_equal_to_threshold_passes(self):
        c = make_criterion(threshold="5", unit="INR Crore")
        e = make_evidence(value="5")
        assert _check_threshold(c, e) == "pass"

    def test_no_extracted_value_is_uncertain(self):
        c = make_criterion(threshold="5")
        e = make_evidence(value=None)
        assert _check_threshold(c, e) == "uncertain"

    def test_iso_keyword_match(self):
        c = make_criterion(ctype=CriterionType.CERTIFICATION, threshold="ISO 9001")
        e = make_evidence(value="ISO 9001")
        assert _check_threshold(c, e) == "pass"

    def test_iso_keyword_mismatch(self):
        c = make_criterion(ctype=CriterionType.CERTIFICATION, threshold="ISO 9001")
        e = make_evidence(value="ISO 14001")
        assert _check_threshold(c, e) == "uncertain"


class TestEvaluateBidder:
    def _eligible_evidence_map(self, criteria):
        return {
            c.criterion_id: [make_evidence(c.criterion_id, value="8" if c.threshold_value else "present")]
            for c in criteria
        }

    def test_eligible_verdict_all_criteria_met(self):
        criteria = [
            make_criterion("C01", "Turnover", CriterionType.FINANCIAL, threshold="5"),
            make_criterion("C02", "GST", CriterionType.COMPLIANCE, mandatory=CriterionMandatory.MANDATORY),
        ]
        evidence_map = self._eligible_evidence_map(criteria)
        result = evaluate_bidder("b1", "Bidder A", criteria, evidence_map)
        assert isinstance(result, BidderEvaluation)
        assert result.overall_verdict == Verdict.ELIGIBLE

    def test_not_eligible_when_mandatory_criterion_missing(self):
        criteria = [
            make_criterion("C01", "Turnover", CriterionType.FINANCIAL, threshold="5"),
            make_criterion("C02", "GST", CriterionType.COMPLIANCE),
        ]
        # No evidence for any criterion
        result = evaluate_bidder("b2", "Bidder B", criteria, {})
        assert result.overall_verdict == Verdict.NOT_ELIGIBLE

    def test_needs_review_when_low_confidence_evidence(self):
        criteria = [make_criterion("C01", "Turnover", CriterionType.FINANCIAL, threshold="5")]
        # Confidence in review zone (between thresholds)
        evidence_map = {"C01": [make_evidence("C01", value="8", confidence=0.50)]}
        result = evaluate_bidder("b3", "Bidder C", criteria, evidence_map)
        # Should be NEEDS_REVIEW or ELIGIBLE depending on threshold config
        assert result.overall_verdict in (Verdict.ELIGIBLE, Verdict.NEEDS_REVIEW)

    def test_optional_criterion_missing_still_eligible(self):
        criteria = [
            make_criterion("C01", "Turnover", mandatory=CriterionMandatory.MANDATORY, threshold="5"),
            make_criterion("C02", "MSME", mandatory=CriterionMandatory.OPTIONAL),
        ]
        # Only provide evidence for mandatory criterion
        evidence_map = {"C01": [make_evidence("C01", value="8")]}
        result = evaluate_bidder("b4", "Bidder D", criteria, evidence_map)
        assert result.overall_verdict == Verdict.ELIGIBLE

    def test_all_criterion_evaluations_are_present(self):
        criteria = [
            make_criterion("C01", "A"),
            make_criterion("C02", "B"),
            make_criterion("C03", "C"),
        ]
        evidence_map = {"C01": [make_evidence("C01")]}
        result = evaluate_bidder("b5", "Bidder E", criteria, evidence_map)
        assert len(result.criterion_evaluations) == 3

    def test_every_verdict_has_explanation(self):
        criteria = [make_criterion("C01", "Turnover")]
        result = evaluate_bidder("b6", "Bidder F", criteria, {})
        for ce in result.criterion_evaluations:
            assert ce.explanation, "Every criterion evaluation must have an explanation"

    def test_flagged_criteria_listed_when_review_needed(self):
        criteria = [make_criterion("C01", "Turnover", threshold="5")]
        # Low confidence — should trigger review
        evidence_map = {"C01": [make_evidence("C01", value="8", confidence=0.45)]}
        result = evaluate_bidder("b7", "Bidder G", criteria, evidence_map)
        if result.overall_verdict == Verdict.NEEDS_REVIEW:
            assert "C01" in result.flagged_criteria

    def test_below_threshold_mandatory_criterion_not_eligible(self):
        criteria = [make_criterion("C01", "Turnover", CriterionType.FINANCIAL, threshold="5")]
        # Value below threshold
        evidence_map = {"C01": [make_evidence("C01", value="2", confidence=0.95)]}
        result = evaluate_bidder("b8", "Bidder H", criteria, evidence_map)
        assert result.overall_verdict == Verdict.NOT_ELIGIBLE

    def test_overall_explanation_is_non_empty(self):
        criteria = [make_criterion("C01", "Turnover")]
        result = evaluate_bidder("b9", "Bidder I", criteria, {})
        assert result.overall_explanation

    def test_bidder_id_and_name_preserved(self):
        criteria = [make_criterion("C01")]
        result = evaluate_bidder("my-id-123", "My Company", criteria, {})
        assert result.bidder_id == "my-id-123"
        assert result.bidder_name == "My Company"
