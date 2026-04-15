"""Tests for the evidence extractor."""
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from backend.ai.evidence_extractor import extract_evidence, _mock_extract_evidence
from backend.models import Criterion, CriterionMandatory, CriterionType, DocumentType, Evidence

SAMPLE_BIDDER_TEXT = """
Annual Turnover for FY 2022-23: ₹8.5 Crore (CA certified)
Average Annual Turnover (3 years): ₹7.2 Crore

GST Registration:
GSTIN: 07AABCA1234B1Z5
Status: Active

ISO 9001:2015 Certificate — Valid until February 2026

We have completed 4 similar projects in the last 5 years.
"""


def make_criterion(cid, name, ctype, threshold=None):
    return Criterion(
        criterion_id=cid,
        name=name,
        description=name,
        criterion_type=ctype,
        mandatory=CriterionMandatory.MANDATORY,
        threshold_value=threshold,
        source_text="",
    )


class TestExtractEvidence:
    def test_returns_list(self):
        criteria = [make_criterion("C01", "Minimum Annual Turnover", CriterionType.FINANCIAL, "5")]
        result = extract_evidence(SAMPLE_BIDDER_TEXT, "bid.txt", DocumentType.TEXT, criteria)
        assert isinstance(result, list)

    def test_extracts_turnover_evidence(self):
        criteria = [make_criterion("C01", "Minimum Annual Turnover", CriterionType.FINANCIAL, "5")]
        result = extract_evidence(SAMPLE_BIDDER_TEXT, "bid.txt", DocumentType.TEXT, criteria)
        assert len(result) >= 1
        found = [e for e in result if e.criterion_id == "C01"]
        assert found, "Should find turnover evidence"
        assert found[0].extracted_value is not None

    def test_extracts_gst_evidence(self):
        criteria = [make_criterion("C02", "GST Registration", CriterionType.COMPLIANCE)]
        result = extract_evidence(SAMPLE_BIDDER_TEXT, "bid.txt", DocumentType.TEXT, criteria)
        found = [e for e in result if e.criterion_id == "C02"]
        assert found, "Should find GST evidence"

    def test_evidence_has_required_fields(self):
        criteria = [make_criterion("C01", "Minimum Annual Turnover", CriterionType.FINANCIAL, "5")]
        result = extract_evidence(SAMPLE_BIDDER_TEXT, "bid.txt", DocumentType.TEXT, criteria)
        for e in result:
            assert isinstance(e, Evidence)
            assert e.criterion_id
            assert e.document_name == "bid.txt"
            assert isinstance(e.document_type, DocumentType)
            assert 0.0 <= e.confidence <= 1.0

    def test_empty_document_returns_empty_evidence(self):
        criteria = [make_criterion("C01", "Turnover", CriterionType.FINANCIAL, "5")]
        result = extract_evidence("", "empty.txt", DocumentType.TEXT, criteria)
        assert result == [], "Empty document should produce no evidence"

    def test_no_criteria_returns_empty(self):
        result = extract_evidence(SAMPLE_BIDDER_TEXT, "bid.txt", DocumentType.TEXT, [])
        assert result == []

    def test_confidence_hint_applied(self):
        """Confidence hint from OCR should cap evidence confidence."""
        criteria = [make_criterion("C01", "Minimum Annual Turnover", CriterionType.FINANCIAL, "5")]
        low_conf_result = extract_evidence(SAMPLE_BIDDER_TEXT, "scan.jpg", DocumentType.IMAGE, criteria, confidence_hint=0.50)
        high_conf_result = extract_evidence(SAMPLE_BIDDER_TEXT, "bid.txt", DocumentType.TEXT, criteria, confidence_hint=0.95)

        if low_conf_result and high_conf_result:
            assert low_conf_result[0].confidence <= high_conf_result[0].confidence
